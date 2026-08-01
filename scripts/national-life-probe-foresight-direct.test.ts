import { describe, expect, it } from 'vitest'
import { readEntryVerdict } from './national-life-probe-foresight-direct'

describe('readEntryVerdict', () => {
  // The first run of this probe returned AUTHENTICATED about a logged-out
  // browser, because the carrier keeps its own name on the page it shows *after*
  // the session is gone. The title is decoration; the path is the fact.
  it('does not mistake the tool name for a live session', () => {
    expect(
      readEntryVerdict({
        url: 'https://www.nationallife.com/NWI/Main/Unsecure/ShowMessage.aspx',
        hasPasswordField: false,
        hasStartPageFrame: false,
      }),
    ).toBe('SESSION_GONE')
  })

  it('calls it usable only when the working surface is there', () => {
    expect(
      readEntryVerdict({
        url: 'https://www.nationallife.com/NWI/Main/Layout.aspx',
        hasPasswordField: false,
        hasStartPageFrame: true,
      }),
    ).toBe('USABLE')
  })

  it('reports the identity wall ahead of anything else', () => {
    expect(
      readEntryVerdict({
        url: 'https://nlg-prod.auth0.com/login',
        hasPasswordField: true,
        hasStartPageFrame: false,
      }),
    ).toBe('AUTH0_WALL')
  })

  // A shell with no Recent panel and no wall is not a verdict. Saying so beats
  // guessing in either direction.
  it('admits when it cannot tell', () => {
    expect(
      readEntryVerdict({
        url: 'https://www.nationallife.com/NWI/Main/Layout.aspx',
        hasPasswordField: false,
        hasStartPageFrame: false,
      }),
    ).toBe('UNKNOWN')
  })
})
