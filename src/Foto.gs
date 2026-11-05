/* ------------------------------------------------------------------
   FOTO DIÁRIA — contas (funções puras, sem API do Google).
   A foto guarda como as coisas estavam em cada dia: é o que a previsão dinâmica
   vai usar para aprender, porque o pipeline e a previsão são sobrescritos e o
   realizado muda depois. Leitura, gatilho e gravação em FotoServidor.gs. Regras: CLAUDE.md.
   ------------------------------------------------------------------ */

var FOTO_GRUPOS = ['previsao', 'realizado', 'pipeline', 'atividade', 'leads'];

// Códigos das Métricas de alerta do dash de leads (consulta=metricas). "pipe" é a foto das leads de MKT.
var FOTO_ATIVIDADE = ['ld', 'lm', 'mq', 'lo', 'lt', 'lmv', 'ten', 'uni', 'fal', 'pit', 'pf', 've', 'vv', 'proc', 'prot', 'pipe'];

/* t = { n, id_lead:[], consultor:[], gerente:[], etapa:[], finalizacao:[], AREA:[], PRODUTO_CONTA_META:[] }
   Mesmos filtros da seção pipeline de metricasFunil_. Guarda também os IDs de cada etapa: comparando
   duas fotos dá para ver quem entrou, saiu e quanto tempo ficou, o que a base não conta. */
function fotoPipeline_(t) {
  var norm = normalizadorMemo_();
  var total = {}, etapas = {}, gerentes = {}, consultores = {};
  var marcar = function (mapa, nome, etapa, id) {
    var grupo = mapa[nome] || (mapa[nome] = {});
    (grupo[etapa] = grupo[etapa] || {})[id] = 1;
  };
  for (var i = 0; i < t.n; i++) {
    if (norm(t.finalizacao[i]) !== 'pipeline' || !preenchido_(t.id_lead[i])) continue;
    if (norm(t.AREA[i]).indexOf('backoffice') >= 0) continue;
    var prod = norm(t.PRODUTO_CONTA_META[i]);
    if (prod !== 'sim' && prod !== 'produto ainda nao definido') continue;
    var id = String(t.id_lead[i]), etapa = String(t.etapa[i] || '(sem etapa)').trim();
    total[id] = 1;
    (etapas[etapa] = etapas[etapa] || {})[id] = 1;
    marcar(gerentes, String(t.gerente[i] || '(sem gerente)').trim(), etapa, id);
    marcar(consultores, String(t.consultor[i] || '(sem consultor)').trim(), etapa, id);
  }
  var contar = function (mapa) {
    var o = {};
    Object.keys(mapa).forEach(function (k) { o[k] = Object.keys(mapa[k]).length; });
    return o;
  };
  var contarGrupos = function (mapa) {
    var o = {};
    Object.keys(mapa).forEach(function (k) { o[k] = contar(mapa[k]); });
    return o;
  };
  var ids = {};
  Object.keys(etapas).forEach(function (e) { ids[e] = Object.keys(etapas[e]).sort(); });
  return {
    total: Object.keys(total).length,
    por_etapa: contar(etapas),
    por_gerente: contarGrupos(gerentes),
    por_consultor: contarGrupos(consultores),
    ids_por_etapa: ids
  };
}

// Resposta de consulta=metrica&painel=alerta: fica só o valor do período pedido, em cada linha com movimento.
function fotoIndicadores_(resposta, rotulos) {
  var codigos = Object.keys(resposta.legenda || {});
  return (resposta.linhas || []).map(function (l) {
    var o = {};
    rotulos.forEach(function (r) { o[r] = l[r] === undefined ? '' : l[r]; });
    codigos.forEach(function (c) { o[c] = l[c] ? l[c].atual : null; });
    return o;
  }).filter(function (o) {
    return codigos.some(function (c) { return o[c]; });
  });
}

// Resposta de consulta=metrica&painel=leads&por=canal: leads, vendas e losts do período pedido.
function fotoLeads_(resposta) {
  var valor = function (m) { return m ? m.atual : null; };
  return (resposta.linhas || []).map(function (l) {
    return { canal: l.canal, leads: valor(l.leads), vendas: valor(l.vendas), losts: valor(l.losts) };
  });
}
