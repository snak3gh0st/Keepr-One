# WhatsApp por agente: isolamento e migração oficial

## Contrato permanente

- Cada agente Keepr One possui uma conta Chatwoot própria.
- Cada conta pode possuir canais de tipos diferentes, mas somente uma identidade
  de cada tipo: um WhatsApp, um e-mail e assim por diante.
- O mesmo número, identificador externo ou caixa não pode pertencer a dois agentes.
- O Keepr One é a única interface diária do agente. O Chatwoot permanece como
  registro e motor invisível; a Meta Cloud API é o transporte oficial. Evolution
  é somente a ponte temporária de migração.
- Grupos, histórico anterior e sessões sem telefone confirmado não entram no
  Chatwoot.

O banco reforça esse contrato em `AgentMessagingAccount` e
`AgentMessagingChannel`. As restrições são globais, não dependem de filtros de
interface ou da disciplina de um operador.

## Caixa omnichannel nativa

O portal consulta as APIs Chatwoot somente pelo backend do Keepr, usando o token
restrito à conta isolada do agente. O navegador recebe apenas inboxes, contatos,
conversas, mensagens, anexos e estados de entrega normalizados. Campos de equipe,
atribuição e administração nunca fazem parte do contrato da UI.

WhatsApp e e-mail aparecem na mesma lista, identificados por canal. Leitura,
busca, histórico e resposta acontecem dentro do Keepr One. O iframe do produto
Chatwoot não é usado na operação diária; ele pode aparecer dentro do painel de
conexão somente durante a configuração inicial de um provedor.

## Estado temporário: Evolution

Configure o Keepr One com:

```dotenv
WHATSAPP_CHANNEL_MODE=EVOLUTION
```

Nesse modo, o endpoint de conexão:

1. cria/reusa somente a instância `agent-{agentId}`;
2. força `groupsIgnore=true` e `syncFullHistory=false`;
3. vincula a instância somente à conta Chatwoot daquele agente;
4. lê o `ownerJid` do provedor e grava o telefone normalizado;
5. só libera a caixa quando Evolution, Chatwoot e identidade concordam.

Na Evolution 2.3.7, desative explicitamente a importação direta do banco do
Chatwoot quando ela não for usada:

```dotenv
CHATWOOT_IMPORT_DATABASE_CONNECTION_URI=
```

Não deixe a URI de exemplo da imagem (`...@host:5432/chatwoot`). Qualquer valor
não vazio ativa o caminho de importação e faz a Evolution aguardar um hostname
inexistente depois do envio. O Chatwoot pode então registrar timeout e marcar a
mensagem como falha mesmo após o WhatsApp confirmar a entrega. Antes de repetir
uma mensagem com esse erro, confira o identificador e o ACK no provedor.

Nunca considere QR lido, conexão `open`, resposta HTTP 2xx ou mensagem criada no
Chatwoot como prova isolada de entrega.

## Destino: Meta WhatsApp Cloud com Embedded Signup

No serviço **Chatwoot self-hosted** (não no container do Keepr One), configure:

```dotenv
WHATSAPP_APP_ID=...
WHATSAPP_CONFIGURATION_ID=...
WHATSAPP_APP_SECRET=...
```

Antes de liberar agentes:

1. Configure no Meta Developer Portal o WhatsApp Embedded Signup.
2. Garanta as permissões `whatsapp_business_management`,
   `whatsapp_business_messaging` e `business_management`.
3. Confirme que o Chatwoot mostra “Connect with WhatsApp Business” em
   Configurações → Caixas de entrada → Adicionar caixa → WhatsApp Cloud.
4. Valide o fluxo completo em uma conta de agente piloto e um número Business de
   teste.
5. Troque o Keepr One para `WHATSAPP_CHANNEL_MODE=META_CLOUD`.

Nesse modo, o Keepr One bloqueia o endpoint Evolution. O agente conclui a
autorização da Meta na sua própria conta Chatwoot e volta ao Keepr para validar.
O Keepr consulta a API da conta com o token restrito do próprio agente e aceita
somente uma caixa `Channel::Whatsapp` com provider `whatsapp_cloud` e telefone
verificado.

## Coexistence e número já usado no celular

Quando o número permanece no WhatsApp Business App, use exclusivamente o fluxo
Embedded Signup/Coexistence indicado pela Meta e pelo Chatwoot. Não remova nem
registre manualmente esse número na Cloud API durante a migração. Faça primeiro
um piloto com backup e teste explícito do aplicativo móvel.

## Prova de funcionamento

Para cada agente piloto, registre separadamente:

- conta Keepr e conta Chatwoot correspondentes;
- única caixa e telefone exibidos pela API de inboxes;
- mensagem recebida de um contato privado real;
- resposta entregue ao aparelho do contato;
- template aprovado enviado fora da janela de atendimento;
- inexistência de grupos e conversas de outro agente;
- funcionamento do WhatsApp Business App, quando Coexistence for exigido;
- logs sem retry/dead jobs do webhook Chatwoot → provedor.

## Rollback

Não apague a caixa oficial nem a instância Evolution durante o piloto. Para voltar
temporariamente, restaure `WHATSAPP_CHANNEL_MODE=EVOLUTION`, confirme que o
telefone pertence ao mesmo agente e execute novamente a validação. Nunca mantenha
os dois transportes ativos para o mesmo número ao mesmo tempo.
