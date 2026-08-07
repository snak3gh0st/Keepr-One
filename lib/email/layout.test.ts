import { describe, expect, it } from 'vitest'
import { renderEmailLayout } from './layout'

describe('renderEmailLayout', () => {
  it('includes the heading and body content', () => {
    const html = renderEmailLayout({
      heading: 'Título de teste',
      bodyHtml: '<p>Corpo de teste</p>',
    })

    expect(html).toContain('Título de teste')
    expect(html).toContain('<p>Corpo de teste</p>')
    expect(html).toContain('KEEPR ONE')
  })

  it('renders a CTA button when label and url are provided', () => {
    const html = renderEmailLayout({
      heading: 'Título',
      bodyHtml: '<p>Corpo</p>',
      ctaLabel: 'Clique aqui',
      ctaUrl: 'https://app.keeprone.com/reset?token=abc',
    })

    expect(html).toContain('Clique aqui')
    expect(html).toContain('https://app.keeprone.com/reset?token=abc')
  })

  it('omits the CTA block when no url is provided', () => {
    const html = renderEmailLayout({
      heading: 'Título',
      bodyHtml: '<p>Corpo</p>',
    })

    expect(html).not.toContain('display:inline-block')
  })

  it('includes the preheader text hidden from view when provided', () => {
    const html = renderEmailLayout({
      heading: 'Título',
      bodyHtml: '<p>Corpo</p>',
      preheader: 'Texto de pré-visualização',
    })

    expect(html).toContain('Texto de pré-visualização')
  })
})
