/* ------------------------------------------------------------------
   Forecast de vendas — Consolide (app da Web)
   Servidor: abertura, acesso, login, log de acesso e leitura da planilha.
   Regras de negócio em Regras.gs; histórico em Historico.gs.
   Mapa de campos e regras: CLAUDE.md.
   ------------------------------------------------------------------ */

var CONFIG = {
  ID_PLANILHA: '1xO6594dHGlajnzqdNTMrxbtU9_SYXzpDXewtwuTBAV4',   // "Dados IA - Previsão"
  // Vendas: "Dados Vendas Ligações e Funil", com todo o histórico. Também é a base das métricas da IA.
  ID_PLANILHA_VENDAS: '1dPYm8QGUsounTdhPIRunlz5rpSoUrBUYaE7dBp9Tp5s',
  ABA_VENDAS: 'Dados Leads 100% Pagas',
  ABA_CAMPOS_IA: 'Campos_previsao_IA',
  ABA_CONFIG_TIMES: 'Configuracoes times',   // só prev_atual, destaque_txt e atencao_txt de cada time, escritos pela IA
  ABA_SEMANAS: 'semana',
  ABA_SEMANA_TAGS: 'semana-tags',
  ABA_SUGESTOES: 'sugestoes-estratégias',
  ABA_GARGALOS: 'campos-gargalos',
  ABA_DIAS_PREVISAO: 'Vendas Previstas por dia Mês Atual',
  ABA_ACESSO: 'Emails Autorizados',
  ABA_LOG_ACESSO: 'Logs de Acesso',
  DIAS_LOG_ACESSO: 90,
  // Jornada de Estrelas: os desmarcados são o "inativos / férias" do KPI
  ID_PLANILHA_JORNADA: '1GSreiWiW2Ese9hX5xw3tq8JrFeqdlaJCO1K27oMyD0k',
  ABA_JORNADA: 'V3-Geral-Jornada_de_Estrelas_Agentes_e_Franqueados',
  FAIXA_JORNADA: 'D17:D60',
  // No projeto de teste só a dona entra; o resto do código é o mesmo nos dois projetos
  SCRIPT_ID_TESTE: '1nxbIWLV719M78d3Ej6JLM5eLIyxB4axSfFrkV1BHApEJMi99mFgF9RDN',
  URL_OFICIAL: '',   // preencher com o /exec da implantação oficial quando ela existir, no formato com /a/~/
  PASTA_HISTORICO: 'Forecast - Histórico',
  MINUTOS_CACHE: 5   // 0 desliga
};

// Mude quando o formato do objeto mudar: invalida o cache antigo na hora.
var PREFIXO_CACHE = 'forecast_v3_';

var COLUNAS_VENDAS = {
  id: 'ID_LEAD', consultor: 'CONSULTOR', produtoMeta: 'PRODUTO_CONTA_META', data: 'DATA_PAGAMENTO',
  area: 'AREA', status: 'STATUS_LEAD', contar: 'CONTAR_VENDA', gerente: 'NOME_GERENTE_ATUAL'
};

/* ------------------------------------------------------------------
   ACESSO
   Roda como a dona (lê a planilha sem compartilhar com ninguém). Quem vê o
   dash = quem está na aba CONFIG.ABA_ACESSO, coluna A, e-mail completo por
   linha. A dona entra sempre. No projeto de teste, só a dona.
   ------------------------------------------------------------------ */
function emailDono_() {
  try { return String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase(); }
  catch (e) { return ''; }
}

// Função sem _ no fim pode ser chamada pela página: as de manutenção só rodam no editor, pela dona.
function soNoEditor_(nome) {
  if (String(Session.getActiveUser().getEmail() || '').trim().toLowerCase() !== emailDono_()) {
    throw new Error('Rode ' + nome + ' pelo editor do Apps Script.');
  }
}

function ehProjetoTeste_() { return !!CONFIG.SCRIPT_ID_TESTE && ScriptApp.getScriptId() === CONFIG.SCRIPT_ID_TESTE; }
function abrirPlanilha_() { return SpreadsheetApp.openById(CONFIG.ID_PLANILHA); }

function temAcesso_(email, ss) {
  if (!email) return false;
  if (email === emailDono_()) return true;
  if (ehProjetoTeste_()) return false;
  var aba = ss.getSheetByName(CONFIG.ABA_ACESSO);
  if (!aba) return false;
  var valores = aba.getDataRange().getValues();
  for (var i = 0; i < valores.length; i++) {
    if (String(valores[i][0] || '').trim().toLowerCase() === email) return true;
  }
  return false;
}

// Toda função de dados começa aqui: exige a sessão e relê a lista, sem cache.
function conferirSessao_(token) {
  var email = emailDoToken_(token);
  if (!email) throw new Error('LOGIN');
  var ss = abrirPlanilha_();
  if (!temAcesso_(email, ss)) throw new Error('SEMACESSO:' + email);
  return { email: email, ss: ss };
}

/* ------------------------------------------------------------------
   LOGIN — "Entrar com o Google", mesmo fluxo do dash de leads
   - SESSÃO: abre os dados. Vai só para o localStorage, nunca para a URL.
   - BILHETE (?tk=): só faz o doGet entregar a página, sem números.
   Propriedades do script: OAUTH_CLIENT_ID e OAUTH_CLIENT_SECRET (Google Cloud);
   TOKEN_SECRET é criado sozinho. O /exec e o /dev usados, no formato com /a/~/ (urlBase_),
   precisam estar nos URIs de redirecionamento autorizados da credencial.
   ------------------------------------------------------------------ */
var LOGIN = {
  URL_AUTORIZAR: 'https://accounts.google.com/o/oauth2/v2/auth',
  URL_TOKEN: 'https://oauth2.googleapis.com/token'
};

function prop_(nome) { return PropertiesService.getScriptProperties().getProperty(nome) || ''; }

function segredoToken_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('TOKEN_SECRET', s); }
  return s;
}

// Endereço com /a/~/: com conta Google logada, o Google pode redirecionar o /macros/s/.../exec para
// /macros/u/1/... e dar o erro do Drive "Não foi possível abrir o arquivo", antes do doGet (Samsung, Safari).
// Este também é o redirect_uri do login: precisa estar igual nos URIs da credencial.
function urlBase_() { return ScriptApp.getService().getUrl().replace(/^https:\/\/script\.google\.com\/.*?\/s\//, 'https://script.google.com/a/~/macros/s/'); }
function b64u_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }
function assinar_(texto) { return b64u_(Utilities.computeHmacSha256Signature(texto, segredoToken_())); }

function novoToken_(obj) {
  var payload = b64u_(Utilities.newBlob(JSON.stringify(obj)).getBytes());
  return payload + '.' + assinar_(payload);
}
function criarToken_(email) { return novoToken_({ e: email, i: Math.floor(Date.now() / 1000) }); }
function criarBilhete_(email) { return novoToken_({ e: email, k: 'url', i: Math.floor(Date.now() / 1000) }); }

function lerToken_(token) {
  try {
    if (!token || String(token).indexOf('.') < 0) return null;
    var p = String(token).split('.');
    if (assinar_(p[0]) !== p[1]) return null;
    var obj = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(p[0])).getDataAsString());
    return obj && obj.e ? obj : null;
  } catch (e) { return null; }
}

function emailDoToken_(token) {
  var obj = lerToken_(token);
  return !obj || obj.k === 'url' ? '' : String(obj.e).trim().toLowerCase();
}
function emailDoBilhete_(token) {
  var obj = lerToken_(token);
  return !obj || obj.k !== 'url' ? '' : String(obj.e).trim().toLowerCase();
}

// Tela de entrada com sessão já guardada no navegador: troca por um bilhete e volta para o dash.
function urlComBilhete(token) {
  var email = emailDoToken_(token);
  if (!email) throw new Error('LOGIN');
  return urlBase_() + '?tk=' + encodeURIComponent(criarBilhete_(email));
}

// Se um link com ?tk= vazar: rode no editor. Todo token emitido deixa de valer.
function encerrarTodasAsSessoes() {
  soNoEditor_('encerrarTodasAsSessoes');
  PropertiesService.getScriptProperties().deleteProperty('TOKEN_SECRET');
  segredoToken_();
}

function iniciarLogin() {
  var clientId = prop_('OAUTH_CLIENT_ID');
  if (!clientId) throw new Error('Login não configurado: falta OAUTH_CLIENT_ID nas propriedades do script.');
  var state = Utilities.getUuid();
  CacheService.getScriptCache().put('login_state_' + state, '1', 600);
  var q = { client_id: clientId, redirect_uri: urlBase_(), response_type: 'code', scope: 'openid email', state: state, prompt: 'select_account' };
  var partes = Object.keys(q).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); });
  return LOGIN.URL_AUTORIZAR + '?' + partes.join('&');
}

function emailDoIdToken_(idToken) {
  try {
    var obj = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(idToken.split('.')[1])).getDataAsString());
    if (!obj) return '';
    if (prop_('OAUTH_CLIENT_ID') && obj.aud !== prop_('OAUTH_CLIENT_ID')) return '';
    if (obj.email_verified === false || obj.email_verified === 'false') return '';
    return String(obj.email || '').trim().toLowerCase();
  } catch (e) { return ''; }
}

function tratarCallbackLogin_(p) {
  var cache = CacheService.getScriptCache();
  // Sem o state guardado quase sempre é F5 na URL do callback: a tela de entrada reaproveita a sessão.
  if (!p.state || !cache.get('login_state_' + p.state)) return paginaEntrada_('login');
  cache.remove('login_state_' + p.state);
  var resp = UrlFetchApp.fetch(LOGIN.URL_TOKEN, {
    method: 'post',
    muteHttpExceptions: true,
    payload: {
      code: p.code,
      client_id: prop_('OAUTH_CLIENT_ID'),
      client_secret: prop_('OAUTH_CLIENT_SECRET'),
      redirect_uri: urlBase_(),
      grant_type: 'authorization_code'
    }
  });
  var dados = null;
  try { dados = JSON.parse(resp.getContentText()); } catch (e) {}
  if (!dados || !dados.id_token) return paginaEntrada_('erro', '', 'Não consegui concluir o login com o Google. Tente de novo.');
  var email = emailDoIdToken_(dados.id_token);
  if (!email) return paginaEntrada_('erro', '', 'O Google não retornou um e-mail verificado.');
  return servirDash_(email, criarToken_(email), criarBilhete_(email));
}

/* ------------------------------------------------------------------
   LOG DE ACESSO — aba CONFIG.ABA_LOG_ACESSO: Data e hora · E-mail · Evento · Ambiente.
   Falha ao gravar nunca impede o acesso.
   ------------------------------------------------------------------ */
function registrarAcesso_(ss, email, evento, minutos) {
  try {
    if (minutos > 0) {
      var cache = CacheService.getScriptCache();
      var chave = 'logacesso_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, email + '|' + evento));
      if (cache.get(chave)) return;
      cache.put(chave, '1', minutos * 60);
    }
    var log = ss.getSheetByName(CONFIG.ABA_LOG_ACESSO) || ss.insertSheet(CONFIG.ABA_LOG_ACESSO);
    if (log.getLastRow() === 0) {
      log.appendRow(['Data e hora', 'E-mail', 'Evento', 'Ambiente']);
      log.setFrozenRows(1);
    }
    log.appendRow([Utilities.formatDate(new Date(), fuso_(), 'dd/MM/yyyy HH:mm:ss'), email || '', evento, ehProjetoTeste_() ? 'teste' : 'produção']);
    limparLogAcesso_(log);
  } catch (e) { /* o registro é complementar */ }
}

function limparLogAcesso_(log) {
  var cache = CacheService.getScriptCache();
  if (cache.get('logacesso_limpeza')) return;
  cache.put('logacesso_limpeza', '1', 6 * 60 * 60);
  var n = log.getLastRow() - 1;
  if (n < 1) return;
  var limite = Date.now() - CONFIG.DIAS_LOG_ACESSO * 86400000;
  var datas = log.getRange(2, 1, n, 1).getDisplayValues();
  var velhas = 0;
  for (var i = 0; i < datas.length; i++) {
    var m = String(datas[i][0]).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m || new Date(+m[3], +m[2] - 1, +m[1]).getTime() >= limite) break;
    velhas++;
  }
  if (velhas) log.deleteRows(2, velhas);
}

/* ------------------------------------------------------------------
   ABERTURA
   ------------------------------------------------------------------ */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.consulta) return metricas_responder_(p);   // plugin do forecast: só com a chave, sem login
  if (p.code) return tratarCallbackLogin_(p);
  if (p.error) return paginaEntrada_('erro', '', 'O login foi cancelado. Tente de novo.');
  var email = emailDoBilhete_(p.tk || '');
  if (!email) return paginaEntrada_('login');
  if (p.pagina === 'metricas') return servirMetricas_(email, p.tk);
  return servirDash_(email, '', p.tk);
}

function include(nome) { return HtmlService.createHtmlOutputFromFile(nome).getContent(); }

function jsonNaPagina_(v) { return JSON.stringify(v === undefined ? '' : v).replace(/</g, '\\u003c'); }

function tituloAba_() {
  var h = hojeSP_();
  return 'Forecast ' + REGRAS.MESES[h.mes - 1] + ' ' + h.ano + ' - Consolide';
}

function servirDash_(email, sessao, bilhete) {
  var ss;
  try { ss = abrirPlanilha_(); }
  catch (err) { return paginaEntrada_('erro', '', 'Não consegui abrir a planilha de dados. Tente de novo em instantes.'); }
  if (!temAcesso_(email, ss)) {
    registrarAcesso_(ss, email, sessao ? 'Tentou entrar sem acesso' : 'Abriu sem estar na lista', 1);
    return paginaEntrada_('semacesso', email);
  }
  registrarAcesso_(ss, email, sessao ? 'Login' : 'Abriu o dash', sessao ? 0 : 10);

  var t = HtmlService.createTemplateFromFile('index');
  t.sessaoJson = jsonNaPagina_(sessao || '');
  t.bilheteJson = jsonNaPagina_(bilhete || '');
  t.urlJson = jsonNaPagina_(urlBase_());
  return t.evaluate()
    .setTitle(tituloAba_())
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function escHtml_(s) {
  return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}

// Tela de entrada, sem acesso ou erro, com o visual do dash. Login em um clique: o endereço do Google
// é pedido ao abrir a página, vira o href do botão (target="_top") e é renovado a cada 8 min.
function paginaEntrada_(modo, email, mensagem) {
  var titulo = 'Não foi possível entrar', texto = escHtml_(mensagem || 'Tente de novo.');
  var rotulo = 'Entrar com o Google', limpar = true, usarGuardada = false;
  if (modo === 'login') {
    titulo = 'Entrar no Forecast';
    texto = 'Entre com a sua conta Google para ver o dash.';
    limpar = false;
    usarGuardada = true;
  } else if (modo === 'semacesso' && ehProjetoTeste_()) {
    titulo = 'Link de teste';
    texto = 'Este é o link de teste do dash, e só a dona abre. Você entrou como <b>' + escHtml_(email) + '</b>.' +
      (CONFIG.URL_OFICIAL ? ' Use o <a href="' + escHtml_(CONFIG.URL_OFICIAL) + '" target="_top">link oficial</a>.' : '');
    rotulo = 'Entrar com outra conta';
    limpar = false;
  } else if (modo === 'semacesso') {
    titulo = 'Sem acesso a este dash';
    texto = 'Você entrou como <b>' + escHtml_(email) + '</b>, e essa conta não está na lista de acessos. ' +
      'Peça para quem administra a planilha adicionar seu e-mail, ou entre com outra conta.';
    rotulo = 'Entrar com outra conta';
  }

  var css = ':root{--bg:#060c19;--card:#0f1b30;--borda:#1a2a44;--azul:#2563eb;--texto:#dde4f0;--suave:#7a93b4;--erro:#ef4444}' +
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--texto);font-family:Barlow,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.45}' +
    '.caixa{width:calc(100% - 32px);max-width:440px;margin:14vh auto 0;background:var(--card);border:1px solid var(--borda);border-radius:12px;padding:30px 28px 26px;text-align:center}' +
    '.logo{display:inline-block;background:var(--azul);color:#fff;font-family:"Barlow Condensed",sans-serif;font-weight:900;font-size:15px;letter-spacing:2.5px;padding:5px 12px;border-radius:4px;margin-bottom:20px}' +
    'h1{margin:0 0 8px;font-family:"Barlow Condensed",sans-serif;font-size:24px;font-weight:800}p{margin:0 0 20px;color:var(--suave)}b{color:var(--texto)}a{color:#3b82f6}' +
    '.botao{display:inline-block;border-radius:8px;background:var(--azul);color:#fff;font-weight:600;padding:11px 20px;text-decoration:none;cursor:pointer}' +
    '.botao[aria-busy="true"]{opacity:.7;cursor:default}.erro{color:var(--erro);font-size:13px;margin-top:12px;min-height:16px}';

  var script = [
    'var ROTULO=' + jsonNaPagina_(rotulo) + ';',
    limpar ? 'try{localStorage.removeItem("forecastToken");}catch(e){}' : '',
    'var b=document.getElementById("b"),e=document.getElementById("e"),pronto=false,renovar=0;',
    'function falhou(err){b.removeAttribute("aria-busy");b.textContent=ROTULO;e.textContent=(err&&err.message)?err.message:"Erro ao iniciar o login.";}',
    'function pedir(){google.script.run.withSuccessHandler(function(u){if(/^https:\\/\\/accounts\\.google\\.com\\//.test(u)){b.href=u;pronto=true;}}).iniciarLogin();}',
    'b.addEventListener("click",function(ev){if(pronto)return;ev.preventDefault();if(b.getAttribute("aria-busy"))return;',
    'b.setAttribute("aria-busy","true");b.textContent="Abrindo o Google…";',
    'google.script.run.withSuccessHandler(function(u){(window.top||window).location.href=u;}).withFailureHandler(falhou).iniciarLogin();});',
    'function semSessao(){pedir();renovar=setInterval(pedir,8*60000);}',
    usarGuardada ?
      'var _t="";try{_t=localStorage.getItem("forecastToken")||"";}catch(x){}' +
      'if(_t){google.script.run.withSuccessHandler(function(u){clearInterval(renovar);b.href=u;pronto=true;b.textContent="Continuar no dash";' +
      'document.querySelector(".caixa p").textContent="Sua sessão ainda vale. Continue para o dash.";' +
      'try{(window.top||window).location.replace(u);}catch(x){}' +
      '}).withFailureHandler(function(){try{localStorage.removeItem("forecastToken");}catch(x){}semSessao();}).urlComBilhete(_t);}else semSessao();'
      : 'semSessao();'
  ].join('');

  var html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@800;900&family=Barlow:wght@400;600&display=swap" rel="stylesheet">' +
    '<style>' + css + '</style></head><body><main class="caixa" aria-labelledby="tit"><span class="logo">CONSOLIDE</span>' +
    '<h1 id="tit">' + escHtml_(titulo) + '</h1><p>' + texto + '</p>' +
    '<a class="botao" id="b" href="#" target="_top">' + escHtml_(rotulo) + '</a><div class="erro" id="e" role="alert"></div></main>' +
    '<script>' + script + '</' + 'script></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('Forecast - Consolide')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ------------------------------------------------------------------
   DADOS — chamado pela página via google.script.run
   ------------------------------------------------------------------ */
function fuso_() { return Session.getScriptTimeZone() || 'America/Sao_Paulo'; }

// O "hoje" usado em tipo e nos filtros de mês vem do fuso do manifesto (America/Sao_Paulo).
function hojeSP_() {
  var p = Utilities.formatDate(new Date(), fuso_(), 'yyyy-MM-dd').split('-');
  return { ano: +p[0], mes: +p[1], dia: +p[2] };
}
function mesRefDe_(h) { return h.ano + '-' + pad2_(h.mes); }

// Dados da abertura da página: quem é, se é a dona (botão de snapshot) e os meses do histórico.
function getContexto(token) {
  var s = conferirSessao_(token);
  var h = hojeSP_(), ant = mesAnterior_(h.ano, h.mes);
  var meses = [];
  try { meses = listarMeses_(); } catch (e) { console.warn('Histórico indisponível: ' + e); }
  return {
    email: s.email,
    dona: s.email === emailDono_(),
    meses: meses,
    mesAtual: mesRefDe_(h),
    mesAnterior: ant.ano + '-' + pad2_(ant.mes)
  };
}

// mesRef vazio ou o mês corrente = dados vivos da planilha; mês anterior = snapshot da pasta do histórico.
// Devolve texto JSON (schema v8): a página compara com o anterior para saber se mudou.
function getForecastData(mesRef, token) {
  var s = conferirSessao_(token);
  var h = hojeSP_();
  if (!mesRef || mesRef === mesRefDe_(h)) return pacoteAtual_(s.ss, h);
  return lerSnapshot_(mesRef);
}

function pacoteAtual_(ss, hoje) {
  var cache = CacheService.getScriptCache();
  var chave = PREFIXO_CACHE + mesRefDe_(hoje) + '-' + pad2_(hoje.dia);
  if (CONFIG.MINUTOS_CACHE > 0) {
    var guardado = cache.get(chave);
    if (guardado) return guardado;
  }
  var texto;
  try {
    texto = JSON.stringify(montarForecast_(lerFontes_(ss), hoje));
  } catch (err) {
    // Na carga do Pentaho uma aba pode ficar vazia por alguns segundos: tenta de novo e nunca guarda a falha.
    Utilities.sleep(5000);
    texto = JSON.stringify(montarForecast_(lerFontes_(ss), hoje));
  }
  if (CONFIG.MINUTOS_CACHE > 0) {
    try { cache.put(chave, texto, CONFIG.MINUTOS_CACHE * 60); } catch (e) { /* maior que o limite do cache */ }
  }
  return texto;
}

function limparCache() {
  soNoEditor_('limparCache');
  var h = hojeSP_();
  CacheService.getScriptCache().remove(PREFIXO_CACHE + mesRefDe_(h) + '-' + pad2_(h.dia));
}

/* ---------- leitura da planilha ---------- */

function abaObrigatoria_(ss, nome) {
  var aba = ss.getSheetByName(nome);
  if (!aba) throw new Error('A aba "' + nome + '" não foi encontrada na planilha.');
  return aba;
}

// Linhas da aba como objetos pelo cabeçalho (linha 1). Valores como aparecem na tela.
function lerObjetos_(ss, nome) {
  var v = abaObrigatoria_(ss, nome).getDataRange().getDisplayValues();
  if (!v.length) return [];
  var cab = v[0].map(function (c) { return String(c).trim(); });
  return v.slice(1).map(function (l) {
    var o = {};
    cab.forEach(function (c, i) { if (c) o[c] = l[i]; });
    return o;
  });
}

function lerChaveValor_(ss, nome) {
  var o = {};
  abaObrigatoria_(ss, nome).getDataRange().getDisplayValues().slice(1).forEach(function (l) {
    var k = String(l[0]).trim();
    if (k) o[k] = l[1];
  });
  return o;
}

function letraColuna_(i) {
  var s = '', n = i + 1;
  while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// Lê só as colunas usadas pela Sheets API. A aba tem todo o histórico: guarda só os meses que o dash pode pedir
// (o atual e os anteriores até o snapshot do mês passado, que olha o mês anterior a ele).
function lerVendas_() {
  var campos = Object.keys(COLUNAS_VENDAS);
  var t = lerColunasMetricas_(CONFIG.ID_PLANILHA_VENDAS, CONFIG.ABA_VENDAS, campos.map(function (c) { return COLUNAS_VENDAS[c]; }));
  var corte = somarMeses_(mesRefDe_(hojeSP_()), -3) + '-01';
  var vendas = [];
  for (var l = 0; l < t.n; l++) {
    var data = normalizarData_(t[COLUNAS_VENDAS.data][l]);
    if (!data || data < corte) continue;
    var v = {};
    campos.forEach(function (c) {
      var x = t[COLUNAS_VENDAS[c]][l];
      v[c] = String(x === undefined || x === null ? '' : x).trim();
    });
    if (!v.id) continue;
    v.data = data;
    vendas.push(v);
  }
  return vendas;
}

// Desmarcados na Jornada de Estrelas. Sem acesso à outra planilha, null: usa o texto já calculado na aba 'Configuracoes mes'.
function lerInativos_() {
  try {
    var v = SpreadsheetApp.openById(CONFIG.ID_PLANILHA_JORNADA).getSheetByName(CONFIG.ABA_JORNADA).getRange(CONFIG.FAIXA_JORNADA).getValues();
    return v.reduce(function (t, l) { return t + (l[0] === false ? 1 : 0); }, 0);
  } catch (e) {
    console.warn('Jornada de Estrelas indisponível: ' + e);
    return null;
  }
}

function lerFontes_(ss) {
  return {
    vendas: lerVendas_(),
    camposIA: lerChaveValor_(ss, CONFIG.ABA_CAMPOS_IA),
    configTimes: lerObjetos_(ss, CONFIG.ABA_CONFIG_TIMES).map(function (l) {
      return { time: String(l.time || '').trim(), chave: String(l.chave || '').trim(), valor: l.valor };
    }).filter(function (l) { return /_(prev_atual|destaque_txt|atencao_txt)$/.test(l.chave); }),
    semanas: lerObjetos_(ss, CONFIG.ABA_SEMANAS),
    semanaTags: lerObjetos_(ss, CONFIG.ABA_SEMANA_TAGS),
    sugestoes: lerObjetos_(ss, CONFIG.ABA_SUGESTOES),
    gargalos: lerObjetos_(ss, CONFIG.ABA_GARGALOS),
    diasPrevisao: lerObjetos_(ss, CONFIG.ABA_DIAS_PREVISAO),
    inativos: lerInativos_(),
    atualizadoEm: Utilities.formatDate(new Date(), fuso_(), 'dd/MM/yyyy HH:mm')
  };
}
