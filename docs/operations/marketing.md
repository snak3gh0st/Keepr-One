# Marketing administrativo

O módulo em `/backoffice/marketing` reúne os cadastros recebidos por `/founders`, o
acompanhamento dos contatos e o planejamento das campanhas. A implementação desta
entrega está no ambiente local; a migration foi aplicada ao banco local usado na
validação. Esta entrega não foi publicada em produção.

## Navegação e operação

A entrada **Marketing** aparece na navegação administrativa, com as abas **Leads**
e **Campanhas**.

| Superfície | Caminho | Uso |
| --- | --- | --- |
| Leads | `/backoffice/marketing` | Indicadores da base, filtros, seleção e exportação |
| Contato | `/backoffice/marketing/leads/[id]` | Dados do cadastro, atribuição, notas, acompanhamento e convite de acesso |
| Campanhas | `/backoffice/marketing/campaigns` | Listagem, busca, filtros e indicadores das campanhas |
| Nova campanha | `/backoffice/marketing/campaigns/new` | Nome, contexto, canal, status, datas e orçamento |
| Campanha | `/backoffice/marketing/campaigns/[id]` | Edição, resultados e link de captação |
| Exportação | `/backoffice/marketing/export` | Download CSV autenticado com os filtros da listagem |

A lista de leads mostra 25 contatos por página, ordenados por cadastro mais recente
e ID decrescente como critério de desempate. Os filtros permitem buscar nome,
e-mail ou telefone e selecionar etapa, campanha, responsável, período de cadastro
(todos, últimos 7, 30 ou 90 dias) e retornos. A URL mantém os filtros; o detalhe
oferece retorno à seleção anterior.

Os indicadores superiores representam a base completa, independentemente dos
filtros da tabela: total, novos, qualificados e convertidos. O alerta de retornos
pendentes abre a lista filtrada. Um retorno é pendente quando a data do próximo
contato já passou e o lead não está convertido ou perdido. O filtro **Com retorno
agendado** inclui todos os leads abertos com data de retorno, inclusive datas
passadas.

### Acompanhamento de leads

As etapas disponíveis são `NEW`, `CONTACTED`, `QUALIFIED`, `CONVERTED` e `LOST`.
A alteração de etapa pode ser individual ou em lote, com até 100 IDs por operação.
Se algum ID não existir, a operação inteira falha; não há atualização parcial.

O detalhe permite atribuir um administrador ativo, definir o próximo contato e
adicionar notas de até 4.000 caracteres. Notas guardam autor e data de criação.
Nome, e-mail, telefone e atribuição do cadastro não são editados por essas ações.
Os atalhos de WhatsApp, e-mail e telefone abrem os aplicativos ou destinos
correspondentes; o módulo não envia mensagens automaticamente.

As datas do cadastro e das notas são exibidas no horário de Nova York. O formulário
de próximo contato identifica o fuso utilizado; a persistência usa instantes com
fuso explícito. A exportação utiliza timestamps UTC.

Marcar um lead como convertido registra uma decisão da equipe. O botão **Enviar
convite de acesso** no detalhe do lead cria, quando necessário, uma conta de agente
individual com trial de 30 dias e módulos padrão, ou reutiliza a conta de agente já
existente para reenviar o convite de definição de senha. A operação é registrada
no painel de auditoria; contas de administrador/cliente não são convertidas
silenciosamente em agentes.

O painel administrativo usa `/backoffice` como endereço oficial. O namespace antigo
`/admin` permanece somente como redirecionamento de compatibilidade e não renderiza
o painel diretamente.

## Importação de leads no CRM

Agentes encontram **Importar leads** em `/agent/cases/import`. Administradores usam
**Leads CRM (CSV)** em `/backoffice/import` e escolhem o agente ativo que receberá
as oportunidades. O formato aceito é:

```text
firstName,lastName,email,phone,dateOfBirth,state,tobaccoStatus,objective,productType,targetCoverage,monthlyBudget
```

Também são aceitas as colunas `name`/`fullName` para o nome completo. Apenas o nome
é obrigatório; os padrões são `NO`, `PROTECTION` e `UNDECIDED` para tabaco, objetivo
e produto. O limite é 5 MB e 2.000 linhas. Cada linha válida cria um `Prospect` e
uma oportunidade na etapa `NEW_LEAD`. E-mail ou telefone normalizados evitam
duplicatas dentro da carteira do agente; linhas duplicadas são reportadas como
ignoradas. O resultado informa sucessos, duplicatas e erros por número de linha.

### Campanhas

Cada campanha possui nome, descrição opcional, canal, status, orçamento planejado
opcional em USD e datas opcionais. O orçamento é persistido em centavos inteiros;
não representa gasto realizado. A data final deve ser igual ou posterior à inicial.

Canais: orgânico, Meta Ads, Google Ads, e-mail, WhatsApp e outro. Status: rascunho,
ativa, pausada e concluída. Esses campos organizam o planejamento. O link de
captação continua recebendo leads em qualquer status, sem ativar anúncios,
despachos ou integrações com as plataformas dos canais.

O slug é gerado na criação e mantido nas edições, de forma que mudar o nome da
campanha não altera seu endereço de captação. A página da campanha mostra os
cadastros atribuídos e a quantidade marcada como convertida.

## Captação e atribuição

`registerFounderLeadAction` mantém o formulário público com somente nome, e-mail e
telefone US. Os metadados de campanha vêm da URL por campos ocultos, sem acrescentar
campos de preenchimento ao usuário.

A campanha padrão é um registro real criado pela migration:

- ID: `founders-program`
- Slug: `founders`
- Nome: `Programa Founders`
- Canal inicial: `ORGANIC`
- Status inicial: `ACTIVE`

Um cadastro sem `marketing_campaign`, com slug inválido ou com campanha inexistente
é atribuído a essa campanha padrão. A busca é por slug, independentemente do status
da campanha. O campo `source` é definido pelo servidor como `FOUNDERS`.

Os links gerados na tela da campanha apontam para `/founders` e incluem:

| Parâmetro | Valor gerado |
| --- | --- |
| `marketing_campaign` | Slug estável da campanha |
| `utm_source` | Canal em minúsculas, por exemplo `meta_ads` |
| `utm_medium` | `organic`, `paid_social`, `cpc`, `email`, `messaging` ou `referral` |
| `utm_campaign` | Slug estável da campanha |

Também é possível acrescentar `utm_content` e `utm_term` aos links. Exemplo de
caminho para o programa padrão:

```text
/founders?marketing_campaign=founders&utm_source=organic&utm_medium=organic&utm_campaign=founders
```

**Copiar link** utiliza o domínio do ambiente em que a administração está aberta.
Um link copiado do ambiente local aponta para o ambiente local. A atribuição é a
URL do formulário enviado; não há rastreamento por cookie entre visitas.

Metadados públicos são tratados como texto não confiável: caracteres de controle
são removidos, cada UTM é limitado a 200 caracteres e o slug a 100. O servidor não
aceita status, responsável ou outros campos administrativos do formulário público.

### Primeiro cadastro prevalece

O e-mail é normalizado em minúsculas e permanece único. A gravação utiliza
`createMany` com `skipDuplicates`, protegendo também requisições simultâneas. Um
reenvio retorna sucesso sem revelar nem sobrescrever o contato existente:

- Nome, telefone e data original permanecem iguais.
- Campanha, origem e UTMs continuam sendo os do primeiro cadastro persistido.
- Etapa, responsável, próximo contato e notas ficam preservados.

O formulário mantém o honeypot, a validação de telefone US em E.164 e o controle
de frequência por IP e combinação de IP/e-mail. O comportamento de agradecimento
e do grupo de WhatsApp está documentado em [founders-leads.md](founders-leads.md).

## Persistência e migration

Migration: `prisma/migrations/20260911010000_add_marketing_workspace/migration.sql`.

O modelo Prisma passou a se chamar `MarketingLead`, mas usa `@@map("FounderLead")`.
A tabela física **continua sendo `FounderLead`**, com os mesmos IDs, e-mails únicos,
contatos e timestamps. O índice único `FounderLead_email_key` também é preservado.
Não existe cópia de contatos para outra tabela nem exclusão da tabela original.

A migration adiciona:

1. Enums de etapas de lead, status e canais de campanha.
2. Tabela `MarketingCampaign` e o programa Founders padrão.
3. Colunas administrativas e de atribuição em `FounderLead`, com defaults de
   etapa `NEW`, origem `FOUNDERS` e campanha `founders-program`.
4. Tabela `MarketingLeadNote` e relacionamentos com contatos e autores.
5. Índices para listagem, campanha, etapa, responsável e próximo contato.

Os defaults incluem automaticamente todos os leads históricos no módulo. Também
permitem que a versão anterior da aplicação continue inserindo nome, e-mail e
telefone na tabela durante uma transição de deploy. O novo código utiliza
`prisma.marketingLead`; consultas SQL e ferramentas externas que usam a tabela
`FounderLead` continuam usando esse nome.

A relação do lead com a campanha utiliza `ON DELETE RESTRICT`. Responsáveis e
autores removidos ficam nulos (`SET NULL`); os contatos e notas permanecem. O módulo
não oferece exclusão de campanhas ou contatos.

Para uma publicação futura, aplicar a migration no ambiente de destino antes de
servir o código que consulta as novas colunas e tabelas. O Prisma Client precisa
ser gerado com o schema atualizado. A migration anterior
`20260910090000_add_founder_leads` continua fazendo parte do histórico. Não tentar
recriá-la, renomear a tabela física ou importar os mesmos leads novamente.

A comparação offline entre o schema anterior e o novo confirmou mudanças
aditivas. A aplicação local da migration não constitui publicação em produção.

## Autorização, auditoria e exportação

Páginas, funções de leitura, ações e rota de exportação exigem
`requireRole('ADMIN')`. Agentes, clientes, sessões ausentes e contas suspensas não
têm acesso. Responsáveis selecionáveis são usuários `ADMIN` não suspensos.
As ações administrativas também validam a origem da requisição.

Alterações de campanhas e leads, notas e mudanças em lote são executadas em
transações com `AuditLog`. O autor vem da sessão autenticada. A auditoria das notas
registra seu ID, sem duplicar o corpo no log. As ações de gestão não enviam
credenciais nem dados pessoais para logs de erro.

A exportação aplica os mesmos filtros da tabela e ignora a paginação. O limite é
**10.000 leads por arquivo**. Quando o resultado ultrapassa esse limite, a rota
retorna erro `422` com orientação para refinar os filtros; não há truncamento
silencioso.

O CSV possui UTF-8 com BOM, linhas CRLF, campos entre aspas e proteção contra
prefixos de fórmulas em planilhas. Inclui contato, etapa, campanha, origem,
responsável, datas e UTMs. Notas não são exportadas. O download responde com
`Cache-Control: private, no-store`; erros também não são cacheados.

## Verificação

Testes relacionados:

```sh
pnpm exec vitest run lib/marketing app/admin/marketing app/founders/lead-actions.test.ts
pnpm exec tsc --noEmit
```

Na verificação integrada local, conferir cadastro direto e por link de campanha,
persistência no módulo, preservação do primeiro cadastro ao reenviar o mesmo
e-mail, filtros, atualização individual/em lote, responsável, retorno, nota,
criação/edição de campanha e download CSV. Conferir também a recusa de acesso
sem sessão administrativa. Manter testes com contatos identificáveis de QA
restritos ao ambiente de verificação.
