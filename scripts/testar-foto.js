// Confere as contas de src/Foto.gs fora do Apps Script, com uma base pequena feita à mão.
// Uso: node scripts/testar-foto.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {};
vm.createContext(ctx);
['Regras.gs', 'Metricas.gs', 'Foto.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx));
const puro = (v) => JSON.parse(JSON.stringify(v));

// --- pipeline: [id, consultor, gerente, etapa, finalização, área, produto]
const linhas = [
  ['1', 'Ana', 'Israel Riella', 'Oportunidades', 'Pipeline', 'FRANQUIA / COMERCIAL', 'Sim'],
  ['1', 'Ana', 'Israel Riella', 'Oportunidades', 'Pipeline', 'FRANQUIA / COMERCIAL', 'Sim'],        // repetida: conta uma vez
  ['2', 'Ana', 'Israel Riella', 'Assinatura e pagamento', 'Pipeline', 'FRANQUIA / COMERCIAL', 'Produto ainda não definido'],
  [3, 'Bia', 'Lisdaisy Vieira Costa', 'Oportunidades', 'pipeline', 'FRANQUIA / COMERCIAL', 'Sim'],    // número e minúscula
  ['4', 'Bia', 'Lisdaisy Vieira Costa', 'Oportunidades', 'Perda', 'FRANQUIA / COMERCIAL', 'Sim'],     // perdida: fora
  ['5', 'Bia', 'Lisdaisy Vieira Costa', 'Oportunidades', 'Pipeline', 'BACKOFFICE', 'Sim'],            // backoffice: fora
  ['6', 'Bia', 'Lisdaisy Vieira Costa', 'Oportunidades', 'Pipeline', 'FRANQUIA / COMERCIAL', 'Não'],  // serviço: fora
  ['', 'Bia', 'Lisdaisy Vieira Costa', 'Oportunidades', 'Pipeline', 'FRANQUIA / COMERCIAL', 'Sim'],   // sem ID: fora
  ['7', '', '', '', 'Pipeline', 'FRANQUIA / COMERCIAL', 'Sim']                                        // sem etapa e sem nomes
];
const nomes = ['id_lead', 'consultor', 'gerente', 'etapa', 'finalizacao', 'AREA', 'PRODUTO_CONTA_META'];
const tabela = { n: linhas.length };
nomes.forEach((nome, c) => { tabela[nome] = linhas.map((l) => l[c]); });
// A API corta células vazias no fim da coluna: a última linha fica sem valor nestas duas.
tabela.etapa = tabela.etapa.slice(0, -1);
tabela.consultor = tabela.consultor.slice(0, -1);

const pipe = puro(ctx.fotoPipeline_(tabela));
assert.strictEqual(pipe.total, 4);
assert.deepStrictEqual(pipe.por_etapa, { Oportunidades: 2, 'Assinatura e pagamento': 1, '(sem etapa)': 1 });
assert.deepStrictEqual(pipe.ids_por_etapa.Oportunidades, ['1', '3']);
assert.deepStrictEqual(pipe.por_gerente['Israel Riella'], { Oportunidades: 1, 'Assinatura e pagamento': 1 });
assert.deepStrictEqual(pipe.por_consultor.Bia, { Oportunidades: 1 });
assert.deepStrictEqual(pipe.por_consultor['(sem consultor)'], { '(sem etapa)': 1 });

// --- a foto conta igual à seção pipeline do pacote de métricas
const completa = Object.assign({}, tabela);
['criado_em', 'data_perda', 'competencia_venda', 'fase', 'mql', 'prospeccao', 'oportunidades', 'documentacao', 'pagamento', 'ganho', 'data_funil_comercial', 'CONTAR_VENDA', 'CICLO_VENDA_ATE_SER_PAGO']
  .forEach((c) => { completa[c] = []; });
const secao = puro(ctx.metricasFunil_(completa, { ano: 2026, mes: 11, dia: 5 })).pipeline;
assert.strictEqual(pipe.total, secao.total);
secao.por_etapa.forEach((l) => assert.strictEqual(pipe.por_etapa[l.etapa], l.qtd, l.etapa));

// --- atividade: fica só o período pedido; quem não teve movimento sai
const par = (atual) => ({ atual, comparativo: 99, variacao_pct: 1 });
const atividade = puro(ctx.fotoIndicadores_({
  legenda: { ten: 'Tentativas', pit: 'Pitches', pf: '% êxito' },
  linhas: [
    { consultor: 'Ana', time: 'Israel Riella', gerente_atual: 'Israel Riella', ten: par(10), pit: par(2), pf: par(0.25) },
    { consultor: 'Bia', time: 'Israel Riella', ten: par(0), pit: par(0), pf: par(null) }
  ]
}, ['consultor', 'time', 'gerente_atual']));
assert.deepStrictEqual(atividade, [{ consultor: 'Ana', time: 'Israel Riella', gerente_atual: 'Israel Riella', ten: 10, pit: 2, pf: 0.25 }]);
assert.deepStrictEqual(puro(ctx.fotoIndicadores_({}, ['time'])), []);

// --- leads por canal
assert.deepStrictEqual(puro(ctx.fotoLeads_({
  linhas: [{ canal: 'SEO', leads: par(30), vendas: par(1), losts: par(4) }]
})), [{ canal: 'SEO', leads: 30, vendas: 1, losts: 4 }]);

// --- o que a foto pede existe nas Métricas de alerta
assert.strictEqual(ctx.FOTO_GRUPOS.length, 5);
assert.ok(ctx.FOTO_ATIVIDADE.indexOf('uni') >= 0 && ctx.FOTO_ATIVIDADE.indexOf('lmv') >= 0, 'as duas que faltam no dia a dia do painel');

console.log('testar-foto: ok');
