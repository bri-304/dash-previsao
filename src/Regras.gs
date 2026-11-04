/* ------------------------------------------------------------------
   REGRAS DO FORECAST
   Reproduz em código o que a planilha "Dados IA - Previsão" fazia nas abas
   'Configuracoes mes', 'Vendas por dia Mês Atual', 'Vendas do mês por time' e
   'Configuracoes times', e o que o ETL do Pentaho fazia para montar o JSON.
   Tudo aqui é função pura: entra o que foi lido da planilha e a data de
   referência, sai o objeto (schema v8, veja CLAUDE.md). Nenhuma chamada ao
   Google neste arquivo, para dar para testar fora do Apps Script.
   ------------------------------------------------------------------ */

var REGRAS = {
  // NOME_GERENTE_ATUAL com estes valores não forma time (comparação sem maiúscula/acento).
  GERENTES_SEM_TIME: ['sem gerente'],
  CONSULTOR_FORA_DO_DIA: 'backoffice me',   // filtro só da tabela "Vendas por dia"
  MESES: ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'],
  MESES_CURTOS: ['Jan.', 'Fev.', 'Mar.', 'Abr.', 'Mai.', 'Jun.', 'Jul.', 'Ago.', 'Set.', 'Out.', 'Nov.', 'Dez.']
};

/* ---------- datas: sempre {ano, mes (1-12), dia}, sem Date, para o fuso não interferir ---------- */

function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function ymd_(ano, mes, dia) { return ano + '-' + pad2_(mes) + '-' + pad2_(dia); }
function diasNoMes_(ano, mes) { return new Date(Date.UTC(ano, mes, 0)).getUTCDate(); }
function mesAnterior_(ano, mes) { return mes === 1 ? { ano: ano - 1, mes: 12 } : { ano: ano, mes: mes - 1 }; }
function intervaloMes_(ano, mes) { return { ini: ymd_(ano, mes, 1), fim: ymd_(ano, mes, diasNoMes_(ano, mes)) }; }

// Aceita 2026-11-03, 2026-11-03 10:00:00 e 03/11/2026. Fora disso devolve ''.
function normalizarData_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ymd_(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return ymd_(+m[3], +m[2], +m[1]);
  return '';
}

function semAcento_(s) {
  return String(s === null || s === undefined ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function inteiro_(v) {
  var n = parseInt(String(v === null || v === undefined ? '' : v).replace(/\./g, ''), 10);
  return isNaN(n) ? 0 : n;
}

function texto_(v) {
  return String(v === null || v === undefined ? '' : v).replace(/[\r\n]+/g, ' ');
}

/* ---------- vendas ---------- */

// Filtros comuns às tabelas dinâmicas: não é estorno, produto conta meta, CONTAR_VENDA = 1.
function vendaConta_(v) {
  return semAcento_(v.status) !== 'estorno' &&
         String(v.produtoMeta).trim() === 'Sim' &&
         String(v.contar).trim() === '1' &&
         !!v.id;
}

// Tabela "Vendas por dia Mês Atual": ID_LEAD diferentes por dia.
function vendasPorDia_(vendas, ano, mes) {
  var r = intervaloMes_(ano, mes), dias = {};
  vendas.forEach(function (v) {
    if (v.data < r.ini || v.data > r.fim || !vendaConta_(v)) return;
    if (semAcento_(v.consultor) === REGRAS.CONSULTOR_FORA_DO_DIA) return;
    var d = parseInt(v.data.slice(8), 10);
    (dias[d] = dias[d] || {})[v.id] = true;
  });
  var saida = {};
  Object.keys(dias).forEach(function (d) { saida[d] = Object.keys(dias[d]).length; });
  return saida;
}

// As letras da chave aparecem em ordem no primeiro nome e a primeira letra é a mesma ("stl" em "stella").
function chaveCabeNoNome_(chave, primeiroNome) {
  if (!chave || chave.charAt(0) !== primeiroNome.charAt(0)) return false;
  var pos = 0;
  for (var i = 0; i < primeiroNome.length && pos < chave.length; i++) {
    if (primeiroNome.charAt(i) === chave.charAt(pos)) pos++;
  }
  return pos === chave.length;
}

// Time = primeiro nome do gerente: as grafias do mesmo gerente (Stella Niehues e Stella Nieheus,
// Israel Riella e Israel Cristiano Riella) ficam juntas. A chave vem da aba 'Configuracoes times',
// onde a IA escreve os textos; gerente novo, sem chave lá, ganha as 3 primeiras letras do nome.
function chaveDoGerente_(gerente, chavesConhecidas, jaUsadas) {
  var primeiro = semAcento_(gerente).split(/\s+/)[0].replace(/[^a-z0-9]/g, '');
  if (!primeiro) return '';
  if (jaUsadas[primeiro]) return jaUsadas[primeiro];
  var usadas = Object.keys(jaUsadas).map(function (k) { return jaUsadas[k]; });
  var chave = '';
  for (var i = 0; i < chavesConhecidas.length; i++) {
    var c = chavesConhecidas[i];
    if (usadas.indexOf(c) < 0 && chaveCabeNoNome_(c, primeiro)) { chave = c; break; }
  }
  if (!chave) {
    var tam = Math.min(3, primeiro.length);
    chave = primeiro.slice(0, tam);
    while (usadas.indexOf(chave) >= 0 && tam < primeiro.length) { tam++; chave = primeiro.slice(0, tam); }
    if (usadas.indexOf(chave) >= 0) chave = primeiro + '2';
  }
  jaUsadas[primeiro] = chave;
  return chave;
}

function gerenteFormaTime_(gerente) {
  var g = semAcento_(gerente);
  return !!g && REGRAS.GERENTES_SEM_TIME.indexOf(g) < 0;
}

// Ordem das tabelas dinâmicas: mais vendas primeiro; no empate, nome em ordem decrescente.
function ordenarVendedores_(a, b) {
  return b.qtd - a.qtd || semAcento_(b.nome).localeCompare(semAcento_(a.nome));
}

// Conta por (time, vendedor) as vendas do intervalo. Devolve { chaveTime: { vendedor: qtd } } e os nomes vistos.
function contarPorVendedor_(vendas, ini, fim, chaves, jaUsadas, nomes) {
  var conj = {};
  vendas.forEach(function (v) {
    if (v.data < ini || v.data > fim || !vendaConta_(v) || !String(v.area).trim()) return;
    if (!gerenteFormaTime_(v.gerente)) return;
    var k = chaveDoGerente_(v.gerente, chaves, jaUsadas);
    if (!k) return;
    var nomesK = nomes[k] = nomes[k] || {};
    nomesK[v.gerente] = (nomesK[v.gerente] || 0) + 1;
    var doTime = conj[k] = conj[k] || {};
    (doTime[v.consultor] = doTime[v.consultor] || {})[v.id] = true;
  });
  var saida = {};
  Object.keys(conj).forEach(function (k) {
    saida[k] = {};
    Object.keys(conj[k]).forEach(function (nome) { saida[k][nome] = Object.keys(conj[k][nome]).length; });
  });
  return saida;
}

function somaValores_(obj) {
  return Object.keys(obj || {}).reduce(function (t, k) { return t + obj[k]; }, 0);
}

// Times saem dos dados: todo gerente com venda no mês atual ou no anterior. 'Vendas do mês por time'
// lista primeiro quem vendeu no mês atual e depois quem só vendeu no anterior.
function montarTimes_(vendas, hoje, configTimes, rotulos) {
  var chaves = [];
  configTimes.forEach(function (l) { if (l.time && chaves.indexOf(l.time) < 0) chaves.push(l.time); });
  var ant = mesAnterior_(hoje.ano, hoje.mes);
  var rAtual = intervaloMes_(hoje.ano, hoje.mes), rPassado = intervaloMes_(ant.ano, ant.mes);
  // Corrigido: no dia 31 a planilha pedia "31 do mês anterior" e o intervalo passava para o mês seguinte.
  var fimAteHoje = ymd_(ant.ano, ant.mes, Math.min(hoje.dia, diasNoMes_(ant.ano, ant.mes)));

  var jaUsadas = {}, nomes = {};
  var atual = contarPorVendedor_(vendas, rAtual.ini, rAtual.fim, chaves, jaUsadas, nomes);
  var passado = contarPorVendedor_(vendas, rPassado.ini, rPassado.fim, chaves, jaUsadas, nomes);
  var ateHoje = contarPorVendedor_(vendas, rPassado.ini, fimAteHoje, chaves, jaUsadas, {});

  var passadoPorNome = {}, vendeuAgora = {};
  Object.keys(passado).forEach(function (k) {
    Object.keys(passado[k]).forEach(function (n) { passadoPorNome[n] = (passadoPorNome[n] || 0) + passado[k][n]; });
  });
  Object.keys(atual).forEach(function (k) { Object.keys(atual[k]).forEach(function (n) { vendeuAgora[n] = true; }); });

  var lista = function (obj) {
    return Object.keys(obj || {}).map(function (n) { return { nome: n, qtd: obj[n] }; }).sort(ordenarVendedores_);
  };
  var campo = function (chave, sufixo) {
    for (var i = 0; i < configTimes.length; i++) {
      if (configTimes[i].chave === chave + '_' + sufixo) return configTimes[i].valor;
    }
    return '';
  };

  var times = {};
  var teclas = {};
  Object.keys(atual).concat(Object.keys(passado)).forEach(function (k) { teclas[k] = true; });
  Object.keys(teclas).sort().forEach(function (k) {
    var sellers = [];
    lista(atual[k]).forEach(function (s) { sellers.push([s.nome, passadoPorNome[s.nome] || 0, s.qtd]); });
    lista(passado[k]).forEach(function (s) { if (!vendeuAgora[s.nome]) sellers.push([s.nome, s.qtd, 0]); });

    var totalAtual = sellers.reduce(function (t, s) { return t + s[2]; }, 0);
    var totalPassado = sellers.reduce(function (t, s) { return t + s[1]; }, 0);
    var grafias = nomes[k] || {};
    var nomeTime = Object.keys(grafias).sort(function (a, b) { return grafias[b] - grafias[a]; })[0] || k;

    times[k] = {
      nome: nomeTime,
      ativos: sellers.length,                // pessoas que venderam no mês atual ou no anterior
      mes_passado_total: totalPassado,
      mes_passado: somaValores_(ateHoje[k]),
      mes_atual_total: totalAtual,
      dias_confirmados_lbl: rotulos.dias_confirmados_lbl,
      dias_confirmados_val: totalAtual,
      prev_atual: texto_(campo(k, 'prev_atual')),
      lbl_titulo_comp: rotulos.lbl_titulo_comp,
      lbl_titulo_mes_passado_prev: rotulos.lbl_titulo_mes_passado_prev,
      lbl_vendedor: rotulos.lbl_vendedor,
      leg_mes_passado: rotulos.leg_mes_passado,
      leg_mes_atual: rotulos.leg_mes_atual,
      destaque_txt: texto_(campo(k, 'destaque_txt')),
      atencao_txt: texto_(campo(k, 'atencao_txt')),
      sellers: sellers
    };
  });
  return times;
}

/* ---------- textos da aba 'Configuracoes mes' ---------- */

function numeroBr_(n) { return String(n).replace('.', ','); }

function rotulosDoMes_(hoje) {
  var ant = mesAnterior_(hoje.ano, hoje.mes);
  var m = REGRAS.MESES[hoje.mes - 1], mc = REGRAS.MESES_CURTOS[hoje.mes - 1];
  var a = REGRAS.MESES[ant.mes - 1], ac = REGRAS.MESES_CURTOS[ant.mes - 1];
  return {
    mes: m, mesAnterior: a,
    dias_confirmados_lbl: 'dias 1 - ' + hoje.dia,
    lbl_titulo_comp: ac + ' real vs ' + mc + ' Real',
    lbl_titulo_mes_passado_prev: 'Prev. ' + mc + ' Realizado ' + ac,
    lbl_vendedor: a + ' vs ' + m + ' — por vendedor',
    leg_mes_passado: ac,
    leg_mes_atual: mc
  };
}

function statusDias_(hoje) {
  var ultimo = diasNoMes_(hoje.ano, hoje.mes), d = hoje.dia;
  var inicio = d === 1 ? 'Dia 1 confirmado · Dia 1 parcial' : 'Dias 1 à ' + d + ' confirmados · Dia ' + d + ' parcial';
  // Corrigido: no último dia a planilha escrevia "Dias 31 à 30"; no penúltimo, "Dias 30 à 30".
  if (d >= ultimo) return inicio;
  if (d + 1 === ultimo) return inicio + ' · Dia ' + ultimo + ' com intervalo de confiança';
  return inicio + ' · Dias ' + (d + 1) + ' à ' + ultimo + ' com intervalo de confiança';
}

function realizadoSub_(hoje) {
  // Corrigido: no dia 1 a planilha escrevia "dias 1 à 31" (o dia anterior é do mês passado).
  return hoje.dia === 1 ? 'Vendas Confirmadas (dia 1)' : 'Vendas Confirmadas (dias 1 à ' + (hoje.dia - 1) + ')';
}

// Corrigido: a planilha dividia por 390 fixo; agora é o central da previsão atual.
function realizadoDelta_(realizado, central) {
  if (!central) return '▲ — do total previsto';
  return '▲ ' + numeroBr_(Math.round(realizado / central * 1000) / 10) + '% do total previsto';
}

/* ---------- abas preenchidas pela IA ---------- */

function montarSemanas_(linhas, tags) {
  return linhas.filter(function (l) { return String(l.n).trim() !== ''; }).map(function (l) {
    var n = inteiro_(l.n);
    return {
      n: n,
      dates: texto_(l.dates),
      central: inteiro_(l.central),
      min: inteiro_(l.min),
      max: inteiro_(l.max),
      avg_txt: texto_(l.avg_txt),
      color: texto_(l.color),
      tags: tags.filter(function (t) { return inteiro_(t.semana) === n && String(t.cls).trim() !== ''; })
        .map(function (t) { return { cls: texto_(t.cls), txt: texto_(t.txt) }; })
    };
  });
}

function montarSugestoes_(linhas) {
  return linhas.filter(function (l) { return String(l.n).trim() !== ''; }).map(function (l) {
    var n = String(l.n).trim();
    if (n.length < 2) n = '0' + n;
    return {
      n: n,
      titulo: texto_(l.titulo),
      descricao_html: texto_(l.descricao_html),
      tags: String(l.tags || '').split(';').map(function (t) { return t.trim(); })
        .filter(function (t) { return t !== ''; }).map(texto_)
    };
  });
}

function montarGargalos_(linhas) {
  return linhas.filter(function (l) { return String(l.tipo).trim() !== '' || String(l.titulo).trim() !== ''; }).map(function (l) {
    return { tipo: texto_(l.tipo), data: texto_(l.data), titulo: texto_(l.titulo), desc: texto_(l.desc), pill: texto_(l.pill) };
  });
}

// Previsão da IA + realizado do mês. Índices: 0 dia, 1 dia da semana, 2 central, 3 mín, 4 máx, 5 tipo, 6 evento, 7 realizado.
// Dia com venda vira 'real' (já passou) ou 'partial' (hoje); dia sem venda fica com o tipo da previsão e realizado null.
function montarDias_(linhasPrevisao, porDia, hoje) {
  return linhasPrevisao.filter(function (l) { return inteiro_(l.dia_num) > 0; }).map(function (l) {
    var num = inteiro_(l.dia_num);
    var dow = String(l.dia_semana || '').replace(/\./g, '').trim();
    if (dow) dow = dow.charAt(0).toUpperCase() + dow.slice(1);
    var temVenda = Object.prototype.hasOwnProperty.call(porDia, num);
    var tipo = texto_(l.tipo);
    if (temVenda) tipo = num < hoje.dia ? 'real' : (num === hoje.dia ? 'partial' : 'work');
    return [num, dow, inteiro_(l.central), inteiro_(l.min), inteiro_(l.max), tipo, texto_(l.evento), temVenda ? porDia[num] : null];
  });
}

/* ---------- objeto completo ---------- */

/* fontes = {
     vendas:      [{ id, consultor, produtoMeta, data:'AAAA-MM-DD', area, status, contar, gerente }],
     camposIA:    { chave: valor } (Campos_previsao_IA),
     configMes:   { chave: valor } (só os textos digitados à mão em 'Configuracoes mes'),
     configTimes: [{ time, chave, valor }] (Configuracoes times),
     semanas, semanaTags, sugestoes, gargalos, diasPrevisao: linhas das abas da IA (objetos pelo cabeçalho),
     inativos:    número de desmarcados na Jornada de Estrelas,
     atualizadoEm:'dd/MM/yyyy HH:mm'
   }
   hoje = { ano, mes, dia }  */
function montarForecast_(fontes, hoje) {
  var ia = fontes.camposIA || {}, cfg = fontes.configMes || {};
  var rotulos = rotulosDoMes_(hoje);
  var porDia = vendasPorDia_(fontes.vendas, hoje.ano, hoje.mes);
  var realizado = somaValores_(porDia);
  var central = inteiro_(ia.kpi_total_central);
  var times = montarTimes_(fontes.vendas, hoje, fontes.configTimes || [], rotulos);

  var pessoas = {};
  Object.keys(times).forEach(function (k) { times[k].sellers.forEach(function (s) { pessoas[s[0]] = true; }); });
  var qtdTimes = Object.keys(times).length;
  var mesAno = rotulos.mes + ' ' + hoje.ano;
  var inativos = fontes.inativos;

  return {
    meta: {
      atualizado_em: fontes.atualizadoEm || '',
      status_dias: statusDias_(hoje),
      kpi_total_pess: inteiro_(ia.kpi_total_pess),
      kpi_total_central: central,
      kpi_total_otim: inteiro_(ia.kpi_total_otim),
      kpi_total_delta: texto_(ia.kpi_total_delta),
      kpi_media_central: texto_(ia.kpi_media_central),
      kpi_media_min: texto_(ia.kpi_media_min),
      kpi_media_max: texto_(ia.kpi_media_max),
      kpi_realizado: realizado,
      kpi_realizado_sub: realizadoSub_(hoje),
      kpi_realizado_delta: realizadoDelta_(realizado, central),
      kpi_yoy_pct: texto_(ia.kpi_yoy_pct),
      kpi_yoy_pess: texto_(ia.kpi_yoy_pess),
      kpi_yoy_otim: texto_(ia.kpi_yoy_otim),
      kpi_yoy_sub: texto_(ia.kpi_yoy_sub),
      kpi_ativos: Object.keys(pessoas).length,   // pedido da Brianna: pessoas que venderam, igual ao card de cada time
      kpi_ativos_sub: 'em ' + qtdTimes + (qtdTimes === 1 ? ' time competindo' : ' times competindo'),
      kpi_inativos_delta: inativos === null || inativos === undefined ? texto_(cfg.kpi_inativos_delta) : '▼ ' + inativos + ' inativos / férias',
      page_title: 'Forecast ' + mesAno + ' - Consolide',
      hdr_title_html: 'Forecast de Vendas - ' + mesAno,
      badge_consoliga: texto_(ia.badge_consoliga),
      badge_copa: texto_(ia.badge_copa),
      kpi_total_sub: 'vendas · ' + rotulos.mes + '/' + hoje.ano,
      kpi_media_delta: texto_(ia.kpi_media_delta),
      kpi_yoy_lbl: 'Percentual Previsto vs ' + rotulos.mes + ' ' + (hoje.ano - 1),
      kpi_yoy_delta: texto_(cfg.kpi_yoy_delta),
      sec_title_previsao: 'previsão diária com intervalo de confiança — ' + mesAno,
      chart_title_main: 'Vendas por Dia · ' + mesAno,
      sec_title_teams: 'desempenho por time — ' + rotulos.mesAnterior + ' real vs ' + rotulos.mes + ' projetado',
      sec_title_sugestoes: 'sugestões estratégicas para ' + rotulos.mes,
      footer_linha1: texto_(ia.footer_linha1),
      footer_linha2: texto_(ia.footer_linha2),
      footer_linha3: texto_(ia.footer_linha3)
    },
    times: times,
    semanas: montarSemanas_(fontes.semanas || [], fontes.semanaTags || []),
    dias: montarDias_(fontes.diasPrevisao || [], porDia, hoje),
    sugestoes: montarSugestoes_(fontes.sugestoes || []),
    gargalos: montarGargalos_(fontes.gargalos || [])
  };
}

/* ---------- comparação campo a campo (usada por validarContraJson) ---------- */

// Diferenças que têm motivo conhecido. Qualquer outra indica regra replicada errada.
function motivoConhecido_(caminho, novo, json, hoje) {
  var ultimo = diasNoMes_(hoje.ano, hoje.mes), ant = mesAnterior_(hoje.ano, hoje.mes);
  if (caminho === 'meta.status_dias' && hoje.dia >= ultimo - 1) return 'Corrigido: nos 2 últimos dias do mês a planilha escrevia intervalos como "Dias 32 à 31".';
  if (caminho === 'meta.kpi_realizado_sub' && hoje.dia === 1) return 'Corrigido: no dia 1 a planilha escrevia "dias 1 à 31".';
  if (/^times\.[^.]+\.mes_passado$/.test(caminho) && hoje.dia > diasNoMes_(ant.ano, ant.mes)) {
    return 'Corrigido: quando o mês anterior é mais curto, o "até hoje" da planilha passava para o mês seguinte.';
  }
  if (caminho === 'meta.atualizado_em') return 'Horário da leitura.';
  if (caminho === 'meta.kpi_ativos') return 'Pedido da Brianna: conta quem vendeu (a planilha contava os checkboxes da Jornada de Estrelas).';
  if (caminho === 'meta.kpi_realizado_delta') return 'Corrigido: a planilha dividia por 390 fixo; agora é o central da previsão.';
  if (caminho === 'meta.kpi_realizado' || /^times\.[^.]+\.(mes_atual_total|dias_confirmados_val)$/.test(caminho) || /^times\.[^.]+\.sellers\[.*\]\.2$/.test(caminho)) {
    return 'Vendas que entraram na planilha depois do horário do JSON.';
  }
  if (/^times\.[^.]+\.ativos$/.test(caminho)) return 'Corrigido: a fórmula somava nomes que contêm as letras da chave; agora são as pessoas que venderam.';
  if (/^times\.[^.]+\.nome$/.test(caminho)) return 'Campo novo: os cards são gerados a partir dos times.';
  if (/^times\.stl(\.|$)/.test(caminho)) return 'A Stella tem as duas grafias reunidas; no JSON o filtro do mês passado excluía "Stella Niehues".';
  if (/^dias\[\d+\]\.5$/.test(caminho) && (json === 'real' || json === 'partial')) {
    return 'O JSON herdava o tipo de execuções anteriores, inclusive de outro mês; agora vem da previsão e das vendas do mês.';
  }
  if (/^dias\[\d+\]\.7$/.test(caminho)) {
    return novo === null
      ? 'O JSON mantinha o realizado do mês anterior em dias ainda sem venda neste mês.'
      : 'Realizado do dia: vendas que entraram depois do horário do JSON.';
  }
  return '';
}

function ordenarSellersParaComparar_(obj) {
  var copia = JSON.parse(JSON.stringify(obj));
  Object.keys(copia.times || {}).forEach(function (k) {
    (copia.times[k].sellers || []).sort(function (a, b) { return String(a[0]) < String(b[0]) ? -1 : 1; });
  });
  return copia;
}

// Devolve { esperadas: [{caminho, novo, json, motivo}], inesperadas: [{caminho, novo, json}], campos: n }.
function compararForecast_(novoObj, jsonObj, hoje) {
  var saida = { esperadas: [], inesperadas: [], campos: 0 };
  var registrar = function (caminho, n, j) {
    var motivo = motivoConhecido_(caminho, n, j, hoje);
    var item = { caminho: caminho, novo: n === undefined ? '(não existe)' : n, json: j === undefined ? '(não existe)' : j };
    if (motivo) { item.motivo = motivo; saida.esperadas.push(item); } else saida.inesperadas.push(item);
  };
  var visitar = function (n, j, caminho) {
    var nObj = n !== null && typeof n === 'object', jObj = j !== null && typeof j === 'object';
    if (nObj && jObj && Array.isArray(n) === Array.isArray(j)) {
      var chaves = {};
      Object.keys(n).concat(Object.keys(j)).forEach(function (k) { chaves[k] = true; });
      Object.keys(chaves).forEach(function (k) {
        var filho = Array.isArray(n) ? caminho + '[' + k + ']' : (caminho ? caminho + '.' + k : k);
        if (/\]$/.test(caminho) && Array.isArray(n)) filho = caminho + '.' + k;
        visitar(n[k], j[k], filho);
      });
      return;
    }
    saida.campos++;
    if (n === j) return;
    registrar(caminho, n, j);
  };
  // caminhos de dias e sellers ficam no formato dias[3].7 e times.isr.sellers[2].1
  var normal = function (o) { return ordenarSellersParaComparar_(o); };
  visitar(normal(novoObj), normal(jsonObj), '');
  return saida;
}
