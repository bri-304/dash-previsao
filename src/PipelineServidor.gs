/* ------------------------------------------------------------------
   PREVISÃO PELO PIPELINE — leitura, arquivo do dia no Drive, gatilho e página.
   Contas em Pipeline.gs. O gatilho refaz a conta de hora em hora e se instala sozinho
   quando a dona abre o dash. Sem arquivo do dia, a página calcula na hora.
   Um arquivo por dia (o último cálculo do dia fica): é o registro do que foi previsto,
   para comparar com o realizado depois.
   ------------------------------------------------------------------ */

var CONFIG_PIPE = {
  PASTA: 'Previsão pelo pipeline',
  HORA_INICIO: 7,          // o gatilho não roda de madrugada
  HORA_FIM: 22,            // nem às 23h, quando a foto diária usa a trava
  PREFIXO_CACHE: 'pipe_v2_',
  MINUTOS_VELHO: 120,      // arquivo do dia mais velho que isso é refeito ao abrir a página
  ABA_FERIADOS: 'Feriados e Dias Úteis'   // na planilha da IA (CONFIG.ID_PLANILHA)
};

function pastaPipeline_() {
  return subpastaHistorico_('PASTA_PIPELINE_ID', CONFIG_PIPE.PASTA);
}

// Feriados de todos os meses: aba "Feriados e Dias Úteis" da planilha da IA (DATA preenchida e FERIADO NACIONAL = SIM),
// mais os dias marcados como holiday na previsão do mês. Sem a aba, só os da previsão.
function feriadosParaPipeline_(ss, h) {
  var lista = [];
  try {
    lerObjetos_(ss, CONFIG_PIPE.ABA_FERIADOS).forEach(function (l) {
      var d = normalizarData_(l.DATA);
      if (d && semAcento_(l['FERIADO NACIONAL']) === 'sim') lista.push(d);
    });
  } catch (e) { console.warn('Aba de feriados indisponível: ' + e); }
  var mesAba = pad2_(h.mes) + '/' + h.ano;
  lerObjetos_(ss, CONFIG.ABA_DIAS_PREVISAO).forEach(function (l) {
    if (String(l.mes || '').trim() === mesAba && String(l.tipo || '').trim().toLowerCase() === 'holiday') lista.push(ymd_(h.ano, h.mes, inteiro_(l.dia_num)));
  });
  return lista;
}

// Horário das vendas recentes, para o restante de hoje. Falhou: a página só não mostra o dia de hoje.
function agoraParaPipeline_(h) {
  try {
    var t = comRepeticao_(function () {
      return lerColunasMetricas_(CONFIG.ID_PLANILHA_VENDAS, CONFIG.ABA_VENDAS, ['DATA_PAGAMENTO', 'HORA_PAGAMENTO', 'PRODUTO_CONTA_META', 'CONTAR_VENDA']);
    });
    var p = Utilities.formatDate(new Date(), fuso_(), 'H:mm').split(':');
    return { minuto: +p[0] * 60 + +p[1], vendas: minutosDasVendas_(t, diaNum_(ymd_(h.ano, h.mes, h.dia))) };
  } catch (e) {
    console.warn('Horário das vendas indisponível: ' + e);
    return null;
  }
}

function calcularPipeline_() {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(150000)) throw new Error('A previsão pelo pipeline está sendo calculada agora. Tente de novo em alguns minutos.');
  try {
    var h = hojeSP_();
    var t = comRepeticao_(function () {
      return lerColunasMetricas_(CONFIG_METRICAS.PLANILHA_FUNIL, CONFIG_METRICAS.ABA_FUNIL, COLUNAS_PIPE);
    });
    var r = previsaoPipeline_(t, h, feriadosParaPipeline_(abrirPlanilha_(), h), agoraParaPipeline_(h));
    r.gerado_em = Utilities.formatDate(new Date(), fuso_(), 'dd/MM/yyyy HH:mm');
    var texto = JSON.stringify(r), nome = 'pipeline-' + r.hoje + '.json', pasta = pastaPipeline_();
    var achados = pasta.getFilesByName(nome);
    if (achados.hasNext()) achados.next().setContent(texto);
    else pasta.createFile(nome, texto, 'application/json');
    try { CacheService.getScriptCache().put(CONFIG_PIPE.PREFIXO_CACHE + r.hoje, texto, 3600); } catch (e) { /* maior que o limite */ }
    return texto;
  } finally {
    trava.releaseLock();
  }
}

function lerPipelineDeHoje_() {
  var h = hojeSP_(), iso = ymd_(h.ano, h.mes, h.dia), cache = CacheService.getScriptCache();
  var guardado = cache.get(CONFIG_PIPE.PREFIXO_CACHE + iso);
  if (guardado) return guardado;
  var achados = pastaPipeline_().getFilesByName('pipeline-' + iso + '.json');
  if (!achados.hasNext()) return '';
  var texto = achados.next().getBlob().getDataAsString('UTF-8');
  // Arquivo de outra versão da conta, ou de mais de 2 horas (gatilho parado): a página recalcula.
  var r = JSON.parse(texto), m = String(r.gerado_em || '').match(/(\d{2}):(\d{2})$/);
  var agora = Utilities.formatDate(new Date(), fuso_(), 'H:mm').split(':');
  if (r.versao !== PIPE.VERSAO || !m || (+agora[0] * 60 + +agora[1]) - (+m[1] * 60 + +m[2]) > CONFIG_PIPE.MINUTOS_VELHO) return '';
  try { cache.put(CONFIG_PIPE.PREFIXO_CACHE + iso, texto, 300); } catch (e) { /* maior que o limite */ }
  return texto;
}

// Página: texto JSON da previsão de hoje. Sem cálculo do dia ainda, calcula agora (leva alguns segundos).
function getPrevisaoPipeline(token) {
  conferirSessao_(token);
  var texto = lerPipelineDeHoje_() || calcularPipeline_();
  if (ehProjetoTeste_()) return texto;
  // Produção: só o gráfico, os cartões e a tabela de chances (pedido da Brianna). Segmentos e linhas do teste ficam no
  // projeto de teste; as contas são as mesmas, e o arquivo do dia continua completo.
  var r = JSON.parse(texto), t = r.teste || {};
  delete r.segmentos;
  r.teste = { dias: t.dias, erro_pipeline: t.erro_pipeline, erro_media_semana: t.erro_media_semana };
  return JSON.stringify(r);
}

/* ---------- gatilho ---------- */

// Chamado pelo getContexto quando a dona abre o dash. Não duplica.
function garantirGatilhoPipeline_() {
  var tem = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'gatilhoPipeline'; });
  if (!tem) ScriptApp.newTrigger('gatilhoPipeline').timeBased().everyHours(1).create();
}

// Função sem _ no fim pode ser chamada pela página: só roda com o ID de um gatilho deste projeto.
function gatilhoPipeline(e) {
  var uid = e && e.triggerUid ? String(e.triggerUid) : '';
  var deste = uid && ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'gatilhoPipeline' && String(t.getUniqueId()) === uid;
  });
  if (!deste) throw new Error('A previsão pelo pipeline só roda pelo gatilho ou pelo editor.');
  var hora = +Utilities.formatDate(new Date(), fuso_(), 'H');
  if (hora < CONFIG_PIPE.HORA_INICIO || hora > CONFIG_PIPE.HORA_FIM) return;
  try { calcularPipeline_(); }
  catch (err) {
    // Trava ocupada (métricas ou foto rodando) não é erro: a próxima hora refaz.
    if (String(err && err.message).indexOf('sendo calculada') >= 0) return;
    throw err;
  }
}

/* ---------- manutenção (só no editor) ---------- */

function calcularPipelineAgora() {
  soNoEditor_('calcularPipelineAgora');
  var r = JSON.parse(calcularPipeline_());
  Logger.log(JSON.stringify({ gerado_em: r.gerado_em, leads_aprendizado: r.leads_aprendizado, abertas: r.abertas,
    proximos_5: r.proximos_5, ate_fim_do_mes: r.ate_fim_do_mes, teste: { dias: r.teste.dias, erro_pipeline: r.teste.erro_pipeline, erro_media_semana: r.teste.erro_media_semana } }));
}

function removerGatilhoPipeline() {
  soNoEditor_('removerGatilhoPipeline');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'gatilhoPipeline') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Pronto. Abrir o dash como dona instala o gatilho de novo: para desligar de vez, tire a chamada em getContexto.');
}
