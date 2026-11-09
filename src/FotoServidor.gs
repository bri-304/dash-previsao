/* ------------------------------------------------------------------
   FOTO DIÁRIA — leitura das bases, gravação no Drive e gatilho das 23h.
   Um arquivo por dia em "Fotos diárias", dentro da pasta do histórico: foto-AAAA-MM-DD.json.
   Contas em Foto.gs. Salva depois de cada grupo: se um falhar ou faltar tempo, o resto fica.
   ------------------------------------------------------------------ */

var CONFIG_FOTO = {
  PASTA: 'Fotos diárias',
  SEGUNDOS_LIMITE: 270,   // passou disso, não começa outro grupo (limite do Apps Script: 6 min)
  HORA_GATILHO: 23,
  COLUNAS_PIPELINE: ['id_lead', 'consultor', 'gerente', 'etapa', 'finalizacao', 'AREA', 'PRODUTO_CONTA_META']
};

function calcularGrupoFoto_(grupo, h, iso, ss) {
  if (grupo === 'previsao') {
    var fontes = comRepeticao_(function () { return lerFontes_(ss); });
    var linha = fontes.diasPrevisao.filter(function (l) { return String(l.mes || '').trim(); })[0];
    return { mes_da_aba: linha ? String(linha.mes).trim() : '', forecast: montarForecast_(fontes, h) };
  }
  if (grupo === 'realizado') return metricasMatriz_(comRepeticao_(lerVendasMetricas_), h);
  if (grupo === 'pipeline') {
    return fotoPipeline_(comRepeticao_(function () {
      return lerColunasMetricas_(CONFIG_METRICAS.PLANILHA_FUNIL, CONFIG_METRICAS.ABA_FUNIL, CONFIG_FOTO.COLUNAS_PIPELINE);
    }));
  }
  if (grupo === 'atividade') {
    var pedido = function (por) {
      return chamarConsultas_({ consulta: 'metrica', painel: 'alerta', por: por, de: iso, ate: iso, comparar_de: iso, comparar_ate: iso, metricas: FOTO_ATIVIDADE.join(',') });
    };
    var porTime = pedido('time'), porConsultor = pedido('consultor');
    return {
      dados_atualizados_em: porTime.dados_atualizados_em || '',
      por_time: fotoIndicadores_(porTime, ['time']),
      por_consultor: fotoIndicadores_(porConsultor, ['consultor', 'time', 'gerente_atual'])
    };
  }
  if (grupo === 'leads') {
    var r = chamarConsultas_({ consulta: 'metrica', painel: 'leads', por: 'canal', de: iso, ate: iso, comparar_de: iso, comparar_ate: iso, metricas: 'leads,vendas,losts' });
    return { dados_da_planilha: r.dados_da_planilha || '', por_canal: fotoLeads_(r) };
  }
  throw new Error('Grupo desconhecido: ' + grupo);
}

function pastaFotos_() {
  return subpastaHistorico_('PASTA_FOTOS_ID', CONFIG_FOTO.PASTA);
}

function lerFoto_(iso) {
  var achados = pastaFotos_().getFilesByName('foto-' + iso + '.json');
  return achados.hasNext() ? JSON.parse(achados.next().getBlob().getDataAsString('UTF-8')) : null;
}

function salvarFoto_(foto) {
  var nome = 'foto-' + foto.data + '.json', pasta = pastaFotos_(), texto = JSON.stringify(foto);
  var achados = pasta.getFilesByName(nome);
  if (achados.hasNext()) achados.next().setContent(texto);
  else pasta.createFile(nome, texto, 'application/json');
}

// continuar = false refaz a foto de hoje; true calcula só os grupos que faltam nela.
function rodarFoto_(continuar) {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(60000)) throw new Error('Outra atualização está em andamento. Tente de novo em alguns minutos.');
  try {
    var inicio = Date.now(), h = hojeSP_(), iso = ymd_(h.ano, h.mes, h.dia);
    var foto = continuar ? lerFoto_(iso) : null;
    if (!foto) foto = { versao: 1, data: iso, mes_ref: mesRefDoDia_(h), gerado_em: '', falhas: {}, secoes: {} };
    var ss = abrirPlanilha_();
    FOTO_GRUPOS.filter(function (g) { return !foto.secoes[g]; }).forEach(function (grupo) {
      if ((Date.now() - inicio) / 1000 > CONFIG_FOTO.SEGUNDOS_LIMITE) {
        foto.falhas[grupo] = 'Faltou tempo nesta rodada.';
        return;
      }
      try {
        foto.secoes[grupo] = calcularGrupoFoto_(grupo, h, iso, ss);
        delete foto.falhas[grupo];
      } catch (e) {
        foto.falhas[grupo] = semChave_(e && e.message ? e.message : e);
      }
      foto.gerado_em = Utilities.formatDate(new Date(), fuso_(), 'dd/MM/yyyy HH:mm');
      salvarFoto_(foto);
    });
    salvarFoto_(foto);
    return foto;
  } finally {
    trava.releaseLock();
  }
}

function resumoFoto_(foto) {
  var s = foto.secoes, atividade = s.atividade ? s.atividade.por_time.filter(function (l) { return l.time === 'Todos os times'; })[0] : null;
  return JSON.stringify({
    data: foto.data, gerado_em: foto.gerado_em, falhas: foto.falhas,
    previsao_do_mes: s.previsao ? s.previsao.mes_da_aba : null,
    realizado_do_dash: s.previsao ? s.previsao.forecast.meta.kpi_realizado : null,
    pipeline: s.pipeline ? { total: s.pipeline.total, por_etapa: s.pipeline.por_etapa } : null,
    atividade_do_dia: atividade,
    consultores_com_movimento: s.atividade ? s.atividade.por_consultor.length : null,
    leads_por_canal: s.leads ? s.leads.por_canal : null,
    pasta: pastaFotos_().getUrl()
  });
}

/* ---------- gatilho ---------- */

// Função sem _ no fim pode ser chamada pela página: só roda com o ID de um gatilho deste projeto.
function gatilhoFotoDiaria(e) {
  var uid = e && e.triggerUid ? String(e.triggerUid) : '';
  var deste = uid && ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'gatilhoFotoDiaria' && String(t.getUniqueId()) === uid;
  });
  if (!deste) throw new Error('A foto diária só roda pelo gatilho ou pelo editor.');
  var foto = rodarFoto_(false), falhas = Object.keys(foto.falhas);
  // O erro faz o Google avisar a dona por e-mail. O que deu certo já está salvo.
  if (falhas.length) throw new Error('Foto de ' + foto.data + ' incompleta: ' + JSON.stringify(foto.falhas) + ' Rode completarFotoDiaria() no editor ainda hoje.');
}

// Rode uma vez no editor. Pode repetir: não duplica o gatilho.
function instalarGatilhoFoto() {
  soNoEditor_('instalarGatilhoFoto');
  removerGatilhoFoto_();
  ScriptApp.newTrigger('gatilhoFotoDiaria').timeBased().everyDays(1).atHour(CONFIG_FOTO.HORA_GATILHO).inTimezone('America/Sao_Paulo').create();
  Logger.log('Gatilho instalado: foto todo dia entre 23h e 0h.');
}

function removerGatilhoFoto() {
  soNoEditor_('removerGatilhoFoto');
  removerGatilhoFoto_();
  Logger.log('Pronto. A foto diária não roda mais neste projeto.');
}

function removerGatilhoFoto_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'gatilhoFotoDiaria') ScriptApp.deleteTrigger(t);
  });
}

/* ---------- manutenção (só no editor) ---------- */

// Refaz a foto de hoje com os dados de agora.
function fotoDiariaAgora() {
  soNoEditor_('fotoDiariaAgora');
  Logger.log(resumoFoto_(rodarFoto_(false)));
}

// Calcula só o que faltou na foto de hoje, sem perder o que já foi salvo.
function completarFotoDiaria() {
  soNoEditor_('completarFotoDiaria');
  Logger.log(resumoFoto_(rodarFoto_(true)));
}
