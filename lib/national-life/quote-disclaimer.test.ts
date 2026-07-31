import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { QUOTE_DISCLAIMER } from './quote-disclaimer'

// Three clauses must never be lost from this string, no matter how it gets
// reworded later. Asserting on substrings — not the whole sentence — means a
// future edit that keeps two of the three but drops one still fails loudly,
// instead of quietly shipping a weaker condition on both screens at once.
describe('QUOTE_DISCLAIMER', () => {
  // Distinguishes a quote from a proposal. The two are different documents
  // with different legal weight, and calling a quote a "proposta" implies a
  // commitment nobody has made yet.
  it('says this is a quote, not a proposal', () => {
    expect(QUOTE_DISCLAIMER).toContain('Cotação, não proposta')
  })

  // The numbers are demonstrative, not a promise. Losing this clause is how a
  // screen ends up looking like it guarantees a premium or a payout the
  // carrier has not actually committed to.
  it('says the values are not guaranteed', () => {
    expect(QUOTE_DISCLAIMER).toContain('não são garantidos')
  })

  // The one instruction that keeps this screen out of a client's hands. If
  // this clause disappears, an agent has no textual reason not to forward the
  // page straight to the client it was never cleared for.
  it('says it must not be shown to the client', () => {
    expect(QUOTE_DISCLAIMER).toContain('não pode ser exibido a ele')
  })
})

// Protecting the constant's wording (above) is not the same as protecting its
// use: this exact phrase was hand-copied as a literal into a screen twice
// already on this branch (app/agent/illustrations/NewIllustrationForm.tsx and
// app/agent/clients/[id]/page.tsx) before both were pointed at
// QUOTE_DISCLAIMER instead of their own copy of the text. Nothing structural
// stopped a third hand-copy, or a fifth screen doing it for the first time —
// so this test greps every .ts/.tsx source file under app/, components/ and
// lib/ for the constant's opening clause and fails if it turns up anywhere
// but the constant's own file and this test file (which has to contain the
// phrase to search for it). Plain substring search over a few hundred small
// files, no AST, no transpile — stays a few milliseconds, not a build.
describe('QUOTE_DISCLAIMER usage', () => {
  const ROOT = fileURLToPath(new URL('../..', import.meta.url))
  const ALLOWED_RELATIVE_PATHS = new Set([
    join('lib', 'national-life', 'quote-disclaimer.ts'),
    join('lib', 'national-life', 'quote-disclaimer.test.ts'),
  ])
  const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])

  function sourceFiles(dir: string): string[] {
    const files: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...sourceFiles(full))
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        files.push(full)
      }
    }
    return files
  }

  it('is never hand-copied outside the constant that owns it', () => {
    const needle = 'Cotação, não proposta'

    const offenders = ['app', 'components', 'lib']
      .flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .filter((file) => !ALLOWED_RELATIVE_PATHS.has(relative(ROOT, file)))
      .filter((file) => readFileSync(file, 'utf8').includes(needle))
      .map((file) => relative(ROOT, file))

    expect(offenders).toEqual([])
  })
})
