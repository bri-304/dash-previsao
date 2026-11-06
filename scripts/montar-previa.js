// Prévia local da página, sem Apps Script: junta index + css + js e troca o google.script.run por dados de exemplo.
// Uso: node scripts/montar-previa.js <objeto.json> <saida.html> [ok|erro|lento] [pipeline.json]
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'src');
const ler = (n) => fs.readFileSync(path.join(src, n), 'utf8');
const dados = fs.readFileSync(process.argv[2], 'utf8');
const modo = process.argv[4] || 'ok';
const pipe = process.argv[5] ? fs.readFileSync(process.argv[5], 'utf8') : '';

const stub = `<script>
window.__DADOS = ${JSON.stringify(dados)};
window.__MODO = ${JSON.stringify(modo)};
window.__PIPE = ${JSON.stringify(pipe)};
window.google = { script: {
  url: { getLocation(cb) { cb({ parameter: {} }); } },
  history: { replace() {} },
  run: (function criar(ok, falha) {
    const api = {
      withSuccessHandler: (f) => criar(f, falha),
      withFailureHandler: (f) => criar(ok, f),
    };
    const responde = (fn) => setTimeout(fn, window.__MODO === 'lento' ? 60000 : 200);
    api.getForecastData = (mes) => responde(() => {
      if (window.__MODO === 'erro') return falha(new Error('A aba "Dados Leads 100% Pagas" está sem linhas (carga em andamento?).'));
      if (window.__MODO === 'login') return falha(new Error('LOGIN'));
      if (mes === '2026-09') return falha(new Error('Não há histórico salvo de Setembro/2026.'));
      ok(window.__DADOS);
    });
    api.getContexto = () => responde(() => ok({ email: 'dona@exemplo', dona: true, mesAtual: '2026-11', mesAnterior: '2026-10',
      meses: [{ id: '2026-09', label: 'Setembro/2026' }, { id: '2026-10', label: 'Outubro/2026' }] }));
    api.salvarSnapshot = () => responde(() => ok({ label: 'Novembro/2026' }));
    api.getPrevisaoPipeline = () => responde(() => window.__PIPE ? ok(window.__PIPE) : falha(new Error('Sem pipeline na prévia.')));
    return api;
  })(() => {}, () => {}),
} };
</script>`;

let html = ler('index.html')
  .replace("<?!= include('css') ?>", () => ler('css.html'))
  .replace("<?!= include('js') ?>", () => stub + ler('js.html'))
  .replace('<?!= sessaoJson ?>', '"sessao-exemplo"')
  .replace('<?!= bilheteJson ?>', '""')
  .replace('<?!= urlJson ?>', '"#"')
  .replace('<base target="_top">', '');
fs.writeFileSync(process.argv[3], html);
console.log('ok', html.length);
