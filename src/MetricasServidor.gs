/* ------------------------------------------------------------------
   MÉTRICAS DO FORECAST — leitura das bases, pacote salvo, página e plugin.
   Uma conta só para os dois lados: gerarMetricas lê as bases e salva o pacote
   no Drive; a página (só a dona) e o plugin da IA leem esse mesmo arquivo.
   Por isso o que a dona confere é exatamente o que a IA recebe, e a chamada do
   plugin não estoura o limite de 55 s (dados_funil tem 90 mil linhas).
   Contas em Metricas.gs. Propriedades do script: FORECAST_CHAVE (chave do plugin,
   gerarChaveForecast no editor) e CONSULTA_CHAVE (o mesmo valor do dash de leads).
   ------------------------------------------------------------------ */

var CONFIG_METRICAS = {
  ABA_TIMES_ATUAIS: 'Dados Leads 100% Pagas - TIMES ATUAIS',   // em CONFIG.ID_PLANILHA_VENDAS;   // time, cargo e status de cada pessoa hoje
  PLANILHA_FUNIL: '1H65syaE78ZUYTf_TWZRoxdfo-bdNg5VdsoFfbYRdR84',
  ABA_FUNIL: 'dados_funil',
  PLANILHA_JURIDICO: '1dPYm8QGUsounTdhPIRunlz5rpSoUrBUYaE7dBp9Tp5s',
  ABA_JURIDICO: 'dados_jurídico_resumido',
  ABA_METAS: 'Metas por pessoa',   // na planilha de previsão: MES | PESSOA | META | FORA DA CATRACA (S ou N)
  // O mesmo endereço que o plugin Consolide Consultas usa: leads por canal e Métricas de alerta, com o código do painel de leads
  URL_CONSULTAS: 'https://script.google.com/macros/s/AKfycby5K5Lget9ohaN4JRO9Dl4Y7b-VV2c6_R0rUywDrT4D5YgHYXEfL4qD7eEkq-MZwNA/exec',
  PASTA: 'Métricas da IA',
  LOTE_COLUNAS: 6,
  SEGUNDOS_POR_RODADA: 180   // passou disso, salva e a página chama de novo (limite do Apps Script: 6 min)
};

var COLUNAS_VENDAS_METRICAS = {
  id: 'ID_LEAD', consultor: 'CONSULTOR', produtoMeta: 'PRODUTO_CONTA_META', data: 'DATA_PAGAMENTO', area: 'AREA', status: 'STATUS_LEAD',
  contar: 'CONTAR_VENDA', gerente: 'NOME_GERENTE_ATUAL', cargo: 'CARGO', nivel: 'NIVEL', statusUsr: 'STATUS_USR', contratacao: 'DATA_CONTRATACAO_USR', desligamento: 'DATA_DESLIGAMENTO_USR'
};

var COLUNAS_FUNIL_METRICAS = ['id_lead', 'consultor', 'gerente', 'criado_em', 'data_perda', 'competencia_venda', 'etapa', 'fase', 'finalizacao',
  'mql', 'prospeccao', 'oportunidades', 'documentacao', 'pagamento', 'ganho', 'data_funil_comercial', 'CONTAR_VENDA', 'AREA', 'PRODUTO_CONTA_META',
  'CICLO_VENDA_ATE_SER_PAGO'];

var COLUNAS_JURIDICO_METRICAS = ['ID_PROCESSO', 'PRODUTO_CONTA_META', 'DATA_PENDENTE_JURIDICO', 'DATA_INICIO_REGISTRO', 'DATA_PROTOCOLADO_ANOTACOES',
  'QTD_DOCUMENTOS_INCOMPLETOS', 'QUEM_ENVIOU_PENDENTE_JURIDICO', 'Gerente', 'TEMPO_UTIL_SEGUNDOS_INICIO_ATE_PROTOCOLADO', 'TEMPO_PENDENTE_JURIDICO_ATE_INICIO_REGISTRO'];

// O que cada seção é. Vai no índice do plugin e na página. Mudou uma regra: mude aqui também.
var METRICAS_SECOES = [
  { secao: 'vendas_matriz', grupo: 'vendas', titulo: 'Resultados de vendas, 14 meses',
    regra: 'Soma de CONTAR_VENDA por mês e dia, pela DATA_PAGAMENTO. PRODUTO_CONTA_META = Sim e CONTAR_VENDA = 1. Inclui backoffice (também em coluna separada: AREA contém Backoffice). Estornos não são retirados. O mês atual está em andamento, e meses recentes ainda podem subir com vendas que fecham depois.' },
  { secao: 'vendas_dia_semana', grupo: 'vendas', titulo: 'Média de vendas por dia da semana',
    regra: 'ID_LEAD diferentes ÷ quantas vezes o dia da semana aconteceu no mês (no mês atual, até hoje). Mesmos filtros da matriz, com backoffice. Médias de 12 e 6 meses: meses fechados.' },
  { secao: 'vendedores', grupo: 'vendas', titulo: 'Desempenho de cada vendedor',
    regra: 'ID_LEAD diferentes pela DATA_PAGAMENTO, com STATUS_LEAD diferente de Estorno, PRODUTO_CONTA_META = Sim e CONTAR_VENDA = 1, por CONSULTOR. Entra quem tem meta, quem vendeu nos 3 meses ou quem está ativo na TIMES ATUAIS, sem backoffice, SEM GERENTE ou nomes de teste, coordenador e franquia; as vendas de quem fica de fora seguem em vendas_matriz. Gerente, cargo e área vêm da TIMES ATUAIS; quem não está lá, da venda mais recente. Meta e fora da catraca (S ou N) vêm da aba Metas por pessoa; meta 0 sozinha não quer dizer fora da catraca.' },
  { secao: 'funil', grupo: 'funil', titulo: 'Funil de vendas',
    regra: 'dados_funil pela data_funil_comercial: AREA sem Backoffice, PRODUTO_CONTA_META Sim ou Produto ainda não definido, finalização diferente de Interesse em Parceria. Etapas = valores diferentes de mql, prospeccao, oportunidades, documentacao e pagamento; ganho só com CONTAR_VENDA = 1. Etapa documentacao = Assinatura e pagamento; etapa pagamento = Pendente jurídico.' },
  { secao: 'ciclo_e_lost', grupo: 'funil', titulo: 'Ciclo de venda e motivos de lost',
    regra: 'Mesmos filtros do funil. Média até 100% pago = média de CICLO_VENDA_ATE_SER_PAGO onde há ganho. Ciclo = pagamento diferentes por dias, com competencia_venda depois de 01/01/2017. Losts = finalização contém Perda; dias até lost = data_perda − criado_em; motivos = registros por fase.' },
  { secao: 'pipeline', grupo: 'funil', titulo: 'Leads no pipeline hoje',
    regra: 'Leads diferentes com finalização Pipeline, de qualquer data, com os filtros de área e produto do funil. Foto do momento em que o pacote foi gerado.' },
  { secao: 'juridico', grupo: 'juridico', titulo: 'Jurídico',
    regra: 'dados_jurídico_resumido, produto Sim ou não definido. Cada indicador pela própria data: DATA_PENDENTE_JURIDICO, DATA_INICIO_REGISTRO e DATA_PROTOCOLADO_ANOTACOES. Documentos incompletos = soma de QTD_DOCUMENTOS_INCOMPLETOS dos processos que passaram em pendente jurídico no mês. Tempos em horas úteis. A base cobre só os últimos meses.' },
  { secao: 'leads_distribuicao', grupo: 'leads', titulo: 'Distribuição de leads por canal',
    regra: 'Calculado pelo painel de leads: leads por dia de criação nos 9 canais, por mês, semana e dia; vendas e losts por canal no mês (produtos Sim e não definido).' },
  { secao: 'indicadores_mes_passado', grupo: 'indicadores', titulo: 'Métricas de alerta do mês passado',
    regra: 'Calculado pela aba Métricas de alerta do painel de leads: mês passado comparado com o retrasado, por time e por consultor. Os códigos e nomes estão em "metricas".' },
  { secao: 'indicadores_ultimos_7_dias', grupo: 'indicadores', titulo: 'Métricas de alerta dos últimos 7 dias',
    regra: 'Mesma fonte: os 7 dias até ontem, com o comparativo padrão do painel, por time e por consultor.' }
];

var METRICAS_GRUPOS = ['vendas', 'funil', 'juridico', 'leads', 'indicadores'];

/* ---------- leitura das bases ---------- */

// Colunas pedidas de uma aba, em lotes, pela Sheets API. Devolve { n, <nome>: [valores da linha 2 em diante] }.
// Aba sem linhas é falha: pode estar sendo regravada pela carga.
function lerColunasMetricas_(planilha, aba, nomes) {
  var ref = "'" + aba.replace(/'/g, "''") + "'!";
  var r = Sheets.Spreadsheets.Values.get(planilha, ref + '1:1');
  var cab = (((r && r.values) || [])[0] || []).map(function (c) { return String(c).trim().toLowerCase(); });
  if (!cab.length) throw new Error('A aba "' + aba + '" está sem cabeçalho agora; pode estar sendo atualizada.');
  var faltam = [], letras = nomes.map(function (n) {
    var i = cab.indexOf(n.toLowerCase());
    if (i < 0) faltam.push(n);
    return letraColuna_(i);
  });
  if (faltam.length) throw new Error('Coluna não encontrada na aba "' + aba + '": ' + faltam.join(', ') + '.');
  var t = { n: 0 };
  for (var k = 0; k < nomes.length; k += CONFIG_METRICAS.LOTE_COLUNAS) {
    var lote = letras.slice(k, k + CONFIG_METRICAS.LOTE_COLUNAS);
    var resp = Sheets.Spreadsheets.Values.batchGet(planilha, {
      ranges: lote.map(function (l) { return ref + l + '2:' + l; }),
      majorDimension: 'COLUMNS', valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING'
    }).valueRanges || [];
    lote.forEach(function (l, j) {
      var col = (resp[j] && resp[j].values && resp[j].values[0]) || [];
      t[nomes[k + j]] = col;
      if (col.length > t.n) t.n = col.length;
    });
  }
  if (!t.n) throw new Error('A aba "' + aba + '" está sem linhas agora; pode estar sendo atualizada.');
  return t;
}

function comRepeticao_(fn) {
  try { return fn(); }
  catch (e) { Utilities.sleep(5000); return fn(); }
}

function lerVendasMetricas_() {
  var campos = Object.keys(COLUNAS_VENDAS_METRICAS);
  var t = lerColunasMetricas_(CONFIG.ID_PLANILHA_VENDAS, CONFIG.ABA_VENDAS, campos.map(function (c) { return COLUNAS_VENDAS_METRICAS[c]; }));
  var vendas = [];
  for (var i = 0; i < t.n; i++) {
    var data = normalizarData_(t.DATA_PAGAMENTO[i]);
    if (!data) continue;
    var v = {};
    campos.forEach(function (c) {
      var x = t[COLUNAS_VENDAS_METRICAS[c]][i];
      v[c] = String(x === undefined || x === null ? '' : x).trim();
    });
    v.data = data;
    vendas.push(v);
  }
  return vendas;
}

function lerCadastrosVendedores_() {
  var t = lerColunasMetricas_(CONFIG.ID_PLANILHA_VENDAS, CONFIG_METRICAS.ABA_TIMES_ATUAIS,
    ['CONSULTOR', 'AREA', 'STATUS_USR', 'NOME_GERENTE_ATUAL', 'CARGO', 'NIVEL', 'DATA_CONTRATACAO_USR', 'DATA_DESLIGAMENTO_USR']);
  var texto = function (x) { return String(x === undefined || x === null ? '' : x).trim(); };
  var lista = [];
  for (var i = 0; i < t.n; i++) {
    lista.push({ consultor: texto(t.CONSULTOR[i]), area: texto(t.AREA[i]), statusUsr: texto(t.STATUS_USR[i]), gerente: texto(t.NOME_GERENTE_ATUAL[i]),
      cargo: texto(t.CARGO[i]), nivel: texto(t.NIVEL[i]), contratacao: texto(t.DATA_CONTRATACAO_USR[i]), desligamento: texto(t.DATA_DESLIGAMENTO_USR[i]) });
  }
  return lista;
}

// Aba de metas da Brianna: MES (AAAA-MM ou MM/AAAA), PESSOA (nome igual ao CONSULTOR), META e FORA DA CATRACA (S ou N). Sem a aba, sem meta.
function lerMetas_(ss) {
  var aba = ss.getSheetByName(CONFIG_METRICAS.ABA_METAS);
  if (!aba) return null;
  var v = aba.getDataRange().getDisplayValues();
  if (v.length < 2) return [];
  var cab = v[0].map(function (c) { return semAcento_(c); });
  var achar = function (lista) { for (var i = 0; i < lista.length; i++) { var k = cab.indexOf(lista[i]); if (k >= 0) return k; } return -1; };
  var cMes = achar(['mes', 'mês']), cPes = achar(['pessoa', 'consultor', 'vendedor', 'nome', 'colaborador']), cMeta = achar(['meta']), cFora = achar(['fora da catraca']);
  if (cMes < 0 || cPes < 0 || cMeta < 0) throw new Error('A aba "' + CONFIG_METRICAS.ABA_METAS + '" precisa das colunas MES, PESSOA e META.');
  return v.slice(1).map(function (l) {
    return { mes: normalizarMes_(l[cMes]), pessoa: String(l[cPes]).trim(), meta: numeroCelula_(l[cMeta]), fora: cFora < 0 ? null : foraDaCatraca_(l[cFora]) };
  }).filter(function (l) { return l.mes && l.pessoa && (l.meta !== null || l.fora !== null); });
}

/* ---------- painel de leads, pelo endereço de consulta ---------- */

function urlConsultas_(params) {
  var chave = prop_('CONSULTA_CHAVE');
  if (!chave) throw new Error('Falta a propriedade CONSULTA_CHAVE neste projeto (o mesmo valor do dash de leads).');
  var partes = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
  partes.push('chave=' + encodeURIComponent(chave));
  return CONFIG_METRICAS.URL_CONSULTAS + '?' + partes.join('&');
}

// A chave nunca aparece em mensagem de erro.
function semChave_(texto) { return String(texto).replace(/chave=[^&\s"']+/g, 'chave=***'); }

function lerRespostaConsultas_(resp) {
  var r;
  try { r = JSON.parse(resp.getContentText()); }
  catch (e) { throw new Error('O painel de leads não devolveu JSON (código ' + resp.getResponseCode() + ').'); }
  if (!r.ok) throw new Error('Painel de leads: ' + r.erro);
  return r;
}

// A primeira leitura do painel de leads pode demorar mais que o limite da chamada. Ele termina mesmo assim e guarda
// o resultado no cache dele, então vale tentar de novo.
function chamarConsultas_(params) {
  var ultimo = null;
  for (var i = 0; i < 3; i++) {
    try { return lerRespostaConsultas_(UrlFetchApp.fetch(urlConsultas_(params), { muteHttpExceptions: true })); }
    catch (e) { ultimo = e; if (i < 2) Utilities.sleep(15000); }
  }
  throw new Error(semChave_(ultimo && ultimo.message ? ultimo.message : ultimo));
}

function isoDe_(ano, mes, dia) { return ymd_(ano, mes, dia); }

function periodoDoMes_(mesRef) {
  var a = +mesRef.slice(0, 4), m = +mesRef.slice(5, 7);
  return intervaloMes_(a, m);
}

function somarDiasIso_(iso, n) {
  var d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}

function calcularLeads_(hoje) {
  var atual = mesRefDoDia_(hoje), de = somarMeses_(atual, -METRICAS.MESES_MATRIZ) + '-01', ate = isoDe_(hoje.ano, hoje.mes, hoje.dia);
  chamarConsultas_({ consulta: 'metrica', painel: 'leads', por: 'total', de: ate, ate: ate });   // faz o painel guardar a leitura antes das 9 chamadas juntas
  var pedidos = METRICAS.CANAIS.map(function (c) {
    return { url: urlConsultas_({ consulta: 'metrica', painel: 'leads', por: 'dia', canais: c, metricas: 'leads,vendas,losts', de: de, ate: ate }), muteHttpExceptions: true };
  });
  var respostas = UrlFetchApp.fetchAll(pedidos).map(function (resp, k) {
    var r = lerRespostaConsultas_(resp);
    return { canal: METRICAS.CANAIS[k], linhas: r.linhas };
  });
  return metricasLeads_(respostas);
}

function calcularIndicadores_(hoje) {
  var atual = mesRefDoDia_(hoje), p = periodoDoMes_(somarMeses_(atual, -1)), c = periodoDoMes_(somarMeses_(atual, -2));
  var base = { consulta: 'metrica', painel: 'alerta', de: p.ini, ate: p.fim, comparar_de: c.ini, comparar_ate: c.fim };
  var por = function (b, tipo) { return chamarConsultas_(Object.assign({}, b, { por: tipo })); };
  var ontem = somarDiasIso_(isoDe_(hoje.ano, hoje.mes, hoje.dia), -1);
  var sete = { consulta: 'metrica', painel: 'alerta', de: somarDiasIso_(ontem, -6), ate: ontem, metricas: 'lmv,mq,lo,ten,uni,fal,pit,pf,ve,proc,prot' };
  return {
    indicadores_mes_passado: {
      por_time: compactarIndicadores_(por(base, 'time'), ['time']),
      por_consultor: compactarIndicadores_(por(base, 'consultor'), ['consultor', 'time', 'gerente_atual'])
    },
    indicadores_ultimos_7_dias: {
      por_time: compactarIndicadores_(por(sete, 'time'), ['time']),
      por_consultor: compactarIndicadores_(por(sete, 'consultor'), ['consultor', 'time', 'gerente_atual'])
    }
  };
}

/* ---------- cada grupo do pacote ---------- */

function calcularGrupoMetricas_(grupo, hoje, ss, avisos) {
  if (grupo === 'vendas') {
    var vendas = comRepeticao_(function () { return lerVendasMetricas_(); });
    var metas = null;
    try { metas = lerMetas_(ss); } catch (e) { avisos.push(String(e.message || e)); }
    if (metas === null) avisos.push('A aba "' + CONFIG_METRICAS.ABA_METAS + '" ainda não existe: vendedores sem meta e sem a marcação de fora da catraca.');
    var cadastros = [];
    try { cadastros = comRepeticao_(lerCadastrosVendedores_); }
    catch (e3) { avisos.push('Não consegui ler a aba "' + CONFIG_METRICAS.ABA_TIMES_ATUAIS + '": os times saem da venda mais recente, e quem não vendeu nem tem meta fica fora da lista de vendedores. ' + (e3.message || e3)); }
    var vendedores = metricasVendedores_(vendas, metas || [], hoje, cadastros);
    if (vendedores.metas_sem_cadastro.length) avisos.push('Nomes da aba "' + CONFIG_METRICAS.ABA_METAS + '" que não aparecem em nenhuma venda nem na TIMES ATUAIS (confira a grafia): ' + vendedores.metas_sem_cadastro.join(', ') + '.');
    return { vendas_matriz: metricasMatriz_(vendas, hoje), vendas_dia_semana: metricasDiaSemana_(vendas, hoje), vendedores: vendedores };
  }
  if (grupo === 'funil') {
    return metricasFunil_(comRepeticao_(function () {
      return lerColunasMetricas_(CONFIG_METRICAS.PLANILHA_FUNIL, CONFIG_METRICAS.ABA_FUNIL, COLUNAS_FUNIL_METRICAS);
    }), hoje);
  }
  if (grupo === 'juridico') {
    return { juridico: metricasJuridico_(comRepeticao_(function () {
      return lerColunasMetricas_(CONFIG_METRICAS.PLANILHA_JURIDICO, CONFIG_METRICAS.ABA_JURIDICO, COLUNAS_JURIDICO_METRICAS);
    }), hoje) };
  }
  if (grupo === 'leads') return { leads_distribuicao: calcularLeads_(hoje) };
  if (grupo === 'indicadores') return calcularIndicadores_(hoje);
  throw new Error('Grupo desconhecido: ' + grupo);
}

/* ---------- pacote no Drive ---------- */

// Pasta dentro da do histórico, com o ID guardado nas propriedades do script.
function subpastaHistorico_(propriedade, nome) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(propriedade);
  if (id) {
    try { return DriveApp.getFolderById(id); }
    catch (e) { console.warn('Pasta "' + nome + '" não encontrada pelo ID: ' + e); }
  }
  var pai = pastaHistorico_();
  var achadas = pai.getFoldersByName(nome);
  var pasta = achadas.hasNext() ? achadas.next() : pai.createFolder(nome);
  props.setProperty(propriedade, pasta.getId());
  return pasta;
}

function pastaMetricas_() {
  return subpastaHistorico_('PASTA_METRICAS_ID', CONFIG_METRICAS.PASTA);
}

function listarPacotes_() {
  var datas = [], arquivos = pastaMetricas_().getFiles();
  while (arquivos.hasNext()) {
    var m = arquivos.next().getName().match(/^metricas-(\d{4}-\d{2}-\d{2})\.json$/);
    if (m) datas.push(m[1]);
  }
  return datas.sort().reverse();
}

function lerPacote_(data) {
  var quando = data || listarPacotes_()[0];
  if (!quando) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(quando)) throw new Error('Data inválida: use AAAA-MM-DD.');
  var achados = pastaMetricas_().getFilesByName('metricas-' + quando + '.json');
  return achados.hasNext() ? JSON.parse(achados.next().getBlob().getDataAsString('UTF-8')) : null;
}

function salvarPacote_(pacote) {
  var nome = 'metricas-' + pacote.hoje + '.json', pasta = pastaMetricas_(), texto = JSON.stringify(pacote);
  var achados = pasta.getFilesByName(nome);
  if (achados.hasNext()) achados.next().setContent(texto);
  else pasta.createFile(nome, texto, 'application/json');
}

// continuar = false começa um pacote novo; true termina o de hoje, a partir dos grupos que faltam.
function rodarPacote_(continuar) {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(2000)) throw new Error('Já existe uma atualização das métricas em andamento. Aguarde alguns minutos.');
  try {
    var inicio = Date.now(), h = hojeSP_(), iso = ymd_(h.ano, h.mes, h.dia);
    var pacote = continuar ? lerPacote_(iso) : null;
    if (!pacote || !pacote.pendentes || !pacote.pendentes.length) {
      pacote = {
        versao: 1, hoje: iso, mes_ref: mesRefDoDia_(h), mes_passado: somarMeses_(mesRefDoDia_(h), -1),
        mesmo_mes_ano_passado: somarMeses_(mesRefDoDia_(h), -12),
        gerado_em: '', avisos: [], pendentes: METRICAS_GRUPOS.slice(), secoes: {}
      };
    }
    var ss = abrirPlanilha_();
    while (pacote.pendentes.length && (Date.now() - inicio) / 1000 < CONFIG_METRICAS.SEGUNDOS_POR_RODADA) {
      var grupo = pacote.pendentes[0];
      try {
        var r = calcularGrupoMetricas_(grupo, h, ss, pacote.avisos);
        Object.keys(r).forEach(function (s) { pacote.secoes[s] = r[s]; });
      } catch (e) {
        pacote.avisos.push('Não consegui calcular "' + grupo + '": ' + semChave_(e.message || e));
      }
      pacote.pendentes.shift();
      pacote.gerado_em = Utilities.formatDate(new Date(), fuso_(), 'dd/MM/yyyy HH:mm');
      salvarPacote_(pacote);
    }
    return { pendentes: pacote.pendentes, avisos: pacote.avisos, gerado_em: pacote.gerado_em, hoje: pacote.hoje };
  } finally {
    trava.releaseLock();
  }
}

/* ---------- página (só a dona) ---------- */

function soDona_(token) {
  var s = conferirSessao_(token);
  if (s.email !== emailDono_()) throw new Error('SEMACESSO:' + s.email);
  return s;
}

function servirMetricas_(email, bilhete) {
  if (email !== emailDono_()) return paginaEntrada_('semacesso', email);
  var t = HtmlService.createTemplateFromFile('metricas');
  t.urlJson = jsonNaPagina_(urlBase_());
  t.bilheteJson = jsonNaPagina_(bilhete || '');
  return t.evaluate()
    .setTitle('Métricas da IA - Forecast Consolide')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Texto JSON: o pacote pedido (ou o mais recente), as datas disponíveis e a descrição das seções.
function getMetricas(token, data) {
  soDona_(token);
  return JSON.stringify({ pacote: lerPacote_(data || ''), datas: listarPacotes_(), secoes: METRICAS_SECOES });
}

function gerarMetricas(token, continuar) {
  soDona_(token);
  return rodarPacote_(!!continuar);
}

/* ---------- plugin da IA: ?consulta=<indice|secao>&chave=<FORECAST_CHAVE> ---------- */

function mesmaChave_(a, b) {
  a = String(a || ''); b = String(b || '');
  var dif = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) dif |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return dif === 0;
}

function metricas_responder_(p) {
  var saida;
  try {
    var chave = prop_('FORECAST_CHAVE');
    if (!chave || !mesmaChave_(p.chave, chave)) saida = { ok: false, erro: 'Chave inválida ou consulta desligada.' };
    else {
      saida = metricas_executar_(p);
      registrarAcesso_(abrirPlanilha_(), 'ia:forecast', 'Plugin: ' + (p.consulta || '') + (p.secao ? ' ' + p.secao : ''), 10);
    }
  } catch (e) {
    saida = { ok: false, erro: e && e.message ? e.message : String(e) };
  }
  return ContentService.createTextOutput(JSON.stringify(saida)).setMimeType(ContentService.MimeType.JSON);
}

function metricas_executar_(p) {
  var acao = String(p.consulta || '').trim();
  if (acao !== 'indice' && acao !== 'secao') return { ok: false, erro: 'Ação desconhecida. Use indice ou secao.' };
  var pacote = lerPacote_(p.data || '');
  if (!pacote) return { ok: false, erro: 'Não há pacote de métricas' + (p.data ? ' de ' + p.data : '') + '. A dona precisa clicar em "Atualizar métricas" na página do forecast.' };
  var h = hojeSP_(), idade = diasEntre_(pacote.hoje, ymd_(h.ano, h.mes, h.dia));
  var base = {
    ok: true, gerado_em: pacote.gerado_em, dias_desde_a_geracao: idade, mes_ref: pacote.mes_ref, mes_passado: pacote.mes_passado,
    mesmo_mes_ano_passado: pacote.mesmo_mes_ano_passado, pacote_incompleto: pacote.pendentes && pacote.pendentes.length ? pacote.pendentes : undefined
  };
  if (idade > 0) base.aviso = 'Este pacote foi gerado há ' + idade + ' dia(s). Avise a dona se precisar de dados mais novos.';
  if (acao === 'indice') {
    return Object.assign(base, {
      pacotes_disponiveis: listarPacotes_().slice(0, 40),
      avisos_do_pacote: pacote.avisos,
      secoes: METRICAS_SECOES.map(function (s) {
        return { secao: s.secao, titulo: s.titulo, regra: s.regra, disponivel: !!pacote.secoes[s.secao] };
      })
    });
  }
  var nome = String(p.secao || '').trim(), desc = METRICAS_SECOES.filter(function (s) { return s.secao === nome; })[0];
  if (!desc) return { ok: false, erro: 'Seção desconhecida. Use: ' + METRICAS_SECOES.map(function (s) { return s.secao; }).join(', ') + '.' };
  if (!pacote.secoes[nome]) return { ok: false, erro: 'A seção ' + nome + ' não foi calculada neste pacote. Avisos: ' + (pacote.avisos.join(' ') || 'nenhum') };
  return Object.assign(base, { secao: nome, titulo: desc.titulo, regra: desc.regra, dados: pacote.secoes[nome] });
}

/* ---------- manutenção (só no editor) ---------- */

function gerarChaveForecast() {
  soNoEditor_('gerarChaveForecast');
  var chave = (Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('FORECAST_CHAVE', chave);
  Logger.log('Chave nova do plugin criada; a anterior parou de valer. Vai só no campo de segredo FORECAST_CHAVE do servidor MCP, não cole em chat:');
  Logger.log(chave);
}

function revogarChaveForecast() {
  soNoEditor_('revogarChaveForecast');
  PropertiesService.getScriptProperties().deleteProperty('FORECAST_CHAVE');
  Logger.log('Pronto. O endereço do plugin não responde mais.');
}

// Mesmo que o botão da página, pelo editor. Pode rodar de novo se parar no limite de tempo.
function gerarMetricasAgora() {
  soNoEditor_('gerarMetricasAgora');
  var r = rodarPacote_(false);
  Logger.log(JSON.stringify(r));
  if (r.pendentes.length) Logger.log('Faltou: ' + r.pendentes.join(', ') + '. Rode continuarMetricas().');
}

function continuarMetricas() {
  soNoEditor_('continuarMetricas');
  Logger.log(JSON.stringify(rodarPacote_(true)));
}
