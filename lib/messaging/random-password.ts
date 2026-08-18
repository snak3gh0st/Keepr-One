/// Chatwoot enforces a password policy on the Platform API, and a password that
/// misses a class is refused with 422 — which surfaced as every agent's first visit
/// showing an empty inbox. A mocked client cannot see a remote policy, so the shape
/// is guaranteed here instead of hoped for.
///
/// The agent never types this: they reach the inbox by SSO. It exists only because
/// Chatwoot requires one.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const DIGIT = '23456789'
const SYMBOL = '!@#$%^&*'
const ALL = `${UPPER}${LOWER}${DIGIT}${SYMBOL}`

function pick(alphabet: string, count: number): string[] {
  const bytes = crypto.getRandomValues(new Uint32Array(count))
  return [...bytes].map((byte) => alphabet[byte % alphabet.length] as string)
}

export function randomChatwootPassword(): string {
  // One of each class first, so the policy is satisfied by construction rather
  // than by the odds of a random draw happening to include them.
  const required = [
    ...pick(UPPER, 1),
    ...pick(LOWER, 1),
    ...pick(DIGIT, 1),
    ...pick(SYMBOL, 1),
  ]
  const filler = pick(ALL, 20)
  const characters = [...required, ...filler]

  // Fisher-Yates, so the required characters do not always sit in the first four
  // positions — a predictable prefix is a smaller search space.
  const order = crypto.getRandomValues(new Uint32Array(characters.length))
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = (order[index] as number) % (index + 1)
    const held = characters[index] as string
    characters[index] = characters[swap] as string
    characters[swap] = held
  }

  return characters.join('')
}
