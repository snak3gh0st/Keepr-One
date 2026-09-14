import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/Table'
import { chatwootConfigFromEnv } from '@/lib/messaging/chatwoot-config'
import { prismaProvisionDeps } from '@/lib/messaging/provision-prisma'
import { provisionAgentInbox } from '@/lib/messaging/provision-agent-inbox'
import { whatsappChannelModeFromEnv } from '@/lib/messaging/channel-mode'
import { MessagingWorkspace } from './MessagingWorkspace'
import { KBotMessageCenter, type KBotMessageCenterProposal } from './KBotMessageCenter'
import { getCurrentSession, getServerI18n } from '@/lib/i18n/server'
import { isReadOnlySupportPreview } from '@/lib/support-preview'
import { APPROVAL_WINDOW_MS, AWAITING_APPROVAL } from '@/lib/kbot-followup/domain'
import { SCHEDULED_CATEGORIES, type ScheduledCategory, type TemplateLanguage } from '@/lib/kbot-templates/categories'
import { toApprovalProposal } from '@/lib/kbot-templates/approval-view'
import { toKBotContactRows } from '@/lib/kbot-messaging/contact-list'
import { NO_CONTACT_REACH, tallyContactReach } from '@/lib/kbot-messaging/contact-reach'
import { subjectKeyForClient } from '@/lib/kbot-messaging/subject-key'
import { toArrivalExample } from '@/lib/kbot-messaging/arrival-example'
import { getServerLanguage } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

/// Sem isto, a página tentaria carregar 17.733 contatos de uma vez — pior do
/// que não ter tela nenhuma, já que `KBotContactList` não tem virtualização.
const CONTACTS_PAGE_SIZE = 25
/// Quantos contatos com data de nascimento carregar para encontrar um exemplo
/// de chegada (o que o K-Bot mandaria quando nada está ligado ainda).
const ARRIVAL_EXAMPLE_CANDIDATES = CONTACTS_PAGE_SIZE * 2

export default async function MensagensPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string; contactsQuery?: string; contactsPage?: string }>
}) {
  const params = await searchParams
  const selected = params.conversation
  const initialConversationId = selected && /^\d{1,32}$/.test(selected) ? selected : undefined
  const contactsQuery = (params.contactsQuery ?? '').trim().slice(0, 100)
  const requestedContactsPage = Math.max(1, Number.parseInt(params.contactsPage ?? '1', 10) || 1)
  const { copy } = await getServerI18n()
  const language = await getServerLanguage()
  const [agent, session] = await Promise.all([getCurrentAgent(), getCurrentSession()])
  const readOnly = isReadOnlySupportPreview(session)
  const [user, existingMessagingAccount] = await Promise.all([
    prisma.user.findUnique({ where: { id: agent.userId } }),
    readOnly
      ? prisma.agentMessagingAccount.findUnique({
          where: { agentId: agent.id },
          select: { externalUserToken: true },
        })
      : Promise.resolve(null),
  ])
  const config = chatwootConfigFromEnv(process.env)
  let messagingReady = false
  let failed = false

  if (config) {
    if (readOnly) {
      // A support preview may display only an already-linked account. Calling
      // the normal provisioner here would create a Chatwoot user/account on a
      // GET, which violates the preview's read-only contract.
      messagingReady = Boolean(existingMessagingAccount?.externalUserToken)
    } else {
      try {
        await provisionAgentInbox(prismaProvisionDeps(prisma, config), {
          agentId: agent.id,
          agentName: user?.name ?? copy('Agente', 'Agent'),
          agentEmail: user?.email ?? `agent-${agent.id}@keeprone.com`,
        })
        messagingReady = true
      } catch (error) {
        console.error('[mensagens] provisioning failed', error)
        failed = true
      }
    }
  }

  // O K-Bot não depende do WhatsApp/Chatwoot estar pronto — carrega sempre,
  // mesmo no estado vazio da caixa de mensagens.
  const contactWhere = {
    assignedAgentId: agent.id,
    ...(contactsQuery
      ? { OR: [
          { name: { contains: contactsQuery, mode: 'insensitive' as const } },
          { phone: { contains: contactsQuery } },
        ] }
      : {}),
  }
  const contactsMatched = await prisma.client.count({ where: contactWhere })
  const contactsTotalPages = Math.max(1, Math.ceil(contactsMatched / CONTACTS_PAGE_SIZE))
  const contactsPage = Math.min(requestedContactsPage, contactsTotalPages)
  const jobFields = {
    id: true, category: true, customerName: true, phone: true, language: true,
    status: true, errorCode: true, content: true, createdAt: true, updatedAt: true,
  } as const

  const [templates, jobs, enabledCount, contactRows, exampleCandidates] = await Promise.all([
    prisma.kBotMessageTemplate.findMany({
      where: { agentId: agent.id, category: { in: [...SCHEDULED_CATEGORIES] } },
      select: { category: true, language: true, body: true, enabled: true },
    }),
    // Oldest first: closest to expiring, and expiry is the only thing here
    // that happens without the agent.
    prisma.kBotFollowupJob.findMany({
      where: { agentId: agent.id, category: { in: [...SCHEDULED_CATEGORIES] }, status: AWAITING_APPROVAL },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: jobFields,
    }),
    // Conta o agente inteiro, não a página em tela: o convite "ligar para
    // todos" é a mitigação de contatos nascerem desligados por padrão, e uma
    // resposta baseada só nas 25 linhas visíveis convidaria um agente que já
    // ligou milhares de contatos a "ligar todos" de novo, ou esconderia o
    // convite de quem não ligou nenhum só porque a página 1 não mostra isso.
    prisma.kBotContactPreference.count({ where: { agentId: agent.id, kbotEnabledAt: { not: null } } }),
    prisma.client.findMany({
      where: contactWhere,
      orderBy: { name: 'asc' },
      skip: (contactsPage - 1) * CONTACTS_PAGE_SIZE,
      take: CONTACTS_PAGE_SIZE,
      select: { id: true, name: true, phone: true },
    }),
    // Contatos com data de nascimento e telefone para escolher um para o
    // exemplo do que a chegada mostraria quando nada está ligado ainda — sem
    // o filtro de telefone a amostra incluiria os 13.549 contatos que o
    // K-Bot nunca poderia alcançar (só 4.184 dos 17.733 têm telefone), e a
    // tela feita para vender o K-Bot ilustraria, na maioria das vezes, uma
    // mensagem para alguém inalcançável. `orderBy` é explícito e estável
    // (por id) para que a amostra dos "primeiros N" seja a mesma a cada
    // carga — sem isto, "o aniversário mais próximo" seria só o mais
    // próximo dentre 50 contatos escolhidos ao acaso, que muda a cada
    // recarga. Isto é só um exemplo do que uma mensagem parece — não é uma
    // fila nem uma previsão de quem será contatado a seguir.
    prisma.client.findMany({
      where: { assignedAgentId: agent.id, dateOfBirth: { not: null }, phone: { not: null } },
      orderBy: { id: 'asc' },
      take: ARRIVAL_EXAMPLE_CANDIDATES,
      select: { name: true, dateOfBirth: true },
    }),
  ])

  const preferences = await prisma.kBotContactPreference.findMany({
    where: {
      agentId: agent.id,
      subjectKey: {
        in: Array.from(new Set([
          ...contactRows.flatMap((client) => [subjectKeyForClient(client.id), client.phone].filter((value): value is string => Boolean(value))),
          ...jobs.map((job) => job.phone),
        ])),
      },
    },
    select: { subjectKey: true, optedOut: true, kbotEnabledAt: true },
  })

  // O mesmo texto que `toApprovalProposal` já calcula para `/agent/kbot/agendadas`
  // — só reembalado no formato que a Central de Mensagens usa.
  const templateByKey = new Map(templates.map((template) => [`${template.category}:${template.language}`, template]))

  // O exemplo que mostra valor antes de qualquer decisão: o que a chegada
  // teria mandado para um contato real quando nada está ligado ainda.
  const birthdayTemplate = templateByKey.get(`BIRTHDAY:${language}`)
  const example = birthdayTemplate?.body
    ? toArrivalExample({
        now: new Date(),
        templateBody: birthdayTemplate.body,
        agentName: user?.name ?? '',
        candidates: exampleCandidates,
      })
    : null
  const proposals: KBotMessageCenterProposal[] = jobs.map((row) => {
    const template = templateByKey.get(`${row.category}:${row.language}`)
    const proposal = toApprovalProposal(row, {
      agentName: user?.name ?? '',
      templateBody: template?.body ?? null,
      templateEnabled: template?.enabled === true,
      approvalWindowMs: APPROVAL_WINDOW_MS,
    })
    return {
      jobIds: [proposal.id],
      category: proposal.category as ScheduledCategory,
      customerName: proposal.customerName,
      phone: proposal.phone,
      language: proposal.language as TemplateLanguage,
      content: proposal.text,
      createdAt: proposal.createdAt,
      problem: proposal.problem,
      unknown: proposal.unknown,
      expiresAt: proposal.expiresAt,
    }
  })

  const contactRowsView = toKBotContactRows({ contacts: contactRows, preferences })
  // A varredura dos telefones do agente inteiro existe para um único cartão: o
  // convite de chegada, que só aparece para quem ainda não ligou ninguém.
  //
  // Ela não pode ser uma contagem do banco. `phone IS NOT NULL` responde "há
  // algo gravado", que não é a pergunta que a tela faz — um `(555) 123-4567`
  // conta como telefone para o SQL e não conta para o gate de envio, e era
  // exatamente essa diferença que fazia o número antes do clique e o aviso
  // depois dele não fecharem. Classificar exige ler a coluna.
  //
  // Mas ler a coluna inteira em todo render pagaria para sempre por números
  // que ninguém mais vê depois do primeiro contato ligado. Então a leitura
  // acontece só no estado que a consome. Em regime, a página não a faz.
  const reachTally = enabledCount === 0
    ? tallyContactReach(
        (await prisma.client.findMany({ where: { assignedAgentId: agent.id }, select: { phone: true } }))
          .map((client) => client.phone),
      )
    : NO_CONTACT_REACH
  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <KBotMessageCenter
        proposals={proposals}
        contacts={contactRowsView}
        reach={{ ...reachTally, enabledCount }}
        contactsQuery={contactsQuery}
        contactsPage={contactsPage}
        contactsTotalPages={contactsTotalPages}
        conversationId={initialConversationId}
        example={example}
      />
      {messagingReady ? (
        <MessagingWorkspace
          initialConversationId={initialConversationId}
          channelMode={whatsappChannelModeFromEnv(process.env)}
          readOnly={readOnly}
        />
      ) : (
        <>
          <PageHeader
            title={copy('Mensagens', 'Messages')}
            eyebrow={copy('Conversa com seus clientes', 'Conversations with your clients')}
            description={copy('WhatsApp e e-mail em uma única caixa, dentro do Keepr One.', 'WhatsApp and email in one inbox, inside Keepr One.')}
          />
          <EmptyState>
            {readOnly
              ? copy('Nenhuma conta de mensagens existente está disponível neste modo de suporte. Nada foi criado.', 'No existing messaging account is available in support mode. Nothing was created.')
              : failed
              ? copy('Não foi possível abrir suas mensagens agora. Tente novamente em alguns instantes.', 'We couldn’t open your messages right now. Please try again in a moment.')
              : copy('Assim que os canais forem liberados para sua conta, eles aparecerão aqui.', 'Your channels will appear here as soon as they are enabled for your account.')}
          </EmptyState>
        </>
      )}
    </Shell>
  )
}
