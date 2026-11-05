// Confere as contas de src/Metricas.gs fora do Apps Script, com uma base pequena feita à mão.
// Com as bases reais, a Brianna compara a página "Métricas da IA" com os dashboards.
// Uso: node scripts/testar-metricas.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {};
vm.createContext(ctx);
['Regras.gs', 'Metricas.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx));
const puro = (v) => JSON.parse(JSON.stringify(v));

const hoje = { ano: 2026, mes: 11, dia: 4 };

// --- datas
assert.strictEqual(ctx.somarMeses_('2026-01', -1), '2025-12');
assert.strictEqual(ctx.somarMeses_('2026-11', -13), '2025-10');
assert.strictEqual(ctx.diaDaSemana_(2026, 11, 2), 1, '02/11/2026 é segunda');
assert.strictEqual(ctx.normalizarMes_('11/2026'), '2026-11');
assert.strictEqual(ctx.normalizarMes_('2026-11-01'), '2026-11');
assert.strictEqual(ctx.normalizarMes_('01/11/2026'), '2026-11');
assert.strictEqual(ctx.numeroCelula_('1.234,5'), 1234.5);
assert.strictEqual(ctx.numeroCelula_(''), null);

// --- ocorrências: outubro/2026 tem 4 segundas e 5 quintas; em novembro/2026 só até o dia 4
assert.strictEqual(ctx.ocorrenciasDiaSemana_(2026, 10, 1, hoje), 4);
assert.strictEqual(ctx.ocorrenciasDiaSemana_(2026, 10, 4, hoje), 5);
assert.strictEqual(ctx.ocorrenciasDiaSemana_(2026, 11, 2, hoje), 1, 'uma terça até o dia 4');
assert.strictEqual(ctx.ocorrenciasDiaSemana_(2026, 11, 4, hoje), 0, 'a primeira quinta ainda não chegou');

// --- vendas
const venda = (o) => Object.assign({ id: '1', consultor: 'Ana', produtoMeta: 'Sim', data: '2026-10-05', area: 'FRANQUIA / COMERCIAL', status: 'Venda Fechada', contar: '1', gerente: 'Israel Riella', cargo: 'Franqueado', nivel: '4', statusUsr: '1', contratacao: '', desligamento: '' }, o);
const vendas = [
  venda({ id: '1' }),
  venda({ id: '2', data: '2026-10-05', consultor: 'Larah', area: 'BACKOFFICE / JURÍDICO', gerente: 'SEM GERENTE' }),
  venda({ id: '3', data: '2026-10-06', contar: '-1' }),                  // débito: fora
  venda({ id: '4', data: '2026-10-06', produtoMeta: 'Não' }),            // serviço: fora
  venda({ id: '5', data: '2026-10-12', status: 'Estorno' }),             // estorno: entra na matriz, sai do vendedor
  venda({ id: '6', data: '2026-09-30', consultor: 'Bia', gerente: 'Lisdaisy Vieira Costa' }),
  venda({ id: '7', data: '2026-11-03' }),
  venda({ id: '8', data: '2024-01-03' })                                 // fora da janela
];
const matriz = puro(ctx.metricasMatriz_(vendas, hoje));
assert.strictEqual(matriz.meses.length, 14);
assert.strictEqual(matriz.meses[0].mes, '2025-10');
const out = matriz.meses.find((m) => m.mes === '2026-10');
assert.strictEqual(out.total, 3, 'ids 1, 2 e 5');
assert.strictEqual(out.backoffice, 1);
assert.strictEqual(out.dias[4], 2);
assert.strictEqual(out.dias[11], 1);
assert.strictEqual(out.pct_backoffice, 0.3333);

const dow = puro(ctx.metricasDiaSemana_(vendas, hoje));
const outDow = dow.meses.find((m) => m.mes === '2026-10');
assert.strictEqual(outDow.vendas[0], 3, 'as 3 vendas de outubro caíram em segundas');
assert.strictEqual(outDow.medias[0], 0.8, '3 ÷ 4 segundas');
assert.strictEqual(outDow.media_2a_6a, 0.8, 'dia sem venda não entra na média');
assert.strictEqual(dow.dias_semana.length, 7);

// --- vendedores e metas
const vend = puro(ctx.metricasVendedores_(vendas, [
  { mes: '2026-10', pessoa: 'ana', meta: 2 }, { mes: '2026-11', pessoa: 'Ana', meta: 0, fora: true }, { mes: '2026-10', pessoa: 'Cris Sem Venda', meta: 5 }, { mes: '2026-11', pessoa: 'Bia', meta: 0, fora: false }
], hoje));
const ana = vend.linhas.find((l) => l.nome.toLowerCase() === 'ana');
assert.strictEqual(ana.vendas_passado, 1, 'estorno e débito fora');
assert.strictEqual(ana.meta_passado, 2);
assert.strictEqual(ana.pct_meta_passado, 0.5);
assert.strictEqual(ana.vendas_atual, 1);
assert.strictEqual(ana.fora_da_catraca, true, 'coluna S');
assert.strictEqual(vend.linhas.find((l) => l.nome === 'Bia').fora_da_catraca, false, 'meta 0 com coluna N continua dentro');
assert.strictEqual(vend.linhas.find((l) => l.nome === 'Bia').meta_atual, 0);
assert.strictEqual(vend.linhas.find((l) => l.nome === 'Cris Sem Venda').fora_da_catraca, null, 'sem linha no mes atual: nao informado');
assert.strictEqual(ctx.foraDaCatraca_('S'), true);
assert.strictEqual(ctx.foraDaCatraca_(' n '), false);
assert.strictEqual(ctx.foraDaCatraca_(''), null);
const cris = vend.linhas.find((l) => l.nome === 'Cris Sem Venda');
assert.strictEqual(cris.vendas_passado, 0, 'quem tem meta e não vendeu aparece');
assert.strictEqual(vend.linhas.find((l) => l.nome === 'Bia').vendas_retrasado, 1);

// --- quem entra na lista de vendedores e de que time
const cad = (consultor, area, statusUsr, gerente) => ({ consultor, area, statusUsr, gerente, cargo: 'Franqueado', nivel: '4', contratacao: '2020-01-01', desligamento: '' });
const vendasTime = vendas.concat([
  venda({ id: '20', consultor: 'Dora Antiga', data: '2024-05-10', gerente: 'Israel Riella' }),              // vendeu ha muito tempo
  venda({ id: '21', consultor: 'Eva Atual', data: '2026-10-10', gerente: 'Israel Riella' }),                // a TIMES ATUAIS diz outro gerente
  venda({ id: '24', consultor: 'Fora Do Cadastro', data: '2024-05-10', gerente: 'Lisdaisy Vieira Costa' }),  // sem TIMES ATUAIS: vale a venda, mas so entra se tiver meta ou venda recente
  venda({ id: '22', consultor: 'Saiu Agora', data: '2026-10-11', statusUsr: '0', gerente: 'Israel Riella' }),
  venda({ id: '23', consultor: 'Backoffice ME', data: '2026-10-11', area: 'BACKOFFICE', gerente: 'SEM GERENTE' })
]);
const vt = puro(ctx.metricasVendedores_(vendasTime, [{ mes: '2026-11', pessoa: 'Fernanda Meta', meta: 5, fora: false }, { mes: '2026-11', pessoa: 'Stella Grafia Errada', meta: 30, fora: false }, { mes: '2026-11', pessoa: 'Fora Do Cadastro', meta: 3, fora: false }], hoje, [
  cad('Eva Atual', 'FRANQUIA / COMERCIAL', '1', 'Stella Nieheus'),
  cad('Dora Antiga', 'FRANQUIA / COMERCIAL', '1', 'Stella Nieheus'),
  cad('Nova Sem Venda', 'CANAL AGENTES', '1', 'Lisdaisy Vieira Costa'),
  cad('Nova Sem Venda', 'CANAL AGENTES', '1', 'SEM GERENTE'),
  cad('Repetida', 'CANAL AGENTES', '1', 'SEM GERENTE'),
  cad('Repetida', 'CANAL AGENTES', '1', 'Israel Riella'),
  cad('Inativa', 'CANAL AGENTES', '0', 'Israel Riella'),
  cad('Fernanda Meta', 'BACKOFFICE / JURÍDICO', '1', 'Backoffice Jurídico'),
  cad('Larah Back', 'BACKOFFICE / JURÍDICO', '1', 'Israel Riella'),
  cad('Sem Gerente', 'CANAL AGENTES', '1', 'SEM GERENTE'),
  cad('Teste Dev', 'CANAL AGENTES', '1', 'Israel Riella'),
  cad('Israel Coordenador', 'COMERCIAL', '1', 'Israel Riella'),
  cad('Lisdaisy Franquia', 'COMERCIAL', '1', 'Israel Riella')
]));
const ach = (n) => vt.linhas.find((l) => l.nome === n);
assert.strictEqual(ach('Eva Atual').gerente_atual, 'Stella Nieheus', 'a TIMES ATUAIS vale mais que a venda');
assert.strictEqual(ach('Dora Antiga').gerente_atual, 'Stella Nieheus', 'venda antiga nao muda o time');
assert.strictEqual(ach('Fora Do Cadastro').gerente_atual, 'Lisdaisy Vieira Costa', 'sem TIMES ATUAIS, vale a venda mais recente');
assert.strictEqual(ach('Nova Sem Venda').gerente_atual, 'Lisdaisy Vieira Costa', 'sem venda, vale a TIMES ATUAIS');
assert.strictEqual(ach('Repetida').gerente_atual, 'Israel Riella', 'pessoa repetida: a linha que passa nos filtros');
assert.ok(ach('Saiu Agora'), 'quem vendeu nos 3 meses aparece mesmo inativo');
assert.ok(ach('Fernanda Meta'), 'quem tem meta sempre aparece');
['Inativa', 'Larah Back', 'Sem Gerente', 'Teste Dev', 'Israel Coordenador', 'Lisdaisy Franquia', 'Backoffice ME', 'Larah'].forEach((n) => assert.ok(!ach(n), n + ' fica de fora'));
assert.deepStrictEqual(vt.metas_sem_cadastro, ['Stella Grafia Errada'], 'avisa o nome que nao aparece em lugar nenhum');
assert.strictEqual(vt.linhas[vt.linhas.length - 1].gerente_atual, '', 'sem gerente vai para o fim');

// --- funil
const colunasFunil = ['id_lead', 'consultor', 'gerente', 'criado_em', 'data_perda', 'competencia_venda', 'etapa', 'fase', 'finalizacao', 'mql', 'prospeccao',
  'oportunidades', 'documentacao', 'pagamento', 'ganho', 'data_funil_comercial', 'CONTAR_VENDA', 'AREA', 'PRODUTO_CONTA_META', 'CICLO_VENDA_ATE_SER_PAGO'];
const linhaFunil = (o) => Object.assign({ consultor: 'Ana', gerente: 'Israel Riella', criado_em: '2026-10-01', data_perda: '', competencia_venda: '', etapa: '1-MQL - VALIDAÇÃO', fase: 'Novo', finalizacao: 'Perda',
  mql: '', prospeccao: '', oportunidades: '', documentacao: '', pagamento: '', ganho: '', data_funil_comercial: '2026-10-10', CONTAR_VENDA: '0', AREA: 'FRANQUIA / COMERCIAL', PRODUTO_CONTA_META: 'Sim', CICLO_VENDA_ATE_SER_PAGO: '' }, o);
const linhas = [
  linhaFunil({ id_lead: 1, mql: 1, fase: 'Sem Contato', criado_em: '2026-10-01', data_perda: '2026-10-11' }),
  linhaFunil({ id_lead: 1, mql: 1, fase: 'Sem Contato', criado_em: '2026-10-01', data_perda: '2026-10-21' }),   // mesma lead: mql conta uma vez, lost são registros
  linhaFunil({ id_lead: 2, mql: 2, prospeccao: 2, pagamento: 2, ganho: 2, CONTAR_VENDA: 1, finalizacao: 'Ganho', competencia_venda: '2026-10-01', CICLO_VENDA_ATE_SER_PAGO: 4 }),
  linhaFunil({ id_lead: 3, mql: 3, ganho: 3, CONTAR_VENDA: 0, finalizacao: 'Ganho', CICLO_VENDA_ATE_SER_PAGO: 2 }),   // ganho não conta sem CONTAR_VENDA=1, mas entra na média do ciclo
  linhaFunil({ id_lead: 4, mql: 4, finalizacao: 'Interesse em Parceria' }),                  // fora
  linhaFunil({ id_lead: 5, mql: 5, AREA: 'BACKOFFICE / SUPORTE' }),                          // fora
  linhaFunil({ id_lead: 6, mql: 6, PRODUTO_CONTA_META: 'Não' }),                             // fora
  linhaFunil({ id_lead: 7, mql: 7, PRODUTO_CONTA_META: 'Produto ainda não definido', finalizacao: 'Pipeline', etapa: '2-PROSPECÇÃO', data_funil_comercial: '2026-11-04' }),
  linhaFunil({ id_lead: 8, pagamento: 8, competencia_venda: '2016-05-01', finalizacao: 'Ganho', CICLO_VENDA_ATE_SER_PAGO: 9 })   // competência antiga fora da distribuição
];
const t = { n: linhas.length };
colunasFunil.forEach((c) => { t[c] = linhas.map((l) => l[c]); });
const f = puro(ctx.metricasFunil_(t, hoje));
const fOut = f.funil.meses.find((m) => m.mes === '2026-10');
assert.strictEqual(fOut.mql, 3, 'leads 1, 2 e 3');
assert.strictEqual(fOut.prospeccao, 1);
assert.strictEqual(fOut.ganho, 1, 'só CONTAR_VENDA = 1');
assert.strictEqual(fOut.losts, 2, 'registros');
assert.strictEqual(fOut.tx_mql_ganho, 0.3333);
const cOut = f.ciclo_e_lost.meses.find((m) => m.mes === '2026-10');
assert.strictEqual(cOut.media_dias_ate_100_pago, 3, 'média de 4 e 2');
assert.strictEqual(cOut.media_dias_ate_lost, 15, 'média de 10 e 20');
assert.strictEqual(cOut.ciclo_de_venda.length, 1, 'competência de 2016 fica de fora');
assert.strictEqual(cOut.ciclo_de_venda[0].dias, '4');
assert.strictEqual(cOut.motivos_de_lost[0].motivo, 'Sem Contato');
assert.strictEqual(cOut.motivos_de_lost[0].qtd, 2);
assert.strictEqual(f.pipeline.total, 1);
assert.strictEqual(f.pipeline.por_etapa[0].etapa, '2-PROSPECÇÃO');
assert.strictEqual(f.funil.por_consultor_mes_passado.linhas[0].mql, 3);

// --- jurídico
const colsJur = ['ID_PROCESSO', 'PRODUTO_CONTA_META', 'DATA_PENDENTE_JURIDICO', 'DATA_INICIO_REGISTRO', 'DATA_PROTOCOLADO_ANOTACOES', 'QTD_DOCUMENTOS_INCOMPLETOS',
  'QUEM_ENVIOU_PENDENTE_JURIDICO', 'Gerente', 'TEMPO_UTIL_SEGUNDOS_INICIO_ATE_PROTOCOLADO', 'TEMPO_PENDENTE_JURIDICO_ATE_INICIO_REGISTRO'];
const jur = [
  [1, 'Sim', '2026-10-01 10:00:00', '2026-10-02 10:00:00', '2026-10-03 10:00:00', 2, 'Ana', 'Israel Riella', 7200, 3600],
  [2, 'Sim', '2026-10-05 10:00:00', '2026-10-06 10:00:00', '', 0, 'Ana', 'Israel Riella', '', 10800],
  [3, 'Não', '2026-10-05 10:00:00', '', '', 9, 'Bia', 'X', '', '']   // serviço: fora
];
const tj = { n: jur.length };
colsJur.forEach((c, i) => { tj[c] = jur.map((l) => l[i]); });
const j = puro(ctx.metricasJuridico_(tj, hoje));
const jOut = j.meses.find((m) => m.mes === '2026-10');
assert.strictEqual(jOut.passaram_pendente_juridico, 2);
assert.strictEqual(jOut.iniciar_registro, 2);
assert.strictEqual(jOut.protocolados, 1);
assert.strictEqual(jOut.documentos_incompletos, 2);
assert.strictEqual(jOut.tx_docs_por_processo, 1);
assert.strictEqual(jOut.pct_processos_com_docs_incompletos, 0.5);
assert.strictEqual(jOut.horas_uteis_pendente_ate_iniciar, 2, 'média de 1 h e 3 h');
assert.strictEqual(jOut.horas_uteis_iniciar_ate_protocolo, 2);
assert.strictEqual(j.processos_sem_protocolo_hoje, 1);
assert.strictEqual(j.por_vendedor_mes_passado.linhas[0].nome, 'Ana');
assert.strictEqual(j.iniciados_por_dia_mes_passado.length, 2);

// --- leads: semanas de segunda a domingo; 01/10/2026 é quinta
const leads = puro(ctx.metricasLeads_([
  { canal: 'Google Ads', linhas: [
    { dia: '2026-10-01', leads: { atual: 10 }, vendas: { atual: 1 }, losts: { atual: 2 } },
    { dia: '2026-10-04', leads: { atual: 5 }, vendas: { atual: 0 }, losts: { atual: 0 } },
    { dia: '2026-10-05', leads: { atual: 7 }, vendas: { atual: 0 }, losts: { atual: 0 } }
  ] },
  { canal: 'Indicação', linhas: [{ dia: '2026-10-01', leads: { atual: 3 }, vendas: { atual: 0 }, losts: { atual: 0 } }] }
]));
assert.strictEqual(leads.meses[0].total_leads, 25);
assert.strictEqual(leads.meses[0].leads_marketing, 22);
assert.strictEqual(leads.meses[0].leads_por_canal[5], 3);
assert.strictEqual(leads.meses[0].semanas.length, 2);
assert.deepStrictEqual([leads.meses[0].semanas[0].de, leads.meses[0].semanas[0].ate, leads.meses[0].semanas[0].total], ['01', '04', 18]);
assert.deepStrictEqual([leads.meses[0].semanas[1].de, leads.meses[0].semanas[1].ate, leads.meses[0].semanas[1].total], ['05', '11', 7]);
assert.strictEqual(leads.meses[0].dias['01'][0], 10);

// --- indicadores: quem não teve movimento sai
const ind = puro(ctx.compactarIndicadores_({ legenda: { ten: 'Tentativas', ve: 'Vendas' }, linhas: [
  { consultor: 'Ana', ten: { atual: 5, comparativo: 3 }, ve: { atual: 1, comparativo: 0 } },
  { consultor: 'Parada', ten: { atual: 0, comparativo: 0 }, ve: { atual: 0, comparativo: 0 } }
] }, ['consultor']));
assert.strictEqual(ind.linhas.length, 1);
assert.deepStrictEqual(ind.linhas[0].atual, [5, 1]);

// --- dash: o seletor usa as vendas sem backoffice; o realizado não muda
const semBack = puro(ctx.vendasPorDia_(vendas, 2026, 10, true));
const comBack = puro(ctx.vendasPorDia_(vendas, 2026, 10));
assert.strictEqual(comBack['5'], 2, 'com backoffice');
assert.strictEqual(semBack['5'], 1, 'sem backoffice');

// --- texto do percentual vs ano passado
assert.strictEqual(ctx.yoyDelta_('-13,2%'), '▼ queda YoY projetada');
assert.strictEqual(ctx.yoyDelta_('+1,8%'), '▲ crescimento YoY projetado');
assert.strictEqual(ctx.yoyDelta_('0%'), '= estável vs ano passado');
assert.strictEqual(ctx.yoyDelta_(''), '');

console.log('Métricas: todas as contas conferem.');
