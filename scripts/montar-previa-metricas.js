// Prévia local da página "Métricas da IA", com números de exemplo gerados pelas contas de Metricas.gs.
// Uso: node scripts/montar-previa-metricas.js <saida.html>
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = path.join(__dirname, '..', 'src');
const ler = (n) => fs.readFileSync(path.join(src, n), 'utf8');
const ctx = {};
vm.createContext(ctx);
['Regras.gs', 'Metricas.gs'].forEach((f) => vm.runInContext(ler(f), ctx));

const hoje = { ano: 2026, mes: 11, dia: 4 };
let semente = 7;
const sorteio = (n) => { semente = (semente * 16807) % 2147483647; return semente % n; };

const pessoas = [['Maria Aline da Silva Ferreira', 'Lisdaisy Vieira Costa'], ['Estevam Silverio Tavares', 'Israel Riella'], ['Josilea de Melo Rocha', 'Israel Riella'], ['Makele de Souza Smania', 'Lisdaisy Vieira Costa'], ['Larah Christmann da Silva', 'SEM GERENTE']];
const vendas = [];
let id = 1;
for (let m = 13; m >= 0; m--) {
  const ref = ctx.somarMeses_('2026-11', -m), ano = +ref.slice(0, 4), mes = +ref.slice(5, 7);
  const ultimo = m === 0 ? hoje.dia : ctx.diasNoMes_(ano, mes);
  for (let d = 1; d <= ultimo; d++) {
    const dow = ctx.diaDaSemana_(ano, mes, d), qtd = dow > 5 ? sorteio(4) : 4 + sorteio(24);
    for (let q = 0; q < qtd; q++) {
      const p = pessoas[sorteio(pessoas.length)];
      vendas.push({ id: String(id++), consultor: p[0], gerente: p[1], produtoMeta: 'Sim', contar: '1', status: 'Venda Fechada', data: ctx.ymd_(ano, mes, d),
        area: p[1] === 'SEM GERENTE' ? 'BACKOFFICE / JURÍDICO' : 'FRANQUIA / COMERCIAL', cargo: 'Franqueado', nivel: '4', contratacao: '2024-03-01', desligamento: '' });
    }
  }
}

const cols = ['id_lead', 'consultor', 'gerente', 'criado_em', 'data_perda', 'competencia_venda', 'etapa', 'fase', 'finalizacao', 'mql', 'prospeccao', 'oportunidades', 'documentacao', 'pagamento', 'ganho', 'data_funil_comercial', 'CONTAR_VENDA', 'AREA', 'PRODUTO_CONTA_META', 'CICLO_VENDA_ATE_SER_PAGO'];
const t = { n: 0 };
cols.forEach((c) => { t[c] = []; });
const motivos = ['Não Quer Escutar o Pitch', 'Sem Contato', 'Lead Duplicada', 'Perda de Contato', 'Cliente Sem Dinheiro'];
for (let i = 0; i < 6000; i++) {
  const ref = ctx.somarMeses_('2026-11', -sorteio(12)), dia = ctx.ymd_(+ref.slice(0, 4), +ref.slice(5, 7), 1 + sorteio(27));
  const p = pessoas[sorteio(4)], r = sorteio(100), ganho = r < 8, pipe = r > 85;
  const l = { id_lead: i, consultor: p[0], gerente: p[1], criado_em: dia, data_perda: ganho || pipe ? '' : ctx.ymd_(+ref.slice(0, 4), +ref.slice(5, 7), 28),
    competencia_venda: ganho ? dia : '', etapa: ['1-MQL - VALIDAÇÃO', '2-PROSPECÇÃO', '3-OPORTUNIDADES (OPPs)'][sorteio(3)], fase: motivos[sorteio(5)], finalizacao: ganho ? 'Ganho' : pipe ? 'Pipeline' : 'Perda',
    mql: i, prospeccao: r < 55 ? i : '', oportunidades: r < 25 ? i : '', documentacao: r < 12 ? i : '', pagamento: ganho ? i : '', ganho: ganho ? i : '',
    data_funil_comercial: dia, CONTAR_VENDA: ganho ? 1 : 0, AREA: 'FRANQUIA / COMERCIAL', PRODUTO_CONTA_META: 'Sim', CICLO_VENDA_ATE_SER_PAGO: ganho ? sorteio(12) : '' };
  cols.forEach((c) => t[c].push(l[c]));
  t.n++;
}
const f = ctx.metricasFunil_(t, hoje);

const colsJ = ['ID_PROCESSO', 'PRODUTO_CONTA_META', 'DATA_PENDENTE_JURIDICO', 'DATA_INICIO_REGISTRO', 'DATA_PROTOCOLADO_ANOTACOES', 'QTD_DOCUMENTOS_INCOMPLETOS', 'QUEM_ENVIOU_PENDENTE_JURIDICO', 'Gerente', 'TEMPO_UTIL_SEGUNDOS_INICIO_ATE_PROTOCOLADO', 'TEMPO_PENDENTE_JURIDICO_ATE_INICIO_REGISTRO'];
const tj = { n: 0 };
colsJ.forEach((c) => { tj[c] = []; });
for (let i = 0; i < 300; i++) {
  const d = ctx.ymd_(2026, 9 + sorteio(2), 1 + sorteio(28)), p = pessoas[sorteio(4)];
  [i, 'Sim', d, d, sorteio(5) ? d : '', sorteio(5), p[0], p[1], 40000 + sorteio(60000), 50000 + sorteio(60000)].forEach((v, k) => tj[colsJ[k]].push(v));
  tj.n++;
}

const respostas = ctx.METRICAS.CANAIS.map((canal, k) => {
  const linhas = [];
  for (let m = 13; m >= 0; m--) {
    const ref = ctx.somarMeses_('2026-11', -m), ano = +ref.slice(0, 4), mes = +ref.slice(5, 7), ultimo = m === 0 ? hoje.dia : ctx.diasNoMes_(ano, mes);
    for (let d = 1; d <= ultimo; d++) linhas.push({ dia: ctx.ymd_(ano, mes, d), leads: { atual: sorteio(k === 0 ? 120 : 25) }, vendas: { atual: sorteio(4) }, losts: { atual: sorteio(20) } });
  }
  return { canal, linhas };
});

const indicador = (rotulo) => ctx.compactarIndicadores_({
  periodo: { de: '2026-10-01', ate: '2026-10-31' }, comparativo: { de: '2026-09-01', ate: '2026-09-30' },
  legenda: { lmv: 'Leads movimentadas no período', ten: 'Tentativas de ligação', fal: 'Ligações faladas', pit: 'Pitches', pf: '% Ligação com êxito para falar', ve: 'Vendas de Registro' },
  linhas: pessoas.map((p) => {
    const o = { [rotulo]: p[0], time: p[1], gerente_atual: p[1] };
    ['lmv', 'ten', 'fal', 'pit', 've'].forEach((c) => { o[c] = { atual: sorteio(900), comparativo: sorteio(900) }; });
    o.pf = { atual: 0.42, comparativo: 0.38 };
    return o;
  })
}, [rotulo, 'time', 'gerente_atual']);

const matriz = ctx.metricasMatriz_(vendas, hoje), diaSemana = ctx.metricasDiaSemana_(vendas, hoje);
const pacote = {
  versao: 1, hoje: '2026-11-04', mes_ref: '2026-11', mes_passado: '2026-10', mesmo_mes_ano_passado: '2025-11', gerado_em: '04/11/2026 16:30',
  avisos: ['A aba "Metas por pessoa" ainda não existe: vendedores sem meta e sem a marcação de fora da catraca.'], pendentes: [],
  secoes: {
    vendas_matriz: matriz, vendas_dia_semana: diaSemana,
    vendedores: ctx.metricasVendedores_(vendas, [{ mes: '2026-10', pessoa: pessoas[0][0], meta: 27 }, { mes: '2026-11', pessoa: pessoas[1][0], meta: 0, fora: true }], hoje),
    funil: f.funil, ciclo_e_lost: f.ciclo_e_lost, pipeline: f.pipeline, juridico: ctx.metricasJuridico_(tj, hoje),
    leads_distribuicao: ctx.metricasLeads_(respostas),
    indicadores_mes_passado: { por_time: indicador('time'), por_consultor: indicador('consultor') },
    indicadores_ultimos_7_dias: { por_time: indicador('time'), por_consultor: indicador('consultor') }
  }
};

const secoesFonte = ler('MetricasServidor.gs').match(/var METRICAS_SECOES = (\[[\s\S]*?\n\]);/)[1];
const secoes = vm.runInNewContext(secoesFonte);
const resposta = JSON.stringify({ pacote: JSON.parse(JSON.stringify(pacote)), datas: ['2026-11-04', '2026-10-01'], secoes });

const stub = `<script>
window.google = { script: { run: (function criar(ok, falha) {
  const api = { withSuccessHandler: (f) => criar(f, falha), withFailureHandler: (f) => criar(ok, f) };
  api.getMetricas = () => setTimeout(() => ok(${JSON.stringify(resposta)}), 100);
  api.gerarMetricas = () => setTimeout(() => ok({ pendentes: [], avisos: [], hoje: '2026-11-04' }), 800);
  return api;
})(() => {}, () => {}) } };
try { localStorage.setItem('forecastToken', 'sessao-exemplo'); } catch (e) {}
</script>`;

const html = ler('metricas.html')
  .replace("<?!= include('css') ?>", () => ler('css.html') + stub)
  .replace('<?!= urlJson ?>', '"#"')
  .replace('<?!= bilheteJson ?>', '""')
  .replace('<base target="_top">', '');
fs.writeFileSync(process.argv[2], html);
console.log('ok', html.length, 'pacote', JSON.stringify(pacote).length);
