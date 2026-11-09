/* ------------------------------------------------------------------
   PREVISÃO PELO PIPELINE — contas (funções puras, sem API do Google).
   Chance de cada lead aberta pagar nos próximos dias, pela etapa, pela idade
   (dias desde a criação) e pelo segmento (origem, campanha e keyword), aprendida
   com as leads dos últimos meses da dados_funil. Leitura e gravação em
   PipelineServidor.gs. Regras: CLAUDE.md, seção "Previsão pelo pipeline".

   Na base, data_funil_comercial é a data de finalização (ou hoje, se a lead está
   aberta) e não há data de entrada em cada etapa. Por isso a conta usa a idade da
   lead e, nas leads antigas, a etapa mais avançada a que ela chegou.
   ------------------------------------------------------------------ */

var PIPE = {
  VERSAO: 4,                            // mudou o formato do resultado: suba (o arquivo do dia em outra versão é refeito)
  JANELA_DIAS: 180,                       // leads criadas nesse período ensinam a conta
  // Idade exata até 29 dias; depois, faixas em que a chance muda pouco
  IDADES: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 45, 60, 90, 120, 180],
  FAIXAS_TABELA: [0, 1, 3, 7, 14, 30, 60, 120],   // colunas da tabela da página
  HORIZONTE: 31,                          // dias à frente em que a chance é medida
  MIN_RISCO: 30,                          // menos leads que isso numa célula: usa a idade anterior (ou a etapa anterior)
  PESO_SEGMENTO: 10,                      // quantas vendas esperadas o grupo de cima "vale" no encolhimento
  DIAS_NOVAS: 28,                         // janela para a média de leads novas por dia da semana
  DIAS_SEMANA: 84,                        // janela para o peso de cada dia da semana
  DIAS_TESTE: 20,                         // dias úteis do teste
  DIAS_POSICAO: 182,                      // janela para o peso do começo, do meio e do fim do mês
  DIAS_INICIO: 3,                         // primeiros dias úteis do mês
  DIAS_FIM: 5,                            // últimos dias úteis do mês (reta final)
  DIAS_HORA: 90,                          // janela para a curva de vendas ao longo do dia
  DIA_FIRME: 10,                          // pagamentos em um mesmo prazo para confiar nele sozinho; menos que isso divide com os dias próximos
  JANELA_SUAVE: 7,                        // até quantos dias para cada lado essa divisão vai
  CELULAS_POPUP: 3,                     // grupos (etapa × idade) mostrados na explicação de cada dia
  FAIXA_NORMAL: 0.15,                     // até 15% de diferença da média dos outros dias úteis: "perto da média"
  PICO_RAZAO: 2,                          // chance do dia N vezes maior que a dos dias vizinhos...
  PICO_VENDAS: 2,                         // ...e que soma pelo menos estas vendas a mais: vira ponto de atenção
  ETAPAS: { 1: 'MQL - Validação', 2: 'Prospecção', 3: 'Oportunidades', 4: 'Assinatura e pagamento' },
  GRUPOS: [
    { id: 'inicio', nome: 'Começo do funil (MQL e prospecção)', base: 1, etapas: [1, 2] },
    { id: 'fim', nome: 'Fim do funil (oportunidades e assinatura)', base: 3, etapas: [3, 4] }
  ]
};

var COLUNAS_PIPE = ['id_lead', 'criado_em', 'finalizacao', 'data_funil_comercial', 'etapa', 'mql', 'prospeccao', 'oportunidades',
  'documentacao', 'pagamento', 'CONTAR_VENDA', 'DATA_PAGAMENTO', 'AREA', 'PRODUTO_CONTA_META', 'origem_lead', 'campanha', 'PPC_KEYWORD'];

/* ---------- datas como número de dias ---------- */

function diaNum_(iso) { return iso ? Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000) : null; }
function isoDoNum_(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
function semanaDoNum_(n) { return ((n % 7) + 11) % 7; }   // 0 = domingo ... 6 = sábado (01/01/1970 foi quinta)

function faixaIdade_(idade) {
  var i = 0;
  while (i + 1 < PIPE.IDADES.length && PIPE.IDADES[i + 1] <= idade) i++;
  return i;
}

/* ---------- leads da base ---------- */

// t = colunas de COLUNAS_PIPE (lerColunasMetricas_). Mesmos filtros do funil: sem backoffice,
// produto Sim ou não definido, sem Interesse em Parceria. Uma linha por lead.
function leadsDoPipeline_(t) {
  var norm = normalizadorMemo_(), data = {};
  var dataDe = function (v) { var k = String(v); if (data[k] === undefined) data[k] = normalizarData_(v); return data[k]; };
  var marcas = ['mql', 'prospeccao', 'oportunidades', 'documentacao', 'pagamento'];
  var porId = {};
  for (var i = 0; i < t.n; i++) {
    var id = String(t.id_lead[i] === undefined ? '' : t.id_lead[i]).trim();
    if (!id) continue;
    if (norm(t.AREA[i]).indexOf('backoffice') >= 0) continue;
    var prod = norm(t.PRODUTO_CONTA_META[i]);
    if (prod !== 'sim' && prod !== 'produto ainda nao definido') continue;
    var fin = norm(t.finalizacao[i]);
    if (fin === 'interesse em parceria') continue;
    var criado = diaNum_(dataDe(t.criado_em[i]));
    if (criado === null) continue;

    var maxima = 0;
    marcas.forEach(function (m, k) { if (preenchido_(t[m][i])) maxima = k + 1; });
    var atual = parseInt(String(t.etapa[i] || ''), 10) || maxima || 1;
    var pago = fin.indexOf('ganho') === 0 && fin !== 'ganho cobranca' && String(t.CONTAR_VENDA[i]).trim() === '1' ? diaNum_(dataDe(t.DATA_PAGAMENTO[i])) : null;
    var aberta = fin === 'pipeline';
    var lead = {
      id: id,
      criado: criado,
      aberta: aberta,
      pago: pago,
      fim: aberta ? null : (pago !== null ? pago : diaNum_(dataDe(t.data_funil_comercial[i]))),
      etapaMax: Math.max(1, Math.min(4, Math.max(maxima, pago !== null ? 4 : 0))),
      etapaAtual: Math.max(1, Math.min(4, atual)),
      origem: String(t.origem_lead[i] || '').trim() || '(sem origem)',
      campanha: String(t.campanha[i] || '').trim() || '(sem campanha)',
      keyword: String(t.PPC_KEYWORD[i] || '').trim() || '(sem keyword)'
    };
    if (!aberta && lead.fim === null) continue;   // fechada sem data: não dá para usar
    var antes = porId[id];
    if (!antes || (lead.pago !== null && antes.pago === null)) porId[id] = lead;
  }
  return Object.keys(porId).map(function (k) { return porId[k]; });
}

/* ---------- chance por etapa, idade e dia à frente ---------- */

// Para cada lead ainda aberta no começo de uma faixa de idade: em quantos dias ela pagou (ou não), observando
// só dias já fechados (até ontem). Etapa s = a lead chegou pelo menos à etapa s.
function chancesPorEtapa_(leads, ontem) {
  var H = PIPE.HORIZONTE, F = PIPE.IDADES.length, obs = {}, ev = {};
  for (var s = 1; s <= 4; s++) {
    obs[s] = []; ev[s] = [];
    for (var f = 0; f < F; f++) { obs[s].push(zeros_(H)); ev[s].push(zeros_(H)); }
  }
  leads.forEach(function (l) {
    if (l.criado < ontem - PIPE.JANELA_DIAS) return;
    for (var f = 0; f < F; f++) {
      var inicio = l.criado + PIPE.IDADES[f];
      if (inicio > ontem) break;
      if (l.fim !== null && l.fim < inicio) break;
      var L = Math.min(H - 1, ontem - inicio);
      var d = l.pago !== null ? l.pago - inicio : -1;
      for (var s = 1; s <= l.etapaMax; s++) {
        obs[s][f][L]++;
        if (d >= 0 && d <= L) ev[s][f][d]++;
      }
    }
  });
  var h = {}, fonte = {};   // fonte: de quantas leads saiu cada chance (mostrado na explicação do dia)
  for (s = 1; s <= 4; s++) {
    h[s] = []; fonte[s] = [];
    for (f = 0; f < F; f++) {
      var risco = 0, linha = zeros_(H);
      for (var j = H - 1; j >= 0; j--) {
        risco += obs[s][f][j];
        linha[j] = { risco: risco, ev: ev[s][f][j] };
      }
      suavizarLinha_(linha);
      fonte[s].push(linha.map(function (c, j) {
        if (c.risco >= PIPE.MIN_RISCO || (s === 1 && f === 0)) return c;
        return f > 0 ? fonte[s][f - 1][j] : fonte[s - 1][f][j];
      }));
      h[s].push(fonte[s][f].map(function (c) { return c.taxa; }));
    }
  }
  h.fonte = fonte;
  return h;
}

// Poucos pagamentos em um prazo exato são acaso: 3 em 53 leads não querem dizer que aquele dia vende mais que os vizinhos.
// Prazo com pelo menos DIA_FIRME pagamentos fica como está. Os outros somam com os prazos próximos (também sem base firme),
// até juntar DIA_FIRME pagamentos ou chegar a JANELA_SUAVE dias para cada lado. O total da linha não muda: só a distribuição.
// Cada c ganha taxa (chance usada), pagaram e dias (o que entrou na conta, mostrado na explicação do dia).
function suavizarLinha_(linha) {
  var firme = function (c) { return c.ev >= PIPE.DIA_FIRME; };
  var antes = 0, depois = 0;
  linha.forEach(function (c, j) {
    c.taxa = c.risco ? c.ev / c.risco : 0;
    c.pagaram = c.ev;
    c.dias = 1;
    if (firme(c)) return;
    antes += c.taxa;
    var ev = c.ev, risco = c.risco, dias = 1;
    for (var k = 1; k <= PIPE.JANELA_SUAVE && ev < PIPE.DIA_FIRME; k++) {
      [linha[j - k], linha[j + k]].forEach(function (v) {
        if (!v || firme(v)) return;
        ev += v.ev;
        risco += v.risco;
        dias++;
      });
    }
    c.taxa = risco ? ev / risco : 0;
    c.pagaram = ev;
    c.dias = dias;
    depois += c.taxa;
  });
  if (!depois) return;
  linha.forEach(function (c) { if (!firme(c)) c.taxa *= antes / depois; });
}

function zeros_(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }
function somaAte_(lista, n) { var t = 0; for (var i = 0; i < n && i < lista.length; i++) t += lista[i]; return t; }

/* ---------- quanto cada segmento vende acima ou abaixo do esperado ---------- */

// Para cada grupo de etapas: vendas de verdade ÷ vendas esperadas pela chance média, por origem,
// origem + campanha e origem + campanha + keyword. Segmento pequeno puxa para o grupo de cima.
function multiplicadores_(leads, h, ontem) {
  var H = PIPE.HORIZONTE, saida = {};
  PIPE.GRUPOS.forEach(function (g) {
    var niveis = [{}, {}, {}];
    leads.forEach(function (l) {
      if (l.criado < ontem - PIPE.JANELA_DIAS || l.etapaMax < g.base) return;
      var chaves = chavesSegmento_(l);
      for (var f = 0; f < PIPE.IDADES.length; f++) {
        var inicio = l.criado + PIPE.IDADES[f];
        if (inicio > ontem || (l.fim !== null && l.fim < inicio)) break;
        var L = Math.min(H - 1, ontem - inicio);
        var esperado = somaAte_(h[g.base][f], L + 1);
        var vendeu = l.pago !== null && l.pago - inicio <= L ? 1 : 0;
        chaves.forEach(function (k, n) {
          var c = segmentoNovo_(niveis[n], k);
          c.esperado += esperado;
          c.vendas += vendeu;
        });
      }
      chaves.forEach(function (k, n) {
        var c = segmentoNovo_(niveis[n], k);   // lead criada hoje ainda não passou por nenhuma faixa
        c.leads[l.id] = 1;
        if (l.pago !== null) c.pagas[l.id] = 1;
      });
    });
    var mult = {};
    niveis.forEach(function (nivel, n) {
      Object.keys(nivel).forEach(function (k) {
        var c = nivel[k], pai = n === 0 ? 1 : mult[k.split(' › ').slice(0, n).join(' › ')] || 1;
        mult[k] = (c.vendas + PIPE.PESO_SEGMENTO * pai) / (c.esperado + PIPE.PESO_SEGMENTO);
      });
    });
    saida[g.id] = { mult: mult, niveis: niveis };
  });
  return saida;
}

function segmentoNovo_(nivel, k) {
  return nivel[k] || (nivel[k] = { leads: {}, pagas: {}, vendas: 0, esperado: 0 });
}

function chavesSegmento_(l) {
  return [l.origem, l.origem + ' › ' + l.campanha, l.origem + ' › ' + l.campanha + ' › ' + l.keyword];
}

function grupoDaEtapa_(etapa) {
  return PIPE.GRUPOS.filter(function (g) { return g.etapas.indexOf(etapa) >= 0; })[0];
}

/* ---------- peso dos dias da semana e leads novas ---------- */

// Venda em feriado conta como domingo
function pesosSemana_(leads, ontem, feriados) {
  var vendas = zeros_(7);
  leads.forEach(function (l) { if (l.pago !== null && l.pago > ontem - PIPE.DIAS_SEMANA && l.pago <= ontem) vendas[semanaComFeriado_(l.pago, feriados)]++; });
  var media = vendas.reduce(function (a, b) { return a + b; }, 0) / 7;
  return vendas.map(function (v) { return media ? v / media : 1; });
}

function diaUtil_(n, feriados) { var w = semanaDoNum_(n); return w !== 0 && w !== 6 && !feriados[n]; }

// Posição do dia útil no mês: 'inicio' (primeiros dias úteis), 'fim' (reta final) ou 'meio'. Fim de semana e feriado: null.
function posicaoNoMes_(n, feriados) {
  if (!diaUtil_(n, feriados)) return null;
  var iso = isoDoNum_(n), a = +iso.slice(0, 4), m = +iso.slice(5, 7);
  var ini = diaNum_(ymd_(a, m, 1)), fim = diaNum_(ymd_(a, m, diasNoMes_(a, m))), antes = 0, depois = 0;
  for (var d = ini; d < n; d++) if (diaUtil_(d, feriados)) antes++;
  for (d = n + 1; d <= fim; d++) if (diaUtil_(d, feriados)) depois++;
  if (depois < PIPE.DIAS_FIM) return 'fim';
  if (antes < PIPE.DIAS_INICIO) return 'inicio';
  return 'meio';
}

// Vendas por dia útil em cada posição ÷ vendas por dia útil em geral, nos últimos meses
function pesosPosicao_(leads, ontem, feriados) {
  var vendasDia = {};
  leads.forEach(function (l) { if (l.pago !== null && l.pago > ontem - PIPE.DIAS_POSICAO && l.pago <= ontem) vendasDia[l.pago] = (vendasDia[l.pago] || 0) + 1; });
  var soma = { inicio: 0, meio: 0, fim: 0 }, dias = { inicio: 0, meio: 0, fim: 0 }, total = 0, uteis = 0;
  for (var d = ontem - PIPE.DIAS_POSICAO + 1; d <= ontem; d++) {
    var p = posicaoNoMes_(d, feriados);
    if (!p) continue;
    soma[p] += vendasDia[d] || 0; dias[p]++; total += vendasDia[d] || 0; uteis++;
  }
  var media = uteis ? total / uteis : 0, pesos = {};
  Object.keys(soma).forEach(function (p) { pesos[p] = media && dias[p] ? arred_(soma[p] / dias[p] / media, 4) : 1; });
  return pesos;
}

// Peso de um dia: dia da semana × posição no mês (só nos dias úteis)
function pesoDoDia_(n, pesos, feriados) {
  var p = posicaoNoMes_(n, feriados);
  return pesos.semana[semanaComFeriado_(n, feriados)] * (p ? pesos.posicao[p] : 1);
}

// Minutos do dia (0 a 1439) em que as vendas recentes aconteceram, para saber quanto do dia ainda falta.
// t = colunas DATA_PAGAMENTO, HORA_PAGAMENTO, PRODUTO_CONTA_META e CONTAR_VENDA da aba de vendas.
// 00:00:00 e 08:00:00 são preenchimento das vendas antigas: ficam de fora.
function minutosDasVendas_(t, hojeN) {
  var saida = [];
  for (var i = 0; i < t.n; i++) {
    if (String(t.PRODUTO_CONTA_META[i]).trim() !== 'Sim' || String(t.CONTAR_VENDA[i]).trim() !== '1') continue;
    var d = diaNum_(normalizarData_(t.DATA_PAGAMENTO[i]));
    if (d === null || d < hojeN - PIPE.DIAS_HORA || d >= hojeN) continue;
    var h = t.HORA_PAGAMENTO[i], min = null;
    if (typeof h === 'number') min = Math.round(h * 1440) % 1440;
    else {
      var m = String(h || '').trim().match(/^(\d{1,2}):(\d{2})/);
      if (m) min = +m[1] * 60 + +m[2];
    }
    if (min === null || min === 0 || min === 480) continue;
    saida.push(min);
  }
  return saida;
}

// Parte das vendas do dia que costuma entrar depois de "agora" (minutos desde a meia-noite)
function fracaoRestante_(minutos, agora) {
  if (!minutos || minutos.length < 50) return null;
  return minutos.filter(function (m) { return m > agora; }).length / minutos.length;
}

function novasPorSemana_(leads, ontem) {
  var cont = zeros_(7), vezes = zeros_(7);
  for (var d = ontem - PIPE.DIAS_NOVAS + 1; d <= ontem; d++) vezes[semanaDoNum_(d)]++;
  leads.forEach(function (l) { if (l.criado > ontem - PIPE.DIAS_NOVAS && l.criado <= ontem) cont[semanaDoNum_(l.criado)]++; });
  return cont.map(function (c, w) { return vezes[w] ? c / vezes[w] : 0; });
}

// Dia da semana de um dia futuro, com feriado valendo como domingo
function semanaComFeriado_(n, feriados) { return feriados[n] ? 0 : semanaDoNum_(n); }

/* ---------- previsão ---------- */

// Vendas esperadas de amanhã até o dia "ate": das leads abertas hoje e das que ainda vão ser criadas.
function projetarDias_(abertas, h, pesos, novas, hojeN, ate, feriados) {
  var dias = [];
  for (var t = 1; hojeN + t <= ate && t < PIPE.HORIZONTE; t++) dias.push({ pipeline: 0, novas: 0 });
  abertas.forEach(function (l) {
    var f = faixaIdade_(hojeN - l.criado), m = l.mult;
    for (var t = 1; t <= dias.length; t++) dias[t - 1].pipeline += h[l.etapaAtual][f][t] * m;
  });
  for (var t = 1; t <= dias.length; t++) {
    for (var c = 1; c <= t; c++) dias[t - 1].novas += novas[semanaComFeriado_(hojeN + c, feriados)] * h[1][0][t - c];
  }
  return dias.map(function (d, k) {
    var n = hojeN + k + 1, w = pesoDoDia_(n, pesos, feriados);
    return { data: isoDoNum_(n), dia: +isoDoNum_(n).slice(8), pipeline: arred_(d.pipeline * w, 2), novas: arred_(d.novas * w, 2), total: arred_((d.pipeline + d.novas) * w, 2) };
  });
}

// Teste nos últimos dias úteis já fechados, sem etapa (a base não diz em que etapa a lead estava naquele dia):
// previsão dos 5 dias seguintes contra as vendas de verdade, e contra a média por dia da semana.
// As chances são aprendidas com a janela inteira, inclusive esses dias: o teste é um pouco otimista.
function testarPipeline_(leads, h, pesos, novas, ontem, feriados) {
  var linhas = [], mediaDia = zeros_(7), vezes = zeros_(7);
  for (var d = ontem - PIPE.DIAS_SEMANA + 1; d <= ontem; d++) vezes[semanaComFeriado_(d, feriados)]++;
  leads.forEach(function (l) { if (l.pago !== null && l.pago > ontem - PIPE.DIAS_SEMANA && l.pago <= ontem) mediaDia[semanaComFeriado_(l.pago, feriados)]++; });
  mediaDia = mediaDia.map(function (v, w) { return vezes[w] ? v / vezes[w] : 0; });

  for (var D = ontem - 5; D > ontem - 90 && linhas.length < PIPE.DIAS_TESTE; D--) {
    var w = semanaDoNum_(D);
    if (w === 0 || w === 6 || feriados[D]) continue;
    var abertas = leads.filter(function (l) { return l.criado <= D && (l.fim === null || l.fim > D); })
      .map(function (l) { return { criado: l.criado, etapaAtual: 1, mult: 1 }; });
    var prev = projetarDias_(abertas, h, pesos, novas, D, D + 5, feriados).reduce(function (s, x) { return s + x.total; }, 0);
    var real = leads.filter(function (l) { return l.pago !== null && l.pago > D && l.pago <= D + 5; }).length;
    var media = 0;
    for (var k = 1; k <= 5; k++) media += mediaDia[semanaComFeriado_(D + k, feriados)];
    linhas.push({ data: isoDoNum_(D), previsto: arred_(prev, 1), media_semana: arred_(media, 1), realizado: real });
  }
  var erro = function (campo) {
    var e = 0, r = 0;
    linhas.forEach(function (l) { e += Math.abs(l[campo] - l.realizado); r += l.realizado; });
    return r ? arred_(e / r, 4) : null;
  };
  return { dias: linhas.length, erro_pipeline: erro('previsto'), erro_media_semana: erro('media_semana'), linhas: linhas.reverse() };
}

/* ---------- de onde vem o número de cada dia (pop-up do gráfico) ---------- */

// Leads abertas agrupadas por etapa e faixa de idade: é nesse nível que a chance é a mesma
function celulasAbertas_(abertas, hojeN) {
  var mapa = {};
  abertas.forEach(function (l) {
    var f = faixaIdade_(hojeN - l.criado), k = l.etapaAtual + '|' + f;
    var c = mapa[k] || (mapa[k] = { etapa: l.etapaAtual, f: f, leads: 0, somaMult: 0 });
    c.leads++;
    c.somaMult += l.mult;
  });
  return Object.keys(mapa).map(function (k) { return mapa[k]; });
}

function rotuloIdade_(f) {
  var de = PIPE.IDADES[f], prox = PIPE.IDADES[f + 1];
  if (prox === undefined) return de + ' dias ou mais';
  if (prox === de + 1) return de === 1 ? '1 dia' : de + ' dias';
  return de + ' a ' + (prox - 1) + ' dias';
}

// Duas casas seriam ruído na tela: as partes inteiras somam exatamente o total mostrado (maior resto).
function repartirInteiros_(valores, total) {
  var saida = valores.map(function (v) { return Math.floor(v); });
  var falta = total - saida.reduce(function (a, b) { return a + b; }, 0);
  valores.map(function (v, i) { return { i: i, resto: v - Math.floor(v) }; })
    .sort(function (a, b) { return b.resto - a.resto; })
    .forEach(function (x) { if (falta > 0) { saida[x.i]++; falta--; } });
  return saida;
}

// Média da chance nos 2 dias antes e nos 2 depois, para saber se o dia destoa
function mediaVizinhos_(linha, t) {
  var soma = 0, n = 0;
  [-2, -1, 1, 2].forEach(function (d) {
    if (t + d >= 0 && t + d < linha.length) { soma += linha[t + d]; n++; }
  });
  return n ? soma / n : 0;
}

// Quanto cada etapa e cada grupo põe no dia t. fator = peso do calendário (e, hoje, a parte do dia que falta).
function composicaoDia_(cels, h, t, fator, novas) {
  var porEtapa = {}, lista = [];
  [1, 2, 3, 4].forEach(function (s) { porEtapa[s] = { etapa: PIPE.ETAPAS[s], leads: 0, vendas: 0 }; });
  cels.forEach(function (c) {
    var vendas = h[c.etapa][c.f][t] * c.somaMult * fator;
    porEtapa[c.etapa].leads += c.leads;
    porEtapa[c.etapa].vendas += vendas;
    lista.push({ c: c, vendas: vendas });
  });
  var celulas = lista.sort(function (a, b) { return b.vendas - a.vendas; }).slice(0, PIPE.CELULAS_POPUP)
    .filter(function (x) { return x.vendas >= 0.05; })
    .map(function (x) {
      var c = x.c, linha = h[c.etapa][c.f], chance = linha[t], viz = mediaVizinhos_(linha, t), base = h.fonte[c.etapa][c.f][t];
      return { etapa: PIPE.ETAPAS[c.etapa], idade: rotuloIdade_(c.f), leads: c.leads, chance: arred_(chance, 4), chance_vizinhos: arred_(viz, 4),
        multiplicador: arred_(c.somaMult / c.leads, 2), base_leads: base.risco, base_pagaram: base.pagaram === undefined ? base.ev : base.pagaram, base_dias: base.dias || 1, vendas: arred_(x.vendas, 2),
        pico: chance >= PIPE.PICO_RAZAO * viz && (chance - viz) * c.somaMult * fator >= PIPE.PICO_VENDAS };
    });
  return { etapas: [1, 2, 3, 4].map(function (s) { return porEtapa[s]; }), novas: novas, celulas: celulas };
}

function qtdVendas_(n) { return n + (n === 1 ? ' venda' : ' vendas'); }

// Dia da semana e posição no mês, em uma frase. Vazio quando não muda quase nada.
function fraseCalendario_(n, pesos, feriados) {
  if (feriados[n]) return 'Feriado: a conta usa o peso de um domingo, quando quase não há pagamento.';
  var w = semanaDoNum_(n);
  if (w === 0 || w === 6) return (w === 6 ? 'Sábado' : 'Domingo') + ': fim de semana tem poucas vendas.';
  var mediaUteis = somaAte_(pesos.semana.slice(1, 6), 5) / 5;
  var efeito = function (nome, f) {
    var pct = Math.round(Math.abs(f - 1) * 100);
    return pct < 3 ? null : nome + ' vende ' + pct + '% ' + (f > 1 ? 'mais' : 'menos') + ' que um dia útil médio';
  };
  var nomesPos = { inicio: 'O começo do mês', meio: 'O meio do mês', fim: 'A reta final do mês' };
  var pos = posicaoNoMes_(n, feriados);
  var partes = [efeito(['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'][w], mediaUteis ? pesos.semana[w] / mediaUteis : 1), efeito(nomesPos[pos], pesos.posicao[pos])]
    .filter(function (x) { return x; });
  return partes.length ? partes.join('; ') + '.' : '';
}

// Compara com a média dos outros dias úteis e separa o que veio das leads do que veio do calendário.
// item = { total, peso, comp }; outros = demais dias úteis no mesmo formato.
function fraseComparacao_(item, outros, frases) {
  if (!outros.length) return;
  var media = function (fn) { return outros.reduce(function (s, x) { return s + fn(x); }, 0) / outros.length; };
  var mediaTotal = media(function (x) { return x.total; });
  if (mediaTotal < 1) return;
  var dif = item.total - mediaTotal, mostraMedia = Math.round(mediaTotal);
  if (Math.abs(dif) / mediaTotal < PIPE.FAIXA_NORMAL) {
    frases.push('Perto dos outros dias úteis previstos, que têm em média ' + mostraMedia + ' vendas.');
    return;
  }
  var sobe = dif > 0;
  frases.push(qtdVendas_(Math.round(Math.abs(dif))) + (sobe ? ' acima' : ' abaixo') + ' da média dos outros dias úteis previstos (' + mostraMedia + ').');

  var mediaPeso = media(function (x) { return x.peso; });
  var mediaBase = media(function (x) { return x.peso ? x.total / x.peso : 0; });
  var base = item.peso ? item.total / item.peso : 0;
  if (Math.abs(base * (item.peso - mediaPeso)) > Math.abs((base - mediaBase) * mediaPeso)) {
    frases.push('O que mais ' + (sobe ? 'puxa para cima' : 'puxa para baixo') + ' é o calendário, não as leads.');
    return;
  }
  // Parte das leads que mais se afasta da média, no sentido da diferença
  var partes = item.comp.etapas.map(function (e, i) {
    return { nome: 'as leads em ' + e.etapa, aqui: e.vendas, media: media(function (x) { return x.comp.etapas[i].vendas; }) };
  });
  if (item.comp.novas !== null) partes.push({ nome: 'as leads que ainda vão entrar', aqui: item.comp.novas, media: media(function (x) { return x.comp.novas || 0; }) });
  var maior = partes.sort(function (a, b) { return (sobe ? b.aqui - b.media - (a.aqui - a.media) : a.aqui - a.media - (b.aqui - b.media)); })[0];
  frases.push('O que mais ' + (sobe ? 'puxa para cima' : 'puxa para baixo') + ': ' + maior.nome + ', com ' + qtdVendas_(Math.round(maior.aqui)) + ' neste dia, contra ' + Math.round(maior.media) + ' em média nos outros.');
}

// Texto simples e números do dia. t = dias à frente (0 = hoje).
function explicarDia_(item, outros, t, n, pesos, feriados, inicioFrases) {
  var comp = item.comp, frases = (inicioFrases || []).slice();
  if (diaUtil_(n, feriados)) fraseComparacao_(item, outros, frases);
  var maior = comp.celulas[0];
  if (maior && maior.vendas >= 1) {
    var prazo = t === 0 ? 'no mesmo dia' : (t === 1 ? 'no dia seguinte' : 'em ' + t + ' dias');
    frases.push('Maior grupo: ' + maior.leads + ' leads em ' + maior.etapa + ', com ' + maior.idade + ' de criadas, somando cerca de ' + qtdVendas_(Math.max(1, Math.round(maior.vendas))) +
      '. No histórico, ' + (maior.base_dias > 1 ? 'cerca de ' : '') + String(arred_(maior.chance * 100, 1)).replace('.', ',') + '% das leads nessa situação pagaram ' +
      (maior.base_dias > 1 ? 'a cada dia, perto desse prazo' : prazo) + '.');
  }
  var cal = fraseCalendario_(n, pesos, feriados);
  if (cal) frases.push(cal);

  var pico = comp.celulas.filter(function (c) { return c.pico; })[0];
  var alerta = pico ? 'Ponto de atenção: neste dia, a chance das leads em ' + pico.etapa + ' com ' + pico.idade + ' é ' +
    (pico.chance_vizinhos ? 'cerca de ' + Math.round(pico.chance / pico.chance_vizinhos) + ' vezes a dos dias vizinhos' : 'bem maior que a dos dias vizinhos') +
    ' (' + pico.base_pagaram + ' de ' + pico.base_leads + ' leads do histórico' + (pico.base_dias > 1 ? ', em ' + pico.base_dias + ' dias' : '') + '). Pode ser acaso do histórico, e não uma alta real.' : '';

  var valores = comp.etapas.map(function (e) { return e.vendas; });
  if (comp.novas !== null) valores.push(comp.novas);
  var inteiros = repartirInteiros_(valores, Math.round(item.total));
  return {
    etapas: comp.etapas.map(function (e, i) { return { etapa: e.etapa, leads: e.leads, vendas: arred_(e.vendas, 2), inteiro: inteiros[i] }; }),
    novas: comp.novas === null ? null : { vendas: arred_(comp.novas, 2), inteiro: inteiros[comp.etapas.length] },
    celulas: comp.celulas,
    resumo: frases,
    alerta: alerta
  };
}

// Coloca a composição em cada dia futuro e no restante de hoje
function montarExplicacoes_(dias, restanteHoje, abertas, h, pesos, feriados, hojeN) {
  var cels = celulasAbertas_(abertas, hojeN);
  var itens = dias.map(function (d, k) {
    var n = hojeN + k + 1, peso = pesoDoDia_(n, pesos, feriados);
    return { n: n, t: k + 1, util: diaUtil_(n, feriados), total: d.total, peso: peso, comp: composicaoDia_(cels, h, k + 1, peso, d.novas) };
  });
  var uteis = itens.filter(function (x) { return x.util; });
  itens.forEach(function (x, k) {
    dias[k].composicao = explicarDia_(x, uteis.filter(function (o) { return o !== x; }), x.t, x.n, pesos, feriados);
  });
  if (restanteHoje) {
    var peso = pesoDoDia_(hojeN, pesos, feriados) * restanteHoje.fracao_do_dia;
    var hora = pad2_(Math.floor(restanteHoje.minuto / 60)) + ':' + pad2_(restanteHoje.minuto % 60);
    var abre = [String(arred_(restanteHoje.fracao_do_dia * 100, 0)) + '% das vendas de um dia costumam entrar depois das ' + hora + ': é essa parte que a conta ainda espera.'];
    // Com o dia quase inteiro pela frente, dá para comparar com os outros dias úteis
    restanteHoje.composicao = explicarDia_({ total: restanteHoje.total, peso: peso, comp: composicaoDia_(cels, h, 0, peso, null) },
      restanteHoje.fracao_do_dia >= 0.8 ? uteis : [], 0, hojeN, pesos, feriados, abre);
  }
}

// O que fica guardado do primeiro cálculo de um dia. vendido = vendas do dia naquele momento, com e sem backoffice.
function registroPrimeiroHorario_(r, vendido, vendidoSemBackoffice) {
  var resto = r.hoje_restante;
  return { dia: +String(r.hoje).slice(8), data: r.hoje, gerado_em: r.gerado_em, versao: r.versao, vendido: vendido, vendido_sem_backoffice: vendidoSemBackoffice,
    restante: resto.total, fracao_do_dia: resto.fracao_do_dia, composicao: resto.composicao };
}

/* ---------- tudo junto ---------- */

// hoje = { ano, mes, dia }; feriados = ['AAAA-MM-DD'] (dias marcados como holiday na previsão do mês).
// agora = { minuto: minutos desde a meia-noite, vendas: minutosDasVendas_ } para o restante de hoje; sem ele, hoje fica de fora.
function previsaoPipeline_(t, hoje, feriadosIso, agora) {
  var hojeN = diaNum_(ymd_(hoje.ano, hoje.mes, hoje.dia)), ontem = hojeN - 1;
  var fimMes = diaNum_(ymd_(hoje.ano, hoje.mes, diasNoMes_(hoje.ano, hoje.mes)));
  var feriados = {};
  (feriadosIso || []).forEach(function (f) { var n = diaNum_(f); if (n !== null) feriados[n] = 1; });

  var leads = leadsDoPipeline_(t);
  var h = chancesPorEtapa_(leads, ontem);
  var mult = multiplicadores_(leads, h, ontem);
  var pesos = { semana: pesosSemana_(leads, ontem, feriados), posicao: pesosPosicao_(leads, ontem, feriados) };
  var novas = novasPorSemana_(leads, ontem);

  var abertas = leads.filter(function (l) { return l.aberta; }).map(function (l) {
    var g = grupoDaEtapa_(l.etapaAtual), chaves = chavesSegmento_(l), m = mult[g.id].mult;
    return { criado: l.criado, etapaAtual: l.etapaAtual, mult: m[chaves[2]] || m[chaves[1]] || m[chaves[0]] || 1 };
  });
  var dias = projetarDias_(abertas, h, pesos, novas, hojeN, fimMes, feriados);

  // Restante de hoje: chance de quem ainda está aberto pagar hoje × parte do dia que falta
  var fracao = agora ? fracaoRestante_(agora.vendas, agora.minuto) : null, restanteHoje = null;
  if (fracao !== null) {
    var chanceHoje = abertas.reduce(function (s, l) { return s + h[l.etapaAtual][faixaIdade_(hojeN - l.criado)][0] * l.mult; }, 0);
    restanteHoje = { minuto: agora.minuto, fracao_do_dia: arred_(fracao, 4), vendas_na_curva: agora.vendas.length,
      total: arred_(chanceHoje * pesoDoDia_(hojeN, pesos, feriados) * fracao, 2) };
  }
  montarExplicacoes_(dias, restanteHoje, abertas, h, pesos, feriados, hojeN);
  var soma = function (lista, campo, n) { return arred_(lista.slice(0, n).reduce(function (s, d) { return s + d[campo]; }, 0), 1); };

  // Tabela de chances: etapa × faixa de idade (a chance do primeiro dia da faixa), com as leads abertas em cada célula
  var colunaTabela = function (idade) {
    var c = 0;
    while (c + 1 < PIPE.FAIXAS_TABELA.length && PIPE.FAIXAS_TABELA[c + 1] <= idade) c++;
    return c;
  };
  var abertasCelula = {};
  abertas.forEach(function (l) {
    var idade = hojeN - l.criado, k = l.etapaAtual + '|' + colunaTabela(idade);
    var c = abertasCelula[k] || (abertasCelula[k] = { n: 0, esperado: 0 });
    c.n++;
    c.esperado += somaAte_(h[l.etapaAtual][faixaIdade_(idade)].slice(1), 5) * l.mult;
  });
  var chances = [1, 2, 3, 4].map(function (s) {
    return {
      etapa: PIPE.ETAPAS[s],
      faixas: PIPE.FAIXAS_TABELA.map(function (de, c) {
        var cel = abertasCelula[s + '|' + c] || { n: 0, esperado: 0 }, linha = h[s][faixaIdade_(de)];
        return { de: de, ate: c + 1 < PIPE.FAIXAS_TABELA.length ? PIPE.FAIXAS_TABELA[c + 1] - 1 : null, abertas: cel.n,
          chance_5d: arred_(somaAte_(linha, 5), 4), chance_30d: arred_(somaAte_(linha, 30), 4), esperado_5d: arred_(cel.esperado, 2) };
      })
    };
  });

  // Parada: menos de 1% de chance de pagar nos próximos 30 dias
  var paradas = abertas.filter(function (l) { return somaAte_(h[l.etapaAtual][faixaIdade_(hojeN - l.criado)].slice(1), 30) * l.mult < 0.01; }).length;

  // Segmentos com mais vendas que o esperado (e com menos), por campanha e por keyword
  var segmentos = PIPE.GRUPOS.map(function (g) {
    var lista = function (nivel) {
      var niveis = mult[g.id].niveis[nivel];
      return Object.keys(niveis).filter(function (k) { return Object.keys(niveis[k].pagas).length >= 3 || Object.keys(niveis[k].leads).length >= 30; }).map(function (k) {
        var c = niveis[k];
        return { segmento: k, leads: Object.keys(c.leads).length, vendas: Object.keys(c.pagas).length, multiplicador: arred_(mult[g.id].mult[k], 2) };
      }).sort(function (a, b) { return b.multiplicador - a.multiplicador; });
    };
    var corte = function (l) { return { melhores: l.slice(0, 6), piores: l.slice(-6).reverse() }; };
    return { grupo: g.id, nome: g.nome, campanhas: corte(lista(1)), keywords: corte(lista(2)) };
  });

  return {
    versao: PIPE.VERSAO,
    hoje: isoDoNum_(hojeN),
    janela_dias: PIPE.JANELA_DIAS,
    leads_aprendizado: leads.filter(function (l) { return l.criado >= ontem - PIPE.JANELA_DIAS; }).length,
    abertas: { total: abertas.length, paradas: paradas, por_etapa: [1, 2, 3, 4].map(function (s) {
      return { etapa: PIPE.ETAPAS[s], leads: abertas.filter(function (l) { return l.etapaAtual === s; }).length };
    }) },
    proximos_5: { total: soma(dias, 'total', 5), pipeline: soma(dias, 'pipeline', 5), novas: soma(dias, 'novas', 5) },
    ate_fim_do_mes: { total: soma(dias, 'total', dias.length), pipeline: soma(dias, 'pipeline', dias.length), novas: soma(dias, 'novas', dias.length) },
    hoje_restante: restanteHoje,
    pesos_posicao: pesos.posicao,
    dias: dias,
    chances: chances,
    segmentos: segmentos,
    teste: testarPipeline_(leads, h, pesos, novas, ontem, feriados)
  };
}
