export type ForesightIllustrationProduct = {
  key: 'FLEXLIFE_IUL' | 'NATIONAL_LIFE_TERM'
  label: 'IUL' | 'Term'
  carrierName: 'FlexLife' | 'NL Term'
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
    carrierName: 'FlexLife',
    description: 'FlexLife • Indexed Universal Life',
    availability: 'READY',
  },
  {
    key: 'NATIONAL_LIFE_TERM',
    label: 'Term',
    carrierName: 'NL Term',
    description: 'National Life Term',
    availability: 'CONTRACT_REQUIRED',
  },
] as const

export function getForesightIllustrationProduct(value: string | null | undefined) {
  return FORESIGHT_ILLUSTRATION_PRODUCTS.find((product) => product.key === value)
}
