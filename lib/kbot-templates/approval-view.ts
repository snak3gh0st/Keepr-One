import type { ScheduledJobRow } from './schedule-view'
import { renderTemplate, type TemplateValues } from './variables'

/// How the approval queue reads a proposal the agent has not released yet.
///
/// A proposal is a `KBotFollowupJob` in `AWAITING_APPROVAL`: the trigger fired,
/// the credit was reserved, and nothing else happens until a person says so.
/// The whole reason the screen exists is that the agent gets to read the exact
/// text before it leaves, so this module renders it here rather than letting
/// the card show the template with the braces still in it.

/// The values one proposal is rendered with.
///
/// `primeiro_nome` is the first token of the saved name, which is what a
/// greeting wants — "Feliz aniversário, Ana Ribeiro" reads like a form letter.
/// A name that is a single word gives the same string for both, which is right.
export function templateValuesFor(input: { customerName: string; agentName: string }): TemplateValues {
  const name = input.customerName.trim()
  return {
    nome: name,
    primeiro_nome: name.split(/\s+/)[0] ?? name,
    agente: input.agentName.trim(),
  }
}

/// Why a proposal cannot be shown as the text that will go out.
///
/// Both are the same situation from the agent's side — we cannot tell you what
/// this message says — but they need different sentences, because only one of
/// them is fixed by editing the template.
export type ApprovalProblem =
  /// The category's template for this language is gone or switched off since
  /// the proposal was raised. The worker re-reads the template at dispatch and
  /// would settle the job as `TEMPLATE_MISSING`, so approving is pointless.
  | 'TEMPLATE_MISSING'
  /// The template was edited into something `renderTemplate` will not fill.
  | 'UNRENDERABLE'

export type ApprovalProposal = {
  id: string
  category: string
  customerName: string
  phone: string
  language: string
  /// The exact text that will be sent, or `null` when it cannot be produced.
  /// There is no third state: a proposal never carries a half-rendered body.
  text: string | null
  problem: ApprovalProblem | null
  /// The variable names the template asks for and this system cannot fill.
  unknown: string[]
  createdAt: string
  /// `createdAt` plus the approval window. Computed on the server so the card
  /// and `expireStaleScheduledProposals` agree on the same instant.
  expiresAt: string
}

/// Build one card from the job row and the template it will be sent with.
///
/// The window is injected rather than imported: this module is read by the
/// client component, and `lib/kbot-followup/domain.ts` reaches for `node:crypto`.
export function toApprovalProposal(
  row: ScheduledJobRow,
  options: { agentName: string; templateBody: string | null; approvalWindowMs: number },
): ApprovalProposal {
  const base = {
    id: row.id,
    category: row.category,
    customerName: row.customerName,
    phone: row.phone,
    language: row.language,
    createdAt: row.createdAt.toISOString(),
    expiresAt: new Date(row.createdAt.getTime() + options.approvalWindowMs).toISOString(),
  }
  const body = options.templateBody?.trim()
  if (!body) return { ...base, text: null, problem: 'TEMPLATE_MISSING', unknown: [] }
  const rendered = renderTemplate(body, templateValuesFor({ customerName: row.customerName, agentName: options.agentName }))
  // `renderTemplate` is total: it either filled everything or it hands back the
  // names it could not fill. Nothing here ever prints a raw `{{ }}`.
  if (!rendered.ok) return { ...base, text: null, problem: 'UNRENDERABLE', unknown: rendered.unknown }
  return { ...base, text: rendered.text, problem: null, unknown: [] }
}

/// A proposal is approvable only when the agent can actually read what they are
/// releasing, and only while the window is still open.
export function canApprove(proposal: ApprovalProposal, now: number): boolean {
  return proposal.problem === null && proposal.text !== null && new Date(proposal.expiresAt).getTime() > now
}

export type ApprovalTimeLeft = { expired: boolean; hours: number; minutes: number }

/// How long the agent still has. A proposal that expires without warning looks
/// like a bug — the card says the hour, not just "waiting".
export function approvalTimeLeft(expiresAt: string, now: number): ApprovalTimeLeft {
  const remaining = new Date(expiresAt).getTime() - now
  if (!(remaining > 0)) return { expired: true, hours: 0, minutes: 0 }
  return {
    expired: false,
    hours: Math.floor(remaining / 3_600_000),
    minutes: Math.floor((remaining % 3_600_000) / 60_000),
  }
}
