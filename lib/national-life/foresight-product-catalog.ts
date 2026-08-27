export type ForesightIllustrationProduct = {
  key: 'FLEXLIFE_IUL' | 'LSW_TERM' | 'NL_TERM'
  label: 'IUL' | 'Term'
  kind: 'IUL' | 'TERM'
  carrierName: 'FlexLife' | 'LSW Term' | 'NL Term'
  description: string
  availability: 'READY' | 'CONTRACT_REQUIRED'
}

/// Products observed in Foresight's own New Illustration selector. Only a
/// product with a captured page/field contract can become executable: a label
/// in the carrier menu is not enough to safely create a carrier artifact.
export const FORESIGHT_ILLUSTRATION_PRODUCTS: readonly ForesightIllustrationProduct[] = [
  {
    key: 'FLEXLIFE_IUL',
    label: 'IUL',
    kind: 'IUL',
    carrierName: 'FlexLife',
    description: 'FlexLife • Indexed Universal Life',
    availability: 'READY',
  },
  {
    key: 'LSW_TERM',
    label: 'Term',
    kind: 'TERM',
    carrierName: 'LSW Term',
    description: 'Life Insurance Company of the Southwest • Term Life',
    availability: 'READY',
  },
  {
    key: 'NL_TERM',
    label: 'Term',
    kind: 'TERM',
    carrierName: 'NL Term',
    description: 'National Life Insurance Company • Term Life',
    availability: 'READY',
  },
] as const

export function getForesightIllustrationProduct(value: string | null | undefined) {
  return FORESIGHT_ILLUSTRATION_PRODUCTS.find((product) => product.key === value)
}
