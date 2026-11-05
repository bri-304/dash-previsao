// Confere as regras fora do Apps Script: carrega src/Regras.gs num vm do node, monta o objeto com a
// aba bruta real e compara com um forecast_data.json. As abas da IA saem do próprio JSON, então isto
// testa as regras de vendas, times e textos; a leitura real das abas é conferida por validarContraJson().
// Uso: node scripts/testar-regras.js <dump da aba bruta: {values:[[...]]}> <forecast.json> [AAAA-MM-DD]
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const contexto = {};
vm.createContext(contexto);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Regras.gs'), 'utf8'), contexto);

const bruta = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).values;
const json = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const cab = bruta[0];
const col = (n) => cab.indexOf(n);
const vendas = bruta.slice(1).map((r) => ({
  id: String(r[col('ID_LEAD')] || '').trim(),
  consultor: String(r[col('CONSULTOR')] || '').trim(),
  produtoMeta: r[col('PRODUTO_CONTA_META')] || '',
  data: contexto.normalizarData_(r[col('DATA_PAGAMENTO')]),
  area: r[col('AREA')] || '',
  status: r[col('STATUS_LEAD')] || '',
  contar: r[col('CONTAR_VENDA')] || '',
  gerente: String(r[col('NOME_GERENTE_ATUAL')] || '').trim(),
}));

// data de referência = a do JSON
const ref = process.argv[4] || json.meta.atualizado_em.replace(/^(\d{2})\/(\d{2})\/(\d{4}).*/, '$3-$2-$1');
const [ano, mes, dia] = ref.split('-').map(Number);

const chavesIA = ['badge_consoliga', 'badge_copa', 'kpi_total_central', 'kpi_total_pess', 'kpi_total_otim', 'kpi_total_delta',
  'kpi_media_central', 'kpi_media_min', 'kpi_media_max', 'kpi_media_delta', 'kpi_yoy_pct', 'kpi_yoy_pess', 'kpi_yoy_otim',
  'kpi_yoy_sub', 'footer_linha1', 'footer_linha2', 'footer_linha3'];
const camposIA = {};
chavesIA.forEach((k) => { camposIA[k] = json.meta[k]; });

const configTimes = [];
Object.entries(json.times).forEach(([k, t]) => {
  configTimes.push({ time: k, chave: k + '_prev_atual', valor: t.prev_atual });
  configTimes.push({ time: k, chave: k + '_destaque_txt', valor: t.destaque_txt });
  configTimes.push({ time: k, chave: k + '_atencao_txt', valor: t.atencao_txt });
});
if (!json.times.stl) configTimes.push({ time: 'stl', chave: 'stl_prev_atual', valor: '49' });

const fontes = {
  vendas,
  camposIA,
  configTimes,
  semanas: json.semanas.map((s) => ({ n: s.n, dates: s.dates, central: s.central, min: s.min, max: s.max, avg_txt: s.avg_txt, color: s.color })),
  semanaTags: json.semanas.flatMap((s) => s.tags.map((t) => ({ semana: s.n, cls: t.cls, txt: t.txt }))),
  sugestoes: json.sugestoes.map((s) => ({ n: parseInt(s.n, 10), titulo: s.titulo, descricao_html: s.descricao_html, tags: s.tags.join(';') })),
  gargalos: json.gargalos,
  // tipo da previsão: o que o JSON guarda, sem real/partial, que dependem das vendas
  diasPrevisao: json.dias.map((d) => ({ dia_num: d[0], dia_semana: d[1], central: d[2], min: d[3], max: d[4], tipo: d[5] === 'real' || d[5] === 'partial' ? 'work' : d[5], evento: d[6] })),
  inativos: parseInt(String(json.meta.kpi_inativos_delta).replace(/\D/g, ''), 10),
  atualizadoEm: 'TESTE',
};

const novo = contexto.montarForecast_(fontes, { ano, mes, dia });
const r = contexto.compararForecast_(novo, json, { ano, mes, dia });
console.log(`Referência ${ref} | campos comparados ${r.campos} | conhecidas ${r.esperadas.length} | INESPERADAS ${r.inesperadas.length}`);
const resumo = {};
r.esperadas.forEach((d) => { (resumo[d.motivo] = resumo[d.motivo] || []).push(`${d.caminho}: ${JSON.stringify(d.json)} → ${JSON.stringify(d.novo)}`); });
Object.entries(resumo).forEach(([m, itens]) => {
  console.log(`\n[conhecida] ${m} (${itens.length})`);
  itens.slice(0, 8).forEach((i) => console.log('   ' + i));
  if (itens.length > 8) console.log(`   ... mais ${itens.length - 8}`);
});
if (r.inesperadas.length) {
  console.log('\nINESPERADAS:');
  r.inesperadas.slice(0, 60).forEach((d) => console.log(`   ${d.caminho}: json=${JSON.stringify(d.json)} novo=${JSON.stringify(d.novo)}`));
}
process.exitCode = r.inesperadas.length ? 1 : 0;
