/// FlexLife is the product the agent quotes. The current transport still posts
/// through the carrier's Rapid Solve endpoint with a hardcoded product code;
/// that code is an implementation detail, not the name the agent should see.
///
/// When Foresight-based quoting lands (see
/// `docs/superpowers/specs/2026-08-05-flexlife-quote-foresight-design.md`), this
/// module stays the single place that names the product for the UI and for
/// persisted `Illustration.productName`.

import { RAPID_SOLVE_PRODUCT_CODE } from './rapid-solve'

export const FLEX_LIFE_PRODUCT_LABEL = 'FlexLife'

/// Carrier product code used by today's Rapid Solve transport for FlexLife.
/// Kept as an alias so call sites stop treating "956" as the product name.
export const FLEX_LIFE_PRODUCT_CODE = RAPID_SOLVE_PRODUCT_CODE

export function flexLifeProductLabel(productCode: string | null | undefined): string {
  if (!productCode) return FLEX_LIFE_PRODUCT_LABEL
  if (productCode === FLEX_LIFE_PRODUCT_CODE || productCode === FLEX_LIFE_PRODUCT_LABEL) {
    return FLEX_LIFE_PRODUCT_LABEL
  }
  // Unknown codes stay as codes — inventing a FlexLife label for Term (or any
  // other product) would be worse than showing the carrier's own identifier.
  return productCode
}
