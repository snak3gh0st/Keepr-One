/// O que a grade de inforce da National Life já entregou sobre uma apólice.
///
/// Existe porque a tela da apólice lia apenas `NationalLifePolicyDetailSnapshot`
/// — a captura página a página, que cobre duas apólices de dez mil — e mostrava
/// "—" para todo o resto. A linha da grade chega em todo sync, para o book
/// inteiro, e já traz status, produto, emissão, prêmio antecipado e o contato de
/// dono e segurado. Não é dado que falta: era dado que ninguém lia.
///
/// Puro de propósito: a página decide de onde vem a linha e como rotular; aqui só
/// se resolve o que é ausência e o que é conteúdo.

type Nullable = string | null | undefined

export type PolicyBookSummaryRow = {
  policyNumber: string
  fetchedAt: Date
  policyStatus?: Nullable
  productName?: Nullable
  policyIssueDate?: Nullable
  levelPeriodEndDate?: Nullable
  termConversionDate?: Nullable
  anticipatedAnnualPremium?: Nullable
  targetPremium?: Nullable
  accumulatedCashValue?: Nullable
  insuredClientName?: Nullable
  insuredEmail?: Nullable
  insuredPhoneNumber?: Nullable
  insuredAddressLine1?: Nullable
  insuredAddressLine2?: Nullable
  insuredCity?: Nullable
  insuredState?: Nullable
  insuredZipcode?: Nullable
  ownerClientName?: Nullable
  ownerEmail?: Nullable
  ownerPhoneNumber?: Nullable
  ownerAddressLine1?: Nullable
  ownerAddressLine2?: Nullable
  ownerCity?: Nullable
  ownerState?: Nullable
  ownerZipcode?: Nullable
  employerName?: Nullable
}

export type PolicyBookParty = {
  name: string | null
  email: string | null
  phone: string | null
  address: string | null
}

export type PolicyBookSummary = {
  /// Quando a seguradora entregou esta linha. Todo número desta tela é "conforme
  /// a National Life em", nunca um cálculo nosso.
  asOf: string
  policy: {
    status: string | null
    productName: string | null
    issueDate: string | null
    levelPeriodEndDate: string | null
    termConversionDate: string | null
    employerName: string | null
  }
  money: {
    anticipatedAnnualPremium: string | null
    targetPremium: string | null
    accumulatedCashValue: string | null
  }
  insured: PolicyBookParty
  owner: PolicyBookParty
  /// Falso quando a linha existe mas não trouxe nenhum campo além do número. A
  /// tela então diz o que falta em vez de desenhar uma ficha de traços.
  hasAnything: boolean
}

/// Espaço em branco vindo da seguradora é ausência, não valor: um "—" é mais
/// honesto que um campo que parece preenchido e não está.
function text(value: Nullable): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/// Uma linha só, sem vírgulas órfãs — a grade entrega as partes do endereço em
/// cinco campos e quase nunca todas.
function address(parts: {
  line1: Nullable
  line2: Nullable
  city: Nullable
  state: Nullable
  zipcode: Nullable
}): string | null {
  const street = [text(parts.line1), text(parts.line2), text(parts.city)].filter(Boolean)
  const region = [text(parts.state), text(parts.zipcode)].filter(Boolean).join(' ')
  const all = region ? [...street, region] : street
  return all.length > 0 ? all.join(', ') : null
}

export function toPolicyBookSummary(row: PolicyBookSummaryRow | null): PolicyBookSummary | null {
  if (!row) return null

  const policy = {
    status: text(row.policyStatus),
    productName: text(row.productName),
    issueDate: text(row.policyIssueDate),
    levelPeriodEndDate: text(row.levelPeriodEndDate),
    termConversionDate: text(row.termConversionDate),
    employerName: text(row.employerName),
  }
  const money = {
    anticipatedAnnualPremium: text(row.anticipatedAnnualPremium),
    targetPremium: text(row.targetPremium),
    accumulatedCashValue: text(row.accumulatedCashValue),
  }
  const insured: PolicyBookParty = {
    name: text(row.insuredClientName),
    email: text(row.insuredEmail),
    phone: text(row.insuredPhoneNumber),
    address: address({
      line1: row.insuredAddressLine1,
      line2: row.insuredAddressLine2,
      city: row.insuredCity,
      state: row.insuredState,
      zipcode: row.insuredZipcode,
    }),
  }
  const owner: PolicyBookParty = {
    name: text(row.ownerClientName),
    email: text(row.ownerEmail),
    phone: text(row.ownerPhoneNumber),
    address: address({
      line1: row.ownerAddressLine1,
      line2: row.ownerAddressLine2,
      city: row.ownerCity,
      state: row.ownerState,
      zipcode: row.ownerZipcode,
    }),
  }

  const hasAnything = [
    ...Object.values(policy),
    ...Object.values(money),
    ...Object.values(insured),
    ...Object.values(owner),
  ].some((value) => value !== null)

  return { asOf: row.fetchedAt.toISOString(), policy, money, insured, owner, hasAnything }
}
