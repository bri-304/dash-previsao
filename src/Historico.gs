/* ------------------------------------------------------------------
   HISTÓRICO — um JSON por mês fechado numa pasta do Drive da dona (AAAA-MM.json).
   Mesmo formato do objeto do mês corrente (schema v8). A pasta não precisa ser
   compartilhada: o dash roda na conta da dona. As vendas do mês anterior continuam
   na aba bruta; o snapshot guarda o que a IA sobrescreve quando escreve o mês novo.
   ------------------------------------------------------------------ */

function pastaHistorico_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PASTA_HISTORICO_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); }
    catch (e) { console.warn('Pasta do histórico não encontrada pelo ID, criando outra: ' + e); }
  }
  // Teste e produção têm pastas separadas: um snapshot de teste nunca muda o histórico oficial.
  var nome = CONFIG.PASTA_HISTORICO + (ehProjetoTeste_() ? ' (teste)' : '');
  var achadas = DriveApp.getFoldersByName(nome);
  var pasta = achadas.hasNext() ? achadas.next() : DriveApp.createFolder(nome);
  props.setProperty('PASTA_HISTORICO_ID', pasta.getId());
  return pasta;
}

function mesRefValido_(mesRef) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mesRef || ''))) throw new Error('Mês inválido: ' + mesRef);
  return String(mesRef);
}

function arquivoDoMes_(pasta, mesRef) {
  var achados = pasta.getFilesByName(mesRef + '.json');
  return achados.hasNext() ? achados.next() : null;
}

function rotuloDoMes_(mesRef) {
  var p = mesRef.split('-');
  return REGRAS.MESES[+p[1] - 1] + '/' + p[0];
}

function listarMeses_() {
  var meses = [], arquivos = pastaHistorico_().getFiles();
  while (arquivos.hasNext()) {
    var m = arquivos.next().getName().match(/^(\d{4}-\d{2})\.json$/);
    if (m) meses.push(m[1]);
  }
  return meses.sort().map(function (id) { return { id: id, label: rotuloDoMes_(id) }; });
}

function lerSnapshot_(mesRef) {
  var arq = arquivoDoMes_(pastaHistorico_(), mesRefValido_(mesRef));
  if (!arq) throw new Error('Não há histórico salvo de ' + rotuloDoMes_(mesRef) + '.');
  return arq.getBlob().getDataAsString('UTF-8');
}

// Grava o snapshot. Mês corrente: como está agora. Mês passado: como no último dia dele, desde que
// as abas da IA ainda sejam daquele mês (depois disso a previsão já foi sobrescrita).
function salvarSnapshot_(mesRef) {
  mesRefValido_(mesRef);
  var hoje = hojeSP_(), atual = mesRefDe_(hoje);
  if (mesRef > atual) throw new Error('O mês ' + rotuloDoMes_(mesRef) + ' ainda não começou.');
  var p = mesRef.split('-');
  var ref = mesRef === atual ? hoje : { ano: +p[0], mes: +p[1], dia: diasNoMes_(+p[0], +p[1]) };

  var fontes = lerFontes_(abrirPlanilha_());
  var linhaPrev = fontes.diasPrevisao.filter(function (l) { return String(l.mes || '').trim(); })[0];
  var mesPrev = linhaPrev ? String(linhaPrev.mes).trim() : '';
  var esperado = p[1] + '/' + p[0];
  if (mesPrev !== esperado) {
    throw new Error('A aba de previsão está em ' + (mesPrev || '(vazia)') + ', não em ' + esperado + '. O snapshot misturaria dois meses: atualize a previsão antes.');
  }

  var texto = JSON.stringify(montarForecast_(fontes, ref), null, 2);
  var pasta = pastaHistorico_();
  var arq = arquivoDoMes_(pasta, mesRef);
  if (arq) arq.setContent(texto);
  else arq = pasta.createFile(mesRef + '.json', texto, 'application/json');
  return { mesRef: mesRef, label: rotuloDoMes_(mesRef), url: arq.getUrl() };
}

// Pela página (botão só da dona) ou pelo editor (sem token).
function salvarSnapshot(mesRef, token) {
  var email = '';
  if (token) {
    var s = conferirSessao_(token);
    if (s.email !== emailDono_()) throw new Error('Só a dona pode salvar o snapshot.');
    email = s.email;
  } else {
    soNoEditor_('salvarSnapshot');
  }
  var r = salvarSnapshot_(mesRef || mesRefDe_(hojeSP_()));
  registrarAcesso_(abrirPlanilha_(), email || emailDono_(), 'Salvou snapshot ' + r.mesRef, 0);
  return r;
}

// Gatilho diário às 23h: só grava no último dia do mês, depois da última carga do Pentaho do dia.
function gatilhoSnapshotDiario() {
  var h = hojeSP_();
  if (h.dia !== diasNoMes_(h.ano, h.mes)) return;
  salvarSnapshot_(mesRefDe_(h));
}

// Rode uma vez no editor do projeto de produção. Pode repetir: não duplica o gatilho.
function instalarGatilhoSnapshot() {
  soNoEditor_('instalarGatilhoSnapshot');
  if (ehProjetoTeste_()) throw new Error('O gatilho fica só no projeto de produção.');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'gatilhoSnapshotDiario') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('gatilhoSnapshotDiario').timeBased().everyDays(1).atHour(23).inTimezone('America/Sao_Paulo').create();
  Logger.log('Gatilho instalado: todo dia às 23h; só grava no último dia do mês.');
}

// Uso único: traz para a pasta os JSONs fechados de hoje. Nunca sobrescreve o que já existe.
// Outubro não foi salvo no repositório: vem da última versão do forecast_data.json de 31/10 (23:08).
// Depois de importar em produção, esta função pode sair do código.
function importarHistoricoDoGithub() {
  soNoEditor_('importarHistoricoDoGithub');
  var raiz = 'https://raw.githubusercontent.com/bri-304/dash-previsao/';
  var origens = {
    '2026-06': raiz + 'main/historico/2026-06.json',
    '2026-07': raiz + 'main/historico/2026-07.json',
    '2026-08': raiz + 'main/historico/2026-08.json',
    '2026-09': raiz + 'main/historico/2026-09.json',
    '2026-10': raiz + 'ef8528748de24ff6c4fdd64ab7a8b9d6d3a9af03/forecast_data.json'
  };
  // Os JSONs antigos não têm o nome do time, que os cards agora mostram.
  var nomes = { isr: 'Israel Riella', lis: 'Lisdaisy Vieira Costa', stl: 'Stella Niehues', gui: 'Guilherme Lopes Machado' };
  var pasta = pastaHistorico_();
  Object.keys(origens).forEach(function (mesRef) {
    if (arquivoDoMes_(pasta, mesRef)) { Logger.log(mesRef + ': já existe, mantido.'); return; }
    var resp = UrlFetchApp.fetch(origens[mesRef], { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) { Logger.log(mesRef + ': falhou, HTTP ' + resp.getResponseCode()); return; }
    var obj = JSON.parse(resp.getContentText('UTF-8'));
    Object.keys(obj.times || {}).forEach(function (k) { obj.times[k].nome = obj.times[k].nome || nomes[k] || k; });
    pasta.createFile(mesRef + '.json', JSON.stringify(obj, null, 2), 'application/json');
    Logger.log(mesRef + ': importado.');
  });
  Logger.log('Pasta: ' + pasta.getUrl());
}

/* ------------------------------------------------------------------
   VALIDAÇÃO — monta o objeto com a data do forecast_data.json publicado no Pages e
   compara campo a campo. Só atualizado_em, o realizado do dia e as correções listadas
   em motivoConhecido_ podem diferir: qualquer outra diferença indica regra errada.
   ------------------------------------------------------------------ */
function validarContraJson() {
  soNoEditor_('validarContraJson');
  var resp = UrlFetchApp.fetch('https://raw.githubusercontent.com/bri-304/dash-previsao/main/forecast_data.json?t=' + Date.now(), { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('Não consegui baixar o forecast_data.json: HTTP ' + resp.getResponseCode());
  var json = JSON.parse(resp.getContentText('UTF-8'));

  var m = String(json.meta.atualizado_em).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  var ref = m ? { ano: +m[3], mes: +m[2], dia: +m[1] } : hojeSP_();
  var novo = montarForecast_(lerFontes_(abrirPlanilha_()), ref);
  var r = compararForecast_(novo, json, ref);

  Logger.log('JSON de ' + json.meta.atualizado_em + ' | ' + r.campos + ' campos comparados | ' + r.esperadas.length + ' diferenças conhecidas | ' + r.inesperadas.length + ' INESPERADAS');
  var grupos = {};
  r.esperadas.forEach(function (d) { (grupos[d.motivo] = grupos[d.motivo] || []).push(d); });
  Object.keys(grupos).forEach(function (motivo) {
    Logger.log('[conhecida] ' + motivo + ' (' + grupos[motivo].length + ')');
    grupos[motivo].slice(0, 10).forEach(function (d) {
      Logger.log('   ' + d.caminho + ': json=' + JSON.stringify(d.json).slice(0, 120) + ' novo=' + JSON.stringify(d.novo).slice(0, 120));
    });
  });
  r.inesperadas.forEach(function (d) {
    Logger.log('[INESPERADA] ' + d.caminho + ': json=' + JSON.stringify(d.json).slice(0, 200) + ' novo=' + JSON.stringify(d.novo).slice(0, 200));
  });
  return { campos: r.campos, conhecidas: r.esperadas.length, inesperadas: r.inesperadas.length };
}
