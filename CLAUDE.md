# Forecast de vendas — Consolide (Apps Script)

Dashboard em Google Apps Script (app da Web), na branch `apps-script` do repositório `bri-304/dash-previsao`. A `main` continua sendo o dash antigo do GitHub Pages, atualizado pelo Pentaho a cada 30 min: não altere nada nela. A Brianna pede mudanças em português; você edita `src/`, publica no projeto de teste, ela confere, e só com a aprovação vai para a produção (skill `publicar-dash`).

## IDs

| | Projeto | Arquivo clasp | Script ID |
|---|---|---|---|
| Produção | Dash Forecast Consolide | `.clasp.json` (padrão) | `1WwA_S6a1da2tZz4MgOB1yKmV5IueLYkMvfPJuc9tPSmrLbqhv0MNw3Mt` |
| Teste | Dash Forecast Consolide - TESTE | `.clasp-teste.json` | `1nxbIWLV719M78d3Ej6JLM5eLIyxB4axSfFrkV1BHApEJMi99mFgF9RDN` |

- Deployment ID teste (`/exec`, descrição "TESTE Forecast"): `AKfycbz08KM66CbFQeE6_PfIHsjRMlI_A6PCFNHosW0-USmJa0HpSHmr04RSTDtNKPGL65QoNg`
- Deployment ID teste (`/dev`, @HEAD): `AKfycbwWiXDKy03fw_pNTh_pyp_1ynNxu1MAltkUdhC1VmD9`
- Deployment ID oficial: ainda não criado (passo final da migração, depois da aprovação no teste). Criado, anote aqui e em `CONFIG.URL_OFICIAL`.
- Planilha da IA e do acesso: "Dados IA - Previsão", `1xO6594dHGlajnzqdNTMrxbtU9_SYXzpDXewtwuTBAV4` (`CONFIG.ID_PLANILHA`).
- Planilha de vendas: "Dados Vendas Ligações e Funil", `1dPYm8QGUsounTdhPIRunlz5rpSoUrBUYaE7dBp9Tp5s` (`CONFIG.ID_PLANILHA_VENDAS`).
- Conta dona dos projetos e do clasp: `brianna.hahn@consolidesuamarca.com.br`.

Todo comando para o teste leva `-P .clasp-teste.json`; sem ele, o clasp usa a **produção**. `clasp push` substitui o projeto online inteiro pelo conteúdo de `src/`.

## Arquivos

- `src/Code.gs`: `doGet`, acesso, login, log, `getContexto`, `getForecastData`, leitura da planilha, cache.
- `src/Regras.gs`: regras de negócio em funções puras (sem API do Google) e a comparação campo a campo.
- `src/Historico.gs`: pasta do Drive, `salvarSnapshot`, gatilho, importação e `validarContraJson`.
- `src/index.html` (template), `src/css.html`, `src/js.html` (entram por `include`).
- `src/appsscript.json`: fuso `America/Sao_Paulo` (define o "hoje"), `executeAs = USER_DEPLOYING`, `access = ANYONE_ANONYMOUS` (o login próprio é o portão). Mudou escopo: só a dona reautoriza, no editor de cada projeto.
- `src/Metricas.gs`, `src/MetricasServidor.gs`, `src/metricas.html`: métricas para a IA (seção "Métricas da IA").
- `scripts/testar-metricas.js`: confere as contas de `Metricas.gs` no node, com uma base pequena feita à mão.
- `scripts/testar-regras.js`: roda `Regras.gs` no node com a aba bruta real e compara com um JSON.
- `scripts/montar-previa.js` + `scripts/servir-previa.js`: prévia local da página com `google.script.run` simulado.
- `forecast_data.json` e `historico/` ficaram na branch só como referência: o dash lê a planilha e a pasta do Drive.

## O que saiu do ETL do Pentaho

Antes: planilha → Pentaho monta o JSON → PUT no GitHub → página faz `fetch`. O job "tr-workflow-update..." juntava abas e fazia GET/PUT do `forecast_data.json`.

Agora o servidor lê a planilha na hora e sobram só as transformações. Saíram junções de linhas, denormalização, escape de texto, base64, SHA e PUT. O objeto não é mais montado em cima do JSON anterior, então não herda valores de execuções passadas.

**O Pentaho continua alimentando** a aba `Dados Leads 100% Pagas` de "Dados Vendas Ligações e Funil", de onde o dash lê as vendas. A IA continua preenchendo as abas de previsão.

Da planilha "Dados IA - Previsão", o dash só usa: `Campos_previsao_IA`, `semana`, `semana-tags`, `sugestoes-estratégias`, `campos-gargalos`, `Vendas Previstas por dia Mês Atual`, as linhas `_prev_atual`, `_destaque_txt` e `_atencao_txt` de `Configuracoes times`, `Metas por pessoa`, `Emails Autorizados` e `Logs de Acesso`. As demais abas não entram no código, mas podem alimentar o Pages: não apague antes de desligá-lo.

## Schema v8 e mapa de campos

```
{ meta:{...}, times:{ chave:{...} }, semanas:[...], dias:[[...]], sugestoes:[...], gargalos:[...] }
```

### meta

| Campo | Origem |
|---|---|
| `atualizado_em` | Horário da leitura |
| `status_dias`, `kpi_realizado_sub`, `page_title`, `hdr_title_html`, `kpi_total_sub`, `kpi_yoy_lbl`, `sec_title_*`, `chart_title_main` | Calculados da data (`Regras.gs`) |
| `kpi_realizado` | Soma de `vendasPorDia_` |
| `kpi_realizado_delta` | realizado ÷ `kpi_total_central` |
| `kpi_ativos` | Pessoas distintas nas listas dos times (quem vendeu no mês atual ou no anterior) |
| `kpi_ativos_sub` | "em N times competindo", N = times do objeto |
| `realizado_sem_backoffice` | `vendasPorDia_` sem `AREA` com Backoffice, `{ dia: vendas }`, para o seletor |
| `kpi_inativos_delta` | Desmarcados em `D17:D60` da Jornada de Estrelas (`CONFIG.ID_PLANILHA_JORNADA`); sem acesso, fica vazio e some da tela |
| `kpi_yoy_delta` | Sinal de `kpi_yoy_pct` (`yoyDelta_`): queda em vermelho, crescimento em verde |
| `badge_*`, `kpi_total_central/pess/otim/delta`, `kpi_media_*`, `kpi_yoy_pct/pess/otim/sub`, `footer_linha1-3` | IA, aba `Campos_previsao_IA` |

### times.`<chave>`

| Campo | Origem |
|---|---|
| `nome` | Grafia mais frequente do gerente (campo novo, usado no card) |
| `ativos` | Linhas de `sellers` |
| `sellers` | `[nome, vendas mês passado, vendas mês atual]`: primeiro quem vendeu no mês atual, depois quem só vendeu no anterior |
| `mes_passado_total`, `mes_atual_total`, `dias_confirmados_val` | Somas de `sellers` |
| `mes_passado` | Vendas do mês anterior do dia 1 até o mesmo dia de hoje |
| `dias_confirmados_lbl`, `lbl_*`, `leg_*` | Calculados da data |
| `prev_atual`, `destaque_txt`, `atencao_txt` | IA, aba `Configuracoes times`, chaves `<chave>_prev_atual` etc. |

### semanas, sugestoes, gargalos

Abas da IA: `semana` + `semana-tags` (pela coluna `semana`), `sugestoes-estratégias` (`n` com 2 dígitos, tags separadas por `;`) e `campos-gargalos`.

### dias

`[dia, dia da semana, central, mín, máx, tipo, evento, realizado]`, da aba `Vendas Previstas por dia Mês Atual`. Dia com venda: `tipo` = `real` (já passou) ou `partial` (hoje) e `realizado` = vendas. Dia sem venda: tipo da previsão e `realizado` = null.

## Regras (aba `Dados Leads 100% Pagas`, planilha de vendas)

Colunas usadas, lidas pelo nome do cabeçalho: `ID_LEAD`, `CONSULTOR`, `PRODUTO_CONTA_META`, `DATA_PAGAMENTO`, `AREA`, `STATUS_LEAD`, `CONTAR_VENDA`, `NOME_GERENTE_ATUAL`.

Toda contagem é de `ID_LEAD` diferentes, pela `DATA_PAGAMENTO`, com `STATUS_LEAD` diferente de Estorno, `PRODUTO_CONTA_META` = Sim e `CONTAR_VENDA` = 1. Além disso:

- **Vendas por dia**: `CONSULTOR` diferente de BACKOFFICE ME. Inclui gerente "SEM GERENTE".
- **Times**: `AREA` preenchida e gerente que forma time.

Os filtros de lista congelados das tabelas dinâmicas foram tirados de propósito: cortavam valor novo sem avisar (foi o caso de "Stella Niehues").

### Formação dos times (nunca fixa no código)

- Time = todo `NOME_GERENTE_ATUAL` com venda no mês atual ou no anterior, menos "SEM GERENTE" (`REGRAS.GERENTES_SEM_TIME`).
- Gerentes com o mesmo primeiro nome ficam no mesmo time: é o que une Stella Niehues e Stella Nieheus, e Israel Riella e Israel Cristiano Riella. Dois gerentes diferentes com o mesmo primeiro nome também seriam unidos: se isso acontecer, a regra precisa mudar.
- Chave: a de `Configuracoes times` cujas letras aparecem em ordem no primeiro nome, com a mesma inicial (`stl` em Stella). Gerente sem chave lá ganha as 3 primeiras letras, e a página mostra o card sem os textos da IA até ela escrever.
- A cor do card é só apresentação: `isr`, `lis` e `stl` mantêm a de sempre (`CORES_TIME` em `js.html`), e time novo pega a próxima livre.

### Correções em relação à planilha (combinadas com a Brianna)

| Campo | Planilha | Agora |
|---|---|---|
| `kpi_ativos` | Checkboxes da Jornada de Estrelas | Pessoas que venderam (pedido dela) |
| `times.*.ativos` | `COUNTIF` com curinga: somava nomes com as letras da chave | Linhas de `sellers` |
| `kpi_realizado_delta` | Dividia por 390 fixo | Divide pelo central da previsão |
| Filtro do mês em dezembro | `ANO(DATAM(HOJE();1))` virava o ano seguinte e zerava tudo | Mês calculado sem esse erro |
| `mes_passado` no fim do mês | "31 do mês anterior" passava para o mês seguinte | Limitado ao último dia do mês anterior |
| `status_dias` nos 2 últimos dias | "Dias 32 à 31" | Sem o intervalo impossível |
| `kpi_realizado_sub` no dia 1 | "dias 1 à 31" | "dia 1" |
| `times.stl` | Filtro do mês passado com o nome errado | As duas grafias contam |

Diferença ou regra nova: atualize `motivoConhecido_` em `Regras.gs` e esta tabela. Fora dessa lista, diferença indica regra errada.

## Validação

- No editor: `validarContraJson()` monta o objeto com a data do `forecast_data.json` da `main` e compara campo a campo. Registra as diferenças conhecidas com o motivo e as `INESPERADAS`.
- Local: `node scripts/testar-regras.js <dump da aba bruta> <json>`. As abas da IA saem do próprio JSON, então testa regras de vendas, times e textos, não a leitura das abas.

## Histórico

- Pasta no Drive da dona (`Forecast - Histórico`; no teste, `Forecast - Histórico (teste)`), um `AAAA-MM.json` por mês, no schema v8. ID em `PASTA_HISTORICO_ID` nas propriedades do script. A pasta não precisa ser compartilhada: o dash roda na conta da dona.
- `importarHistoricoDoGithub()`: uso único, no editor. Traz junho a setembro de `historico/` e outubro da última versão do `forecast_data.json` de 31/10 (o mês não tinha sido salvo). Não sobrescreve. Depois de rodar em produção, pode sair do código.
- `gatilhoSnapshotDiario`: todo dia às 23h, só grava no último dia do mês. Instale uma vez com `instalarGatilhoSnapshot()`, no editor da produção.
- `salvarSnapshot(mesRef, token)`: pelo botão "Salvar snapshot" da página (só a dona) ou pelo editor. Aceita o mês corrente ou um mês passado. **Recusa se a aba de previsão não for do mês pedido**, para não misturar dois meses.
- Mês anterior na comparação com o mês atual sai da aba bruta. O snapshot guarda o que a IA sobrescreve (previsão, semanas, sugestões).
- Projeto avulso não consegue criar menu em planilha, por isso o snapshot manual é botão no dash, como a Brianna escolheu.

## Métricas da IA (plugin do forecast)

Tiram os prints de dashboards que a Brianna mandava ao GPT. Uma conta só: `gerarMetricas` lê as bases e salva um pacote no Drive (`Métricas da IA/metricas-AAAA-MM-DD.json`, dentro da pasta do histórico; um por dia gerado); a página e o plugin leem esse arquivo. O que ela confere é o que a IA recebe, e a chamada do plugin não estoura os 55 s.

- `src/Metricas.gs`: contas puras (`node scripts/testar-metricas.js`). `src/MetricasServidor.gs`: leitura, pacote, página e plugin. `src/metricas.html`: a página.
- **Atualizar**: botão "Atualizar métricas" na página (`📐 Métricas da IA` no dash, só a dona) ou `gerarMetricasAgora()` no editor. Não há gatilho: ela atualiza, confere e roda o GPT. Passou de 3 min, salva e a página chama de novo com os grupos que faltam (`pendentes`).
- **Plugin** (`consulta-ia/pedido-sites-forecast.md`, servidor MCP "Consolide Forecast"): `/exec?consulta=indice|secao&secao=...&data=...&chave=<FORECAST_CHAVE>`, só leitura, sem login. Chave: `gerarChaveForecast()` / `revogarChaveForecast()` no editor. Separado do "Consolide Consultas" de propósito: aquele é usado por mais pessoas. Prompt da previsão: `prompts/prompt_previsao_vendas_v2.txt`.
- **Propriedades do script**: `FORECAST_CHAVE`; `CONSULTA_CHAVE` = o mesmo valor da propriedade de mesmo nome no dash de leads. Sem esta, leads e indicadores saem como aviso e o resto do pacote é gerado.

| Seção | Base | Regra |
|---|---|---|
| `vendas_matriz` | `Dados Leads 100% Pagas` da planilha de vendas | Soma de `CONTAR_VENDA` por mês e dia da `DATA_PAGAMENTO`, `PRODUTO_CONTA_META` = Sim, `CONTAR_VENDA` = 1. **Backoffice sempre entra** e vem também em separado. Estornos não saem |
| `vendas_dia_semana` | Idem | `ID_LEAD` diferentes ÷ vezes que o dia da semana aconteceu no mês (no mês atual, até hoje). Dia sem venda não entra na média de 2ª a 6ª |
| `vendedores` | Idem + aba `Metas por pessoa` (planilha de previsão: `MES`, `PESSOA`, `META`, `FORA DA CATRACA`) | Regra de `vendaConta_`, por `CONSULTOR`. Entra quem tem meta, quem vendeu nos 3 meses ou quem está ativo (`STATUS_USR` = 1) em `Dados Leads 100% Pagas - TIMES ATUAIS`; sem `AREA` Backoffice, "SEM GERENTE" ou nome com teste, coordenador ou franquia. Quem tem meta entra sempre. Gerente, cargo e área vêm da TIMES ATUAIS dessa mesma planilha; quem não está lá, da venda mais recente. A cópia dessa aba na planilha de previsão está desatualizada: não use. Fora da catraca = coluna da aba, S ou N, no mês atual: há pessoas com meta 0 dentro da catraca |
| `funil`, `ciclo_e_lost`, `pipeline` | `dados_funil` | Pela `data_funil_comercial`: `AREA` sem Backoffice, produto Sim ou não definido, finalização diferente de Interesse em Parceria. Ganho só com `CONTAR_VENDA` = 1. Losts: finalização contém Perda; dias = `data_perda` − `criado_em`; motivos = registros por `fase` |
| `juridico` | `dados_jurídico_resumido` | Produto Sim ou não definido; cada indicador pela própria data. Docs = soma de `QTD_DOCUMENTOS_INCOMPLETOS` de quem passou em pendente jurídico no mês |
| `leads_distribuicao`, `indicadores_*` | Endereço do dash de leads (`consulta=metrica`) | Mesmo código do painel, sem copiar regra. O plugin Consolide Consultas não muda |

Não há conferência automática, por pedido da Brianna: ela compara a página com os dashboards. Compare sempre com as tabelas de hoje, não com prints antigos: vendas que fecham no começo do mês seguinte mudam os meses recentes (setembro/2026 era 271 em 01/10 e 300 em 04/11).

**Seletor de backoffice no dash** (`realizado_sem_backoffice` em `meta`, `comSeletorBackoffice` em `js.html`): com "Incluir vendas do backoffice" desmarcado, o realizado do KPI, do gráfico e da tabela diária tira quem tem `AREA` com Backoffice. Os cards de time não mudam. Padrão: marcado; a escolha fica no navegador. Meses salvos antes de o campo existir não mostram o seletor.

## Acesso e login

- Roda como a dona. Ninguém precisa da planilha nem da pasta compartilhadas.
- Quem vê = aba `Emails Autorizados` (coluna A, e-mail completo), relida a cada leitura. A dona entra sempre. **No projeto de teste, só a dona** (`ehProjetoTeste_`).
- Login igual ao dash de leads: sessão no `localStorage` (`forecastToken`), nunca na URL; bilhete `?tk=` só entrega a página sem números. Sessão sem prazo; `encerrarTodasAsSessoes()` no editor derruba todas.
- Propriedades do script em cada projeto: `OAUTH_CLIENT_ID` e `OAUTH_CLIENT_SECRET`.
- **Endereços sempre com `/a/~/`**: `https://script.google.com/a/~/macros/s/<ID>/exec` (pedido da Brianna). Sem isso, com conta Google logada, Samsung e Safari podem cair em `/macros/u/1/...` e dar erro do Drive antes do `doGet`. `urlBase_()` já devolve esse formato, e ele também é o `redirect_uri`: cada `/exec` e `/dev` usado precisa estar assim nos URIs de redirecionamento autorizados da credencial, senão o login dá erro 400. O link divulgado e `CONFIG.URL_OFICIAL` seguem o mesmo formato.
- Log em `Logs de Acesso` (Data e hora, E-mail, Evento, Ambiente), 90 dias.
- Função nova sem `_` no fim pode ser chamada por qualquer um via `google.script.run`: as de dados começam com `conferirSessao_`; as de manutenção, com `soNoEditor_`.

## Página

- `getForecastData(mesRef, token)`: vazio ou mês corrente = planilha; outro mês = snapshot. Devolve texto JSON. Cache de 5 min compartilhado (`PREFIXO_CACHE`: mudou o formato, troque).
- A página relê a cada 5 min, só no mês atual e com a aba à mostra. Falha de rede na releitura não apaga os números.
- Estados: `#estado-carregando` na primeira carga (nenhum número de exemplo aparece), `#estado-erro` com "Tentar de novo" ou "Entrar", `#aviso` para falhas ao trocar de mês e para o snapshot.
- Cards de time gerados por `renderTeams` a partir de `data.times`. Meses antigos podem trazer `obs_txt` no lugar de destaque e atenção.
- Chart.js 4.4.1 e fontes vêm de CDN (cdnjs e Google Fonts).
