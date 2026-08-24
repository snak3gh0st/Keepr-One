# Estado real da Illustration em 2026-08-18

A memória de sessões anteriores dizia "PDF da ilustração resolvido e em
produção". Isso é verdade só para a sobrevivência da sessão Auth0 do Foresight
— não para o pipeline de ilustração em si. Verificado ao vivo nesta data:

## O que está no ar hoje (`/agent/illustrations`)

É **Rapid Solve**, não Foresight. `saveRapidSolveIllustration` em
`lib/national-life/illustration-service.ts` é o único código que escreve na
tabela `Illustration`. O PDF que a tela mostra é gerado pelo nosso app a
partir do número devolvido pelo Rapid Solve — a National Life não gera
documento nesse fluxo.

**Isso importa porque o Rapid Solve carrega uma condição do carrier**: o
checkbox obrigatório do formulário diz *"This is for agent use only. This may
be used to provide a verbal quote to a consumer, but may not be shown to a
consumer."* Ver `docs/operations/national-life-portal-contract.md` linhas
578–810 para o levantamento completo (contrato JSON, bloqueios, achados de
2026-07-30/31).

Hoje não há exposição ao cliente (`app/client/policies/[id]` só lista PDFs
anexados manualmente, não lê `Illustration`), então não é uma violação ativa
— mas qualquer tela futura que ler essa tabela para o cliente violaria a
condição do carrier.

## O que existe do Foresight, e o que não existe

Existe: modelo de dados (`NationalLifeForesightCaseSnapshot`,
`ServiceSnapshot`, `Document`), rastreamento de run
(`NationalLifeForesightReadRun` / `foresight-run-service.ts`), disparo
automático em `interactive-connection-service.ts` (`startForesightInventory`,
chamado uma vez, na conclusão de uma conexão nova), UI de progresso
(`NationalLifeForesightProgress.tsx`, `ForesightCaseTabs.tsx`), e as
capacidades já nomeadas no contrato do executor
(`FORESIGHT_INVENTORY`, `FORESIGHT_CASE_DETAIL`, `FORESIGHT_REPORT` em
`connector-command-contract.ts`).

**Confirmado (atualização 2026-08-18, mais tarde no mesmo dia)**: o
KeeproneConnect **não implementa** as três capacidades Foresight. O executor
local vive em `apps/keeprone-connect` — que é parte deste monorepo, não um
projeto externo como a dúvida original supunha. Em
`apps/keeprone-connect/lib/capabilities.ts`:

```ts
const IMPLEMENTED_CAPABILITIES = ['READ_GRID', 'READ_PAGE', 'READ_EXPORT'] as const
```

Foresight não está na lista. O comentário no dispatch gate
(`parseExecutableConnectorCommand`) confirma que isso é proposital, não um
esquecimento:

> "The browser accepts only commands it can execute today, **even if the
> server's wider catalog includes Foresight and application capabilities**
> for the remote browser or a future extension release."

As únicas duas ocorrências de `FORESIGHT` no runtime são em testes
(`capabilities.test.ts`, `remote-config.test.ts`) que verificam que o
*servidor* pode declarar a capability no catálogo remoto — não que o
executor a implementa. Se o servidor mandar um comando `FORESIGHT_*` hoje, o
executor rejeita com `UNKNOWN_CAPABILITY`.

Isso explica por que as três tabelas de staging do Foresight estão com
**zero linhas** em produção e `NationalLifeForesightReadRun` também tem zero
linhas: mesmo que `startForesightInventory` dispare o run na conclusão de
uma conexão, não há executor do lado da extensão para cumpri-lo.

## Por que isso não foi resolvido nesta sessão

Construir o coletor do Foresight — coreografia de dois saltos de
autenticação, chamadas aos serviços ASMX, extração de PDF, escrita nas três
tabelas — é do tamanho do resto da integração National Life somado. Pedido
original era "ver a questão", não construir; a avaliação é a entrega desta
sessão.

## Próximo passo concreto

1. ~~Confirmar se o executor do KeeproneConnect já implementa
   `FORESIGHT_INVENTORY`/`FORESIGHT_CASE_DETAIL`/`FORESIGHT_REPORT`~~ —
   **feito 2026-08-18**: não implementa. Ver seção acima.
2. Construir o coletor do Foresight é o trabalho grande — planejar como
   projeto próprio, do mesmo tamanho da integração National Life original
   (coreografia de dois saltos de autenticação, chamadas ASMX, extração de
   PDF, escrita nas três tabelas, e os três executores novos em
   `apps/keeprone-connect/lib/capabilities.ts` adicionados a
   `IMPLEMENTED_CAPABILITIES`).
3. Decidir o destino do Rapid Solve enquanto isso: manter só como cotação
   interna do agente (nunca exposta ao cliente) é o uso que a condição do
   carrier permite.
