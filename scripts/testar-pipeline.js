// Confere as contas de src/Pipeline.gs fora do Apps Script, com uma base feita à mão.
// Uso: node scripts/testar-pipeline.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {};
vm.createContext(ctx);
['Regras.gs', 'Metricas.gs', 'Pipeline.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx));
const puro = (v) => JSON.parse(JSON.stringify(v));
const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);

// --- datas
const n5 = ctx.diaNum_('2026-11-05');
assert.strictEqual(ctx.isoDoNum_(n5), '2026-11-05');
assert.strictEqual(ctx.semanaDoNum_(n5), 4, '05/11/2026 é quinta');
assert.strictEqual(ctx.semanaDoNum_(ctx.diaNum_('2026-11-01')), 0, '01/11/2026 é domingo');
assert.deepStrictEqual([0, 1, 2, 3, 6, 7, 29, 30, 44, 45, 119, 120, 179, 500].map((i) => ctx.PIPE.IDADES[ctx.faixaIdade_(i)]), [0, 1, 2, 3, 6, 7, 29, 30, 30, 45, 90, 120, 120, 180]);

// --- base: [id, criado, finalização, data_funil_comercial, etapa, marcas (1-5), contar, pagamento, área, produto, origem, campanha, keyword]
const somar = (iso, d) => ctx.isoDoNum_(ctx.diaNum_(iso) + d);
const linhas = [];
const lead = (o) => linhas.push(Object.assign({ fin: 'Perda', etapa: '1-MQL - VALIDAÇÃO', marcas: 1, contar: '', pago: '', area: 'FRANQUIA / COMERCIAL', prod: 'Sim', origem: 'Google', campanha: 'Marca', kw: 'registro de marca' }, o));
// 100 leads criadas em 01/09: 50 pagam com 2 dias de idade, 50 são perdidas com 10 dias em MQL
for (let k = 0; k < 100; k++) {
  const pagou = k < 50;
  lead({ id: 'a' + k, criado: '2026-09-01', fin: pagou ? 'Ganho' : 'Perda', dfc: pagou ? '2026-09-03' : '2026-09-11',
    etapa: pagou ? '5-PENDENTE JURÍDICO' : '1-MQL - VALIDAÇÃO', marcas: pagou ? 5 : 1, contar: pagou ? '1' : '', pago: pagou ? '2026-09-03' : '',
    kw: k < 30 ? 'registro de marca' : 'como registrar' });
}
lead({ id: 'a0', criado: '2026-09-01', fin: 'Perda', dfc: '2026-09-11' });                                // repetida: fica a que pagou
lead({ id: 'b1', criado: '2026-09-01', fin: 'Perda', dfc: '2026-09-02', area: 'BACKOFFICE / JURÍDICO' });  // backoffice: fora
lead({ id: 'b2', criado: '2026-09-01', fin: 'Perda', dfc: '2026-09-02', prod: 'Não' });                    // serviço: fora
lead({ id: 'b3', criado: '2026-09-01', fin: 'Interesse em Parceria', dfc: '2026-09-02' });                 // parceria: fora
lead({ id: 'b4', criado: '2026-09-01', fin: 'Ganho Cobrança', dfc: '2026-09-05', marcas: 5, contar: '1', pago: '2026-09-05' }); // cobrança: não conta como venda
// leads abertas hoje
lead({ id: 'p1', criado: '2026-11-03', fin: 'Pipeline', dfc: '2026-11-05', etapa: '4-ASSINATURA E PAGAMENTO', marcas: 4 });
// criada hoje, com keyword que não aparece em mais nenhuma lead, e uma fechada antes da criação (base com erro)
lead({ id: 'p3', criado: '2026-11-05', fin: 'Pipeline', dfc: '2026-11-05', kw: 'keyword nova de hoje' });
lead({ id: 'b5', criado: '2026-09-10', fin: 'Perda', dfc: '2026-09-01', kw: 'keyword com data trocada' });
lead({ id: 'p2', criado: '2026-05-01', fin: 'Pipeline', dfc: '2026-11-05', etapa: '1-MQL - VALIDAÇÃO', marcas: 1 });

const nomes = ['id_lead', 'criado_em', 'finalizacao', 'data_funil_comercial', 'etapa', 'mql', 'prospeccao', 'oportunidades', 'documentacao', 'pagamento',
  'CONTAR_VENDA', 'DATA_PAGAMENTO', 'AREA', 'PRODUTO_CONTA_META', 'origem_lead', 'campanha', 'PPC_KEYWORD'];
assert.deepStrictEqual(nomes, puro(ctx.COLUNAS_PIPE));
const t = { n: linhas.length };
nomes.forEach((c) => { t[c] = []; });
linhas.forEach((l) => {
  t.id_lead.push(l.id); t.criado_em.push(l.criado); t.finalizacao.push(l.fin); t.data_funil_comercial.push(l.dfc); t.etapa.push(l.etapa);
  ['mql', 'prospeccao', 'oportunidades', 'documentacao', 'pagamento'].forEach((m, i) => t[m].push(i < l.marcas ? '1' : ''));
  t.CONTAR_VENDA.push(l.contar); t.DATA_PAGAMENTO.push(l.pago); t.AREA.push(l.area); t.PRODUTO_CONTA_META.push(l.prod);
  t.origem_lead.push(l.origem); t.campanha.push(l.campanha); t.PPC_KEYWORD.push(l.kw);
});

const leads = puro(ctx.leadsDoPipeline_(t));
assert.strictEqual(leads.length, 105, '100 + cobrança + data trocada + 3 abertas');
assert.ok(leads.find((l) => l.id === 'a0').pago !== null, 'a repetida não apaga a venda');
assert.strictEqual(leads.find((l) => l.id === 'b4').pago, null, 'Ganho Cobrança não é venda');
const p1 = leads.find((l) => l.id === 'p1');
assert.strictEqual(p1.aberta, true);
assert.strictEqual(p1.etapaAtual, 4);
assert.strictEqual(leads.find((l) => l.id === 'a1').etapaMax, 4, 'pendente jurídico conta como a última etapa aberta');

// --- chances: das 100 leads de 01/09, metade paga no dia 2 da vida
const ontem = ctx.diaNum_('2026-11-04');
const h = ctx.chancesPorEtapa_(ctx.leadsDoPipeline_(t), ontem);
perto(h[1][0][2], 50 / 101, 'idade 0, pagar 2 dias depois (101 leads, contando a de cobrança; a de data trocada não entra)');
perto(h[1][0][0] + h[1][0][1], 0, 'ninguém pagou antes');
perto(h[1][1][1], 50 / 101, 'idade 1: paga no dia seguinte');
perto(h[4][0][2], 50 / 51, 'quem chegou ao fim do funil: quase todas pagaram');
perto(h[1][7][0] + h[1][30][0], 0, 'depois de 7 dias ninguém mais paga');

// --- segmentos: "registro de marca" (30 das 50 vendas em 30 leads) vende acima do esperado
const mult = ctx.multiplicadores_(ctx.leadsDoPipeline_(t), h, ontem);
const kwBoa = 'Google › Marca › registro de marca', kwRuim = 'Google › Marca › como registrar';
assert.ok(mult.inicio.mult[kwBoa] > 1 && mult.inicio.mult[kwRuim] < 1, 'keyword melhor acima de 1 e pior abaixo');
assert.ok(mult.inicio.mult[kwBoa] < 30 / (30 * 50 / 101), 'encolhida para o grupo de cima');

// --- previsão completa
const r = puro(ctx.previsaoPipeline_(t, { ano: 2026, mes: 11, dia: 5 }, ['2026-11-15', '2026-11-20'], { minuto: 780, vendas: Array.from({ length: 100 }, (_, k) => 480 + k * 6) }));
assert.ok(r.hoje_restante && r.hoje_restante.fracao_do_dia === 0.49 && r.hoje_restante.total >= 0, 'restante de hoje');
assert.strictEqual(puro(ctx.previsaoPipeline_(t, { ano: 2026, mes: 11, dia: 5 }, [])).hoje_restante, null, 'sem curva, sem hoje');
assert.strictEqual(r.hoje, '2026-11-05');
assert.strictEqual(r.dias.length, 25, 'de 06 a 30/11');
assert.strictEqual(r.dias[0].data, '2026-11-06');
assert.strictEqual(r.abertas.total, 3);
assert.ok(r.dias.every((d) => d.total >= 0 && Math.abs(d.total - d.pipeline - d.novas) < 0.02), 'total = abertas + novas');
perto(r.dias[0].pipeline + r.dias[1].pipeline, 0, 'p1 tem 2 dias: na base, quem paga paga com 2 dias, e isso já passou');
assert.strictEqual(r.chances.length, 4);
assert.strictEqual(r.chances[3].faixas[1].abertas, 1, 'p1 em assinatura, faixa 1–2 dias');
assert.strictEqual(r.abertas.paradas, 2, 'p1 e p2 têm idade em que ninguém mais pagou; p3 (0 dia) ainda pode pagar');
assert.ok(r.segmentos[0].keywords.melhores.length >= 1);
assert.ok(r.teste.dias > 0 && r.teste.linhas.every((l) => l.realizado === 0), 'no teste (outubro) não houve vendas');

// --- pesos dos dias da semana somam 7 (média 1) quando há vendas na janela
perto(puro(ctx.pesosSemana_(ctx.leadsDoPipeline_(t), ctx.diaNum_('2026-09-10'), {})).reduce((a, b) => a + b, 0), 7, 'pesos');
const novas = puro(ctx.novasPorSemana_(ctx.leadsDoPipeline_(t), ctx.diaNum_('2026-09-10')));
perto(novas[2], 101 / 4, 'leads novas numa terça (01/09), em 4 terças da janela');

// --- posição no mês: novembro/2026 com feriados em 02, 15 e 20
const fer = {};
['2026-11-02', '2026-11-15', '2026-11-20'].forEach((d) => { fer[ctx.diaNum_(d)] = 1; });
const pos = (iso) => ctx.posicaoNoMes_(ctx.diaNum_(iso), fer);
assert.deepStrictEqual(['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-23', '2026-11-24', '2026-11-30'].map(pos),
  [null, 'inicio', 'inicio', 'meio', null, 'meio', 'fim', 'fim'], '3 primeiros e 5 últimos dias úteis');
// pesos por posição: com vendas só no começo do mês, o começo pesa mais
const lp = [];
for (let m = 5; m <= 10; m++) for (let k = 0; k < 4; k++) lp.push({ pago: ctx.diaNum_(`2026-${String(m).padStart(2, '0')}-0${k < 2 ? 2 : 3}`) });
const pp = puro(ctx.pesosPosicao_(lp, ctx.diaNum_('2026-11-04'), {}));
assert.ok(pp.inicio > 1 && pp.meio === 0 && pp.fim === 0, 'só o começo tem vendas');

// --- horário das vendas: 00:00 e 08:00 ficam de fora; venda de hoje e antiga também
const tv = { n: 5, DATA_PAGAMENTO: ['2026-11-04', '2026-11-04', '2026-11-03', '2026-11-05', '2025-01-01'],
  HORA_PAGAMENTO: ['10:30:00', '08:00:00', 0.75, '15:00:00', '11:00:00'], PRODUTO_CONTA_META: ['Sim', 'Sim', 'Sim', 'Sim', 'Sim'], CONTAR_VENDA: ['1', '1', '1', '1', '1'] };
assert.deepStrictEqual(puro(ctx.minutosDasVendas_(tv, ctx.diaNum_('2026-11-05'))), [630, 1080], '10:30 e 18:00 (0,75 do dia)');
const curva = Array.from({ length: 100 }, (_, k) => 480 + k * 6);   // vendas espalhadas das 8h às 17h54
perto(ctx.fracaoRestante_(curva, 780), 49 / 100, 'às 13h falta pouco menos da metade');
assert.strictEqual(ctx.fracaoRestante_([600], 780), null, 'poucas vendas: sem curva');

console.log('testar-pipeline: ok');
