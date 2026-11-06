/* ------------------------------------------------------------------
   MÉTRICAS DO FORECAST — contas (funções puras, sem API do Google).
   Tiram os prints que a Brianna mandava para a IA: entra o que foi lido
   das bases, sai cada seção do pacote. A leitura, o pacote salvo, a página
   e o endereço do plugin ficam em MetricasServidor.gs. Regras: CLAUDE.md.
   ------------------------------------------------------------------ */

var METRICAS = {
  DIAS_SEMANA: ['1-Seg.', '2-Ter.', '3-Qua.', '4-Qui.', '5-Sex.', '6-Sáb.', '7-Dom.'],
  MESES_MATRIZ: 13,   // meses antes do atual na matriz de vendas (a tabela 3.1 da Verificação Estrelas mostra o mesmo)
  // mesma ordem de classificar_() e CONSULTA_CANAIS no dash de leads; os 5 primeiros são os de marketing
  CANAIS: ['Google Ads', 'SEO', 'Influencer', 'Social Ads', 'Outros de MKT', 'Indicação', 'Prospecção', 'Parceiros', 'Outros canais'],
  QTD_CANAIS_MKT: 5,
  MAX_CICLO: 15       // na distribuição do ciclo, os demais valores viram "Outros"
};

/* ---------- ajudantes ---------- */

function mesRefDoDia_(hoje) { return hoje.ano + '-' + pad2_(hoje.mes); }

function somarMeses_(mesRef, n) {
  var a = +mesRef.slice(0, 4), m = +mesRef.slice(5, 7) - 1 + n;
  var d = new Date(Date.UTC(a, m, 1));
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1);
}

// 1 = segunda ... 7 = domingo
function diaDaSemana_(ano, mes, dia) {
  var w = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
  return w === 0 ? 7 : w;
}

function arred_(x, casas) {
  if (x === null || x === undefined || !isFinite(x)) return null;
  var f = Math.pow(10, casas === undefined ? 2 : casas);
  return Math.round(x * f) / f;
}
function razao_(a, b, casas) { return b ? arred_(a / b, casas === undefined ? 4 : casas) : null; }
function preenchido_(v) { return v !== null && v !== undefined && String(v).trim() !== ''; }

// Número de uma célula: 3, "3", "3,5", "1.234,5". Vazio ou texto vira null.
function numeroCelula_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return null;
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  var n = Number(s);
  return isNaN(n) ? null : n;
}

// Mês de uma célula da aba de metas: AAAA-MM, MM/AAAA, AAAA-MM-DD ou DD/MM/AAAA. Fora disso, ''.
function normalizarMes_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})(-\d{1,2})?/);
  if (m) return m[1] + '-' + pad2_(+m[2]);
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return m[2] + '-' + pad2_(+m[1]);
  m = s.match(/^\d{1,2}\/(\d{1,2})\/(\d{4})/);
  if (m) return m[2] + '-' + pad2_(+m[1]);
  return '';
}

// Coluna FORA DA CATRACA da aba de metas: S = fora, N = dentro. Vazio ou outro valor: não informado.
function foraDaCatraca_(v) {
  var s = semAcento_(v);
  if (s === 's' || s === 'sim') return true;
  if (s === 'n' || s === 'nao') return false;
  return null;
}

// Dias entre duas datas AAAA-MM-DD; null se faltar alguma
function diasEntre_(de, ate) {
  if (!de || !ate) return null;
  var dia = function (s) { return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); };
  return (dia(ate) - dia(de)) / 86400000;
}

// Normaliza textos que se repetem em muitas linhas uma vez só (a base tem 90 mil linhas)
function normalizadorMemo_() {
  var memo = {};
  return function (v) {
    var k = String(v === null || v === undefined ? '' : v);
    if (memo[k] === undefined) memo[k] = semAcento_(k);
    return memo[k];
  };
}

// Listas de {chave, qtd} em ordem decrescente, com a participação no total
function comPercentual_(mapa, nomeChave) {
  var total = Object.keys(mapa).reduce(function (s, k) { return s + mapa[k]; }, 0);
  return Object.keys(mapa).map(function (k) {
    var o = {};
    o[nomeChave] = k;
    o.qtd = mapa[k];
    o.pct = razao_(mapa[k], total);
    return o;
  }).sort(function (a, b) { return b.qtd - a.qtd; });
}

/* ---------- vendas: matriz de 12 meses ---------- */

/* vendas = [{ id, consultor, produtoMeta, data:'AAAA-MM-DD', area, status, contar, gerente, cargo, nivel, contratacao, desligamento }]
   Regra da tabela "Resultados vendas últimos 12 meses" (3.1 da Verificação Estrelas):
   soma de CONTAR_VENDA por mês e dia pela DATA_PAGAMENTO, PRODUTO_CONTA_META = Sim, CONTAR_VENDA = 1.
   Backoffice entra (a IA sempre vê) e vem também em separado; estornos não são retirados. */
function vendaDaMatriz_(v) {
  return String(v.produtoMeta).trim() === 'Sim' && String(v.contar).trim() === '1' && !!v.data;
}

function metricasMatriz_(vendas, hoje) {
  var atual = mesRefDoDia_(hoje), meses = [], porMes = {};
  for (var i = METRICAS.MESES_MATRIZ; i >= 0; i--) {
    var ref = somarMeses_(atual, -i);
    meses.push(ref);
    var dias = [];
    for (var d = 0; d < 31; d++) dias.push(0);
    porMes[ref] = { mes: ref, dias: dias, total: 0, backoffice: 0 };
  }
  vendas.forEach(function (v) {
    if (!vendaDaMatriz_(v)) return;
    var x = porMes[v.data.slice(0, 7)];
    if (!x) return;
    x.dias[parseInt(v.data.slice(8), 10) - 1]++;
    x.total++;
    if (ehBackoffice_(v.area)) x.backoffice++;
  });
  return {
    mes_atual_em_andamento: atual,
    meses: meses.map(function (m) {
      var x = porMes[m];
      return { mes: m, total: x.total, backoffice: x.backoffice, pct_backoffice: razao_(x.backoffice, x.total), dias: x.dias };
    })
  };
}

/* ---------- vendas: média por dia da semana ---------- */

// Fórmula da tabela: ID_LEAD diferentes ÷ quantas vezes aquele dia da semana aconteceu no mês
// (no mês corrente, só até hoje).
function ocorrenciasDiaSemana_(ano, mes, dow, hoje) {
  var fim = (ano === hoje.ano && mes === hoje.mes) ? hoje.dia : diasNoMes_(ano, mes);
  var primeira = 1 + ((dow - diaDaSemana_(ano, mes, 1)) % 7 + 7) % 7;
  return primeira > fim ? 0 : Math.floor((fim - primeira) / 7) + 1;
}

function metricasDiaSemana_(vendas, hoje) {
  var atual = mesRefDoDia_(hoje), meses = [], porMes = {};
  for (var i = METRICAS.MESES_MATRIZ; i >= 0; i--) {
    var ref = somarMeses_(atual, -i);
    meses.push(ref);
    porMes[ref] = [{}, {}, {}, {}, {}, {}, {}];
  }
  vendas.forEach(function (v) {
    if (!vendaDaMatriz_(v) || !v.id) return;
    var x = porMes[v.data.slice(0, 7)];
    if (!x) return;
    x[diaDaSemana_(+v.data.slice(0, 4), +v.data.slice(5, 7), +v.data.slice(8, 10)) - 1][v.id] = 1;
  });
  var linhas = meses.map(function (m) {
    var ano = +m.slice(0, 4), mes = +m.slice(5, 7);
    var qtd = porMes[m].map(function (ids) { return Object.keys(ids).length; });
    var vezes = qtd.map(function (q, k) { return ocorrenciasDiaSemana_(ano, mes, k + 1, hoje); });
    var medias = qtd.map(function (q, k) { return vezes[k] ? q / vezes[k] : 0; });
    // como a tabela: dia da semana sem nenhuma venda fica em branco e não entra na média de 2ª a 6ª
    var uteis = medias.slice(0, 5).filter(function (x, k) { return qtd[k] > 0; });
    return {
      mes: m, vendas: qtd, vezes_no_mes: vezes,
      medias: medias.map(function (x) { return arred_(x, 1); }),
      media_2a_6a: uteis.length ? arred_(uteis.reduce(function (s, x) { return s + x; }, 0) / uteis.length, 1) : null,
      _brutas: medias
    };
  });
  var fechados = linhas.slice(0, -1);
  var mediaDe = function (lista) {
    return METRICAS.DIAS_SEMANA.map(function (n, k) {
      var q = 0, v = 0;
      lista.forEach(function (l) { q += l.vendas[k]; v += l.vezes_no_mes[k]; });
      return v ? q / v : 0;
    });
  };
  var m12 = mediaDe(fechados.slice(-12)), m6 = mediaDe(fechados.slice(-6));
  var soma12 = m12.reduce(function (s, x) { return s + x; }, 0);
  linhas.forEach(function (l) { delete l._brutas; });
  return {
    dias_semana: METRICAS.DIAS_SEMANA,
    media_12_meses: m12.map(function (x) { return arred_(x, 1); }),
    media_6_meses: m6.map(function (x) { return arred_(x, 1); }),
    representacao_na_semana: m12.map(function (x) { return razao_(x, soma12); }),
    meses: linhas
  };
}

/* ---------- vendas: desempenho de cada vendedor ---------- */

/* Quem aparece nesta lista e de que time.
   cadastros = aba TIMES ATUAIS: gerente atual, cargo, área e status de hoje. Vale mais que as vendas.
   vendas    = todas as vendas do histórico: a linha mais recente dá os dados de quem não está na TIMES ATUAIS.
   metas     = [{ mes:'AAAA-MM', pessoa, meta, fora }]. Fora da catraca vem da coluna da aba: meta 0 sozinha não quer dizer fora.
   Entra quem tem meta, quem vendeu nos 3 meses ou quem está na TIMES ATUAIS ativo, sempre sem backoffice, sem "SEM GERENTE"
   e sem nome de teste, coordenador ou franquia. Quem tem meta entra de qualquer jeito: a aba é escolha da Brianna.
   As vendas de quem fica de fora continuam em vendas_matriz. Regra das vendas: vendaConta_. */
function passaNosVendedores_(p, exigirAtivo) {
  if (ehBackoffice_(p.area)) return false;
  var gerente = semAcento_(p.gerente_atual);
  if (!gerente || gerente === 'sem gerente') return false;
  if (/teste|coordenador|franquia/.test(semAcento_(p.nome))) return false;
  return !exigirAtivo || String(p.statusUsr).trim() === '1';
}

function metricasVendedores_(vendas, metas, hoje, cadastros) {
  var atual = mesRefDoDia_(hoje), passado = somarMeses_(atual, -1), retrasado = somarMeses_(atual, -2);
  var pessoas = {};
  var pessoa = function (nome) {
    var k = semAcento_(nome);
    if (!pessoas[k]) pessoas[k] = { nome: String(nome).trim(), ultima: '', noCadastro: false, gerente_atual: '', cargo: '', nivel: '', area: '', statusUsr: '', contratacao: '', desligamento: '', ids: {}, metas: {}, fora: {}, temMeta: false };
    return pessoas[k];
  };
  var copiar = function (p, v) {
    p.gerente_atual = v.gerente || p.gerente_atual; p.cargo = v.cargo || p.cargo; p.nivel = v.nivel || p.nivel; p.area = v.area || p.area;
    p.statusUsr = v.statusUsr; p.contratacao = v.contratacao || p.contratacao; p.desligamento = v.desligamento || '';
  };
  vendas.forEach(function (v) {
    if (!v.consultor || !v.data) return;
    var p = pessoa(v.consultor);
    if (v.data >= p.ultima) { p.ultima = v.data; copiar(p, v); }
    var m = v.data.slice(0, 7);
    if ((m === atual || m === passado || m === retrasado) && vendaConta_(v)) (p.ids[m] = p.ids[m] || {})[v.id] = 1;
  });
  (cadastros || []).forEach(function (c) {
    if (!c.consultor) return;
    var p = pessoa(c.consultor);
    // a TIMES ATUAIS repete pessoas: vale a primeira linha que passa nos filtros
    var linha = { nome: p.nome, area: c.area, gerente_atual: c.gerente, statusUsr: c.statusUsr };
    if (!p.noCadastro || (!passaNosVendedores_(p, true) && passaNosVendedores_(linha, true))) copiar(p, c);
    p.noCadastro = true;
  });
  (metas || []).forEach(function (l) {
    if (!l.pessoa || (l.mes !== atual && l.mes !== passado)) return;
    var p = pessoa(l.pessoa);
    p.temMeta = true;
    if (l.meta !== null && l.meta !== undefined) p.metas[l.mes] = l.meta;
    if (l.fora !== null && l.fora !== undefined) p.fora[l.mes] = l.fora;
  });
  var qtd = function (p, m) { return p.ids[m] ? Object.keys(p.ids[m]).length : 0; };
  var meta = function (p, m) { return p.metas[m] === undefined ? null : p.metas[m]; };
  var lista = Object.keys(pessoas).map(function (k) { return pessoas[k]; });
  var linhas = lista.filter(function (p) {
    if (p.temMeta) return true;
    if (p.noCadastro && passaNosVendedores_(p, true)) return true;
    return qtd(p, atual) + qtd(p, passado) + qtd(p, retrasado) > 0 && passaNosVendedores_(p, false);
  }).map(function (p) {
    var metaPassado = meta(p, passado), metaAtual = meta(p, atual);
    return {
      nome: p.nome, gerente_atual: p.gerente_atual, cargo: p.cargo, nivel: p.nivel, area: p.area,
      contratacao: p.contratacao, desligamento: p.desligamento,
      vendas_retrasado: qtd(p, retrasado), vendas_passado: qtd(p, passado), meta_passado: metaPassado,
      pct_meta_passado: metaPassado ? razao_(qtd(p, passado), metaPassado) : null,
      vendas_atual: qtd(p, atual), meta_atual: metaAtual,
      fora_da_catraca: p.fora[atual] === undefined ? null : p.fora[atual]
    };
  }).sort(function (a, b) {
    if (!a.gerente_atual !== !b.gerente_atual) return a.gerente_atual ? -1 : 1;   // sem gerente vai para o fim
    return a.gerente_atual < b.gerente_atual ? -1 : a.gerente_atual > b.gerente_atual ? 1 : b.vendas_passado - a.vendas_passado;
  });
  return {
    mes_atual: atual, mes_passado: passado, mes_retrasado: retrasado, tem_metas: !!(metas && metas.length), linhas: linhas,
    // nome da aba de metas que não aparece em nenhuma venda nem na TIMES ATUAIS: quase sempre grafia diferente
    metas_sem_cadastro: lista.filter(function (p) { return p.temMeta && !p.ultima && !p.noCadastro; }).map(function (p) { return p.nome; })
  };
}

/* ---------- funil, ciclo, losts e pipeline (dados_funil) ---------- */

/* t = { n, id_lead:[], consultor:[], gerente:[], criado_em:[], data_perda:[], competencia_venda:[], etapa:[], fase:[],
         finalizacao:[], mql:[], prospeccao:[], oportunidades:[], documentacao:[], pagamento:[], ganho:[],
         data_funil_comercial:[], CONTAR_VENDA:[], AREA:[], PRODUTO_CONTA_META:[], CICLO_VENDA_ATE_SER_PAGO:[] }
   Filtros (os do relatório do funil): AREA sem "Backoffice", PRODUTO_CONTA_META Sim ou "Produto ainda não definido",
   finalização diferente de Interesse em Parceria. Mês pela data_funil_comercial. */
var ETAPAS_FUNIL = ['mql', 'prospeccao', 'oportunidades', 'documentacao', 'pagamento', 'ganho'];

function novoFunil_() {
  var f = {};
  ETAPAS_FUNIL.forEach(function (e) { f[e] = {}; });
  return f;
}

function contagemFunil_(f) {
  var o = {};
  ETAPAS_FUNIL.forEach(function (e) { o[e] = Object.keys(f[e]).length; });
  o.tx_mql_prospeccao = razao_(o.prospeccao, o.mql);
  o.tx_prospeccao_oportunidades = razao_(o.oportunidades, o.prospeccao);
  o.tx_oportunidades_documentacao = razao_(o.documentacao, o.oportunidades);
  o.tx_documentacao_pagamento = razao_(o.pagamento, o.documentacao);
  o.tx_pagamento_ganho = razao_(o.ganho, o.pagamento);
  o.tx_mql_ganho = razao_(o.ganho, o.mql);
  o.tx_prospeccao_ganho = razao_(o.ganho, o.prospeccao);
  return o;
}

function metricasFunil_(t, hoje) {
  var norm = normalizadorMemo_();
  var data = {};   // datas repetem muito: normaliza cada texto uma vez
  var dataDe = function (v) { var k = String(v); if (data[k] === undefined) data[k] = normalizarData_(v); return data[k]; };
  var passado = somarMeses_(mesRefDoDia_(hoje), -1);
  var meses = {}, pipeEtapa = {}, pipeGerente = {}, pipeConsultor = {}, pipeTotal = {}, porConsultor = {};
  var mesDe = function (m) {
    if (!meses[m]) meses[m] = { funil: novoFunil_(), somaCiclo: 0, nCiclo: 0, ciclo: {}, losts: 0, somaLost: 0, nLost: 0, fases: {}, etapasFases: {} };
    return meses[m];
  };
  for (var i = 0; i < t.n; i++) {
    if (norm(t.AREA[i]).indexOf('backoffice') >= 0) continue;
    var prod = norm(t.PRODUTO_CONTA_META[i]);
    if (prod !== 'sim' && prod !== 'produto ainda nao definido') continue;
    var fin = norm(t.finalizacao[i]);
    if (fin === 'interesse em parceria') continue;

    if (fin === 'pipeline' && preenchido_(t.id_lead[i])) {
      var idp = String(t.id_lead[i]), etp = String(t.etapa[i] || '(sem etapa)').trim();
      pipeTotal[idp] = 1;
      (pipeEtapa[etp] = pipeEtapa[etp] || {})[idp] = 1;
      var ger = String(t.gerente[i] || '(sem gerente)').trim();
      (pipeGerente[ger] = pipeGerente[ger] || {})[idp] = 1;
      var cons = String(t.consultor[i] || '(sem consultor)').trim();
      (pipeConsultor[cons] = pipeConsultor[cons] || {})[idp] = 1;
    }

    var dF = dataDe(t.data_funil_comercial[i]);
    if (!dF) continue;
    var ref = dF.slice(0, 7), x = mesDe(ref);
    var contaGanho = String(t.CONTAR_VENDA[i]).trim() === '1';
    ETAPAS_FUNIL.forEach(function (e) {
      var v = t[e][i];
      if (!preenchido_(v)) return;
      if (e === 'ganho' && !contaGanho) return;
      x.funil[e][String(v)] = 1;
    });
    if (ref === passado) {
      var nomeC = String(t.consultor[i] || '').trim();
      if (nomeC) {
        var c = porConsultor[nomeC] || (porConsultor[nomeC] = { funil: novoFunil_(), losts: {} });
        ETAPAS_FUNIL.forEach(function (e) {
          var v = t[e][i];
          if (!preenchido_(v)) return;
          if (e === 'ganho' && !contaGanho) return;
          c.funil[e][String(v)] = 1;
        });
        if (fin.indexOf('perda') >= 0 && preenchido_(t.id_lead[i])) c.losts[String(t.id_lead[i])] = 1;
      }
    }

    var cicloN = numeroCelula_(t.CICLO_VENDA_ATE_SER_PAGO[i]);
    // Média de dias até 100% pago: média do ciclo onde há ganho
    if (preenchido_(t.ganho[i]) && cicloN !== null) { x.somaCiclo += cicloN; x.nCiclo++; }
    // Distribuição do ciclo: pagamento diferentes por dias, com competência depois de 01/01/2017
    var comp = dataDe(t.competencia_venda[i]);
    if (preenchido_(t.pagamento[i]) && comp && comp > '2017-01-01') {
      var rot = cicloN === null ? '(vazio)' : String(cicloN);
      (x.ciclo[rot] = x.ciclo[rot] || {})[String(t.pagamento[i])] = 1;
    }
    // Losts: finalização contém "perda". Contagem de registros, como o relatório.
    if (fin.indexOf('perda') >= 0) {
      x.losts++;
      var fase = String(t.fase[i] || '(sem motivo)').trim(), etapa = String(t.etapa[i] || '(sem etapa)').trim();
      x.fases[fase] = (x.fases[fase] || 0) + 1;
      var chaveEF = etapa + '|' + fase;
      x.etapasFases[chaveEF] = (x.etapasFases[chaveEF] || 0) + 1;
      var dias = diasEntre_(dataDe(t.criado_em[i]), dataDe(t.data_perda[i]));
      if (dias !== null) { x.somaLost += dias; x.nLost++; }
    }
  }

  var ordenados = Object.keys(meses).sort();
  var qtdMapa = function (m) { var o = {}; Object.keys(m).forEach(function (k) { o[k] = Object.keys(m[k]).length; }); return o; };
  return {
    funil: {
      meses: ordenados.map(function (m) {
        var o = contagemFunil_(meses[m].funil);
        o.mes = m;
        o.losts = meses[m].losts;
        return o;
      }),
      por_consultor_mes_passado: {
        mes: passado,
        linhas: Object.keys(porConsultor).map(function (n) {
          var o = contagemFunil_(porConsultor[n].funil);
          o.consultor = n;
          o.losts = Object.keys(porConsultor[n].losts).length;
          return o;
        }).sort(function (a, b) { return b.mql - a.mql; })
      }
    },
    ciclo_e_lost: {
      meses: ordenados.map(function (m) {
        var x = meses[m], ciclo = comPercentual_(qtdMapa(x.ciclo), 'dias');
        var resto = ciclo.slice(METRICAS.MAX_CICLO);
        var topo = ciclo.slice(0, METRICAS.MAX_CICLO);
        if (resto.length) {
          topo.push({ dias: 'Outros', qtd: resto.reduce(function (s, r) { return s + r.qtd; }, 0), pct: arred_(resto.reduce(function (s, r) { return s + (r.pct || 0); }, 0), 4) });
        }
        return {
          mes: m,
          media_dias_ate_100_pago: x.nCiclo ? arred_(x.somaCiclo / x.nCiclo, 2) : null,
          media_dias_ate_lost: x.nLost ? arred_(x.somaLost / x.nLost, 2) : null,
          losts: x.losts,
          ciclo_de_venda: topo,
          motivos_de_lost: comPercentual_(x.fases, 'motivo'),
          motivos_por_etapa: comPercentual_(x.etapasFases, 'etapa_motivo').map(function (l) {
            var p = l.etapa_motivo.split('|');
            return { etapa: p[0], motivo: p.slice(1).join('|'), qtd: l.qtd, pct: l.pct };
          })
        };
      })
    },
    pipeline: {
      total: Object.keys(pipeTotal).length,
      por_etapa: comPercentual_(qtdMapa(pipeEtapa), 'etapa').sort(function (a, b) { return a.etapa < b.etapa ? -1 : 1; }),
      por_gerente: comPercentual_(qtdMapa(pipeGerente), 'gerente'),
      por_consultor: comPercentual_(qtdMapa(pipeConsultor), 'consultor')
    }
  };
}

/* ---------- jurídico (dados_jurídico_resumido) ---------- */

/* t = { n, ID_PROCESSO, PRODUTO_CONTA_META, 'STATUS PROCESSO', DATA_PENDENTE_JURIDICO, DATA_INICIO_REGISTRO, DATA_PROTOCOLADO_ANOTACOES,
         QTD_DOCUMENTOS_INCOMPLETOS, QUEM_ENVIOU_PENDENTE_JURIDICO, Gerente, TEMPO_UTIL_SEGUNDOS_INICIO_ATE_PROTOCOLADO,
         TEMPO_PENDENTE_JURIDICO_ATE_INICIO_REGISTRO }
   Cada indicador pela própria data. Docs incompletos: pelos processos que passaram em pendente jurídico no mês. */
function metricasJuridico_(t, hoje) {
  var norm = normalizadorMemo_();
  var passado = somarMeses_(mesRefDoDia_(hoje), -1);
  var meses = {}, semProtocolo = {}, pessoas = {}, iniciadosPorDia = {};
  var mesDe = function (m) {
    if (!meses[m]) meses[m] = { pend: {}, ini: {}, prot: {}, docs: 0, comDocs: {}, somaPI: 0, nPI: 0, somaIP: 0, nIP: 0 };
    return meses[m];
  };
  var pessoa = function (n, g) {
    var k = String(n || '(sem nome)').trim();
    if (!pessoas[k]) pessoas[k] = { nome: k, gerente: String(g || '').trim(), processos: {}, docs: 0, comDocs: {}, soma: 0, n: 0 };
    return pessoas[k];
  };
  for (var i = 0; i < t.n; i++) {
    var id = t.ID_PROCESSO[i];
    if (!preenchido_(id)) continue;
    id = String(id);
    var prod = norm(t.PRODUTO_CONTA_META[i]);
    if (prod !== 'sim' && prod !== 'produto ainda nao definido') continue;
    var dPend = normalizarData_(t.DATA_PENDENTE_JURIDICO[i]);
    var dIni = normalizarData_(t.DATA_INICIO_REGISTRO[i]);
    var dProt = normalizarData_(t.DATA_PROTOCOLADO_ANOTACOES[i]);
    var docs = numeroCelula_(t.QTD_DOCUMENTOS_INCOMPLETOS[i]) || 0;
    if (!dProt) semProtocolo[id] = 1;
    if (dPend) {
      var mp = mesDe(dPend.slice(0, 7));
      if (!mp.pend[id]) {   // processo repetido na base soma os documentos uma vez só
        mp.pend[id] = 1;
        mp.docs += docs;
        if (docs > 0) mp.comDocs[id] = 1;
      }
      if (dPend.slice(0, 7) === passado) {
        var p = pessoa(t.QUEM_ENVIOU_PENDENTE_JURIDICO[i], t.Gerente[i]);
        if (!p.processos[id]) {
          p.processos[id] = 1;
          p.docs += docs;
          if (docs > 0) p.comDocs[id] = 1;
          var seg = numeroCelula_(t.TEMPO_PENDENTE_JURIDICO_ATE_INICIO_REGISTRO[i]);
          if (seg !== null) { p.soma += seg; p.n++; }
        }
      }
    }
    if (dIni) {
      var mi = mesDe(dIni.slice(0, 7));
      if (!mi.ini[id]) {
        mi.ini[id] = 1;
        var sPI = numeroCelula_(t.TEMPO_PENDENTE_JURIDICO_ATE_INICIO_REGISTRO[i]);
        if (sPI !== null) { mi.somaPI += sPI; mi.nPI++; }
      }
      if (dIni.slice(0, 7) === passado) (iniciadosPorDia[dIni] = iniciadosPorDia[dIni] || {})[id] = 1;
    }
    if (dProt) {
      var mpr = mesDe(dProt.slice(0, 7));
      if (!mpr.prot[id]) {
        mpr.prot[id] = 1;
        var sIP = numeroCelula_(t.TEMPO_UTIL_SEGUNDOS_INICIO_ATE_PROTOCOLADO[i]);
        if (sIP !== null) { mpr.somaIP += sIP; mpr.nIP++; }
      }
    }
  }
  var horas = function (soma, n) { return n ? arred_(soma / n / 3600, 2) : null; };
  return {
    processos_sem_protocolo_hoje: Object.keys(semProtocolo).length,
    meses: Object.keys(meses).sort().map(function (m) {
      var x = meses[m], pend = Object.keys(x.pend).length;
      return {
        mes: m,
        passaram_pendente_juridico: pend,
        iniciar_registro: Object.keys(x.ini).length,
        documentos_incompletos: x.docs,
        protocolados: Object.keys(x.prot).length,
        tx_docs_por_processo: razao_(x.docs, pend, 2),
        pct_processos_com_docs_incompletos: razao_(Object.keys(x.comDocs).length, pend),
        horas_uteis_pendente_ate_iniciar: horas(x.somaPI, x.nPI),
        horas_uteis_iniciar_ate_protocolo: horas(x.somaIP, x.nIP)
      };
    }),
    por_vendedor_mes_passado: {
      mes: passado,
      linhas: Object.keys(pessoas).map(function (k) {
        var p = pessoas[k], n = Object.keys(p.processos).length;
        return {
          nome: p.nome, gerente: p.gerente, processos: n, documentos_incompletos: p.docs,
          tx_docs_por_processo: razao_(p.docs, n, 2),
          pct_com_docs_incompletos: razao_(Object.keys(p.comDocs).length, n),
          horas_uteis_ate_iniciar: horas(p.soma, p.n)
        };
      }).sort(function (a, b) { return b.documentos_incompletos - a.documentos_incompletos; })
    },
    iniciados_por_dia_mes_passado: Object.keys(iniciadosPorDia).sort().map(function (d) {
      return { dia: d, iniciados: Object.keys(iniciadosPorDia[d]).length };
    })
  };
}

/* ---------- leads por canal (respostas do painel de leads, uma por canal) ---------- */

/* respostas = [{ canal, linhas:[{ dia:'AAAA-MM-DD', leads:{atual}, vendas:{atual}, losts:{atual} }] }], na ordem de METRICAS.CANAIS */
function metricasLeads_(respostas) {
  var n = METRICAS.CANAIS.length, meses = {};
  var zeros = function () { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; };
  respostas.forEach(function (r) {
    var k = METRICAS.CANAIS.indexOf(r.canal);
    if (k < 0) return;
    (r.linhas || []).forEach(function (l) {
      var d = String(l.dia || ''), m = d.slice(0, 7);
      if (!m) return;
      var x = meses[m] || (meses[m] = { leads: zeros(), vendas: zeros(), losts: zeros(), dias: {} });
      var qtd = function (c) { return (l[c] && l[c].atual) || 0; };
      x.leads[k] += qtd('leads');
      x.vendas[k] += qtd('vendas');
      x.losts[k] += qtd('losts');
      var dd = d.slice(8, 10);
      (x.dias[dd] = x.dias[dd] || zeros())[k] += qtd('leads');
    });
  });
  var soma = function (a) { return a.reduce(function (s, v) { return s + v; }, 0); };
  var somaMkt = function (a) { return soma(a.slice(0, METRICAS.QTD_CANAIS_MKT)); };
  return {
    canais: METRICAS.CANAIS,
    obs: 'Listas por canal seguem a ordem de "canais". Marketing = os 5 primeiros. Semanas de segunda a domingo, cortadas nas pontas do mês.',
    meses: Object.keys(meses).sort().map(function (m) {
      var x = meses[m], ano = +m.slice(0, 4), mes = +m.slice(5, 7), semanas = [], atual = null;
      Object.keys(x.dias).sort().forEach(function (dd) {
        var dia = +dd, dow = diaDaSemana_(ano, mes, dia);
        var seg = dia - (dow - 1);
        if (!atual || atual.segunda !== seg) {
          atual = { segunda: seg, de: pad2_(Math.max(seg, 1)), ate: pad2_(Math.min(seg + 6, diasNoMes_(ano, mes))), leads_por_canal: zeros() };
          semanas.push(atual);
        }
        x.dias[dd].forEach(function (v, k) { atual.leads_por_canal[k] += v; });
      });
      return {
        mes: m,
        total_leads: soma(x.leads),
        leads_marketing: somaMkt(x.leads),
        leads_por_canal: x.leads,
        vendas_por_canal: x.vendas,
        losts_por_canal: x.losts,
        semanas: semanas.map(function (s) {
          return { de: s.de, ate: s.ate, total: soma(s.leads_por_canal), marketing: somaMkt(s.leads_por_canal), leads_por_canal: s.leads_por_canal };
        }),
        dias: x.dias
      };
    })
  };
}

/* ---------- indicadores da aba Métricas de alerta (resposta do plugin de consultas, compactada) ---------- */

function compactarIndicadores_(resposta, rotulos) {
  var legenda = resposta.legenda || {}, codigos = Object.keys(legenda);
  var linhas = (resposta.linhas || []).map(function (l) {
    var o = {};
    rotulos.forEach(function (r) { o[r] = l[r] === undefined ? '' : l[r]; });
    o.atual = codigos.map(function (c) { return l[c] ? l[c].atual : null; });
    o.comparativo = codigos.map(function (c) { return l[c] ? l[c].comparativo : null; });
    return o;
  }).filter(function (o) {
    return o.atual.concat(o.comparativo).some(function (v) { return v; });   // quem não teve movimento nos dois períodos sai
  });
  return {
    periodo: resposta.periodo, comparativo: resposta.comparativo,
    metricas: codigos.map(function (c) { return { codigo: c, nome: legenda[c] }; }),
    obs: '"atual" e "comparativo" seguem a ordem de "metricas".',
    linhas: linhas
  };
}
