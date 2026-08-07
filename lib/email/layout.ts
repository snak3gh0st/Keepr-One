import 'server-only'

/// Estas cores espelham as reais do site (app/globals.css, components/Logo.tsx),
/// não uma paleta inventada pro e-mail. `--color-mint` é `oklch(0.82 0.15 151)`,
/// que não existe em cliente de e-mail — convertido para sRGB uma vez aqui.
const BG_OUTER = '#050505'
const BG_CARD = '#0a0a0a'
const BORDER = 'rgba(255,255,255,0.12)'
const MINT = '#72df91'
const LOGO_GREEN = '#42c77d'
const TEXT_PRIMARY = '#ffffff'
const TEXT_MUTED = 'rgba(255,255,255,0.56)'
const TEXT_FAINT = 'rgba(255,255,255,0.42)'

/// As três paths de components/Logo.tsx (`LogoMark`, tone="default"), copiadas
/// literalmente. Um `<img>` externo seria bloqueado por padrão em metade dos
/// clientes; o SVG inline sempre aparece, exceto no Outlook desktop — que já cai
/// para o texto "keeprone" ao lado, então a marca nunca fica ilegível.
const LOGO_MARK_SVG = `
<svg width="28" height="28" viewBox="8 6 84 86" xmlns="http://www.w3.org/2000/svg">
  <path d="M13 13.5C13 11.01 15.01 9 17.5 9H44L13 58V13.5Z" fill="${LOGO_GREEN}" stroke="#237f5a" stroke-width="0.7" />
  <path d="M13 64.5L60.5 9H88L13 86V64.5Z" fill="${LOGO_GREEN}" stroke="#237f5a" stroke-width="0.7" />
  <path d="M47.5 66L61.5 52L89 88H61L47.5 66Z" fill="#ffffff" stroke="rgba(8, 20, 14, 0.2)" stroke-width="0.7" />
</svg>`.trim()

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

export function renderEmailLayout(options: {
  preheader?: string
  heading: string
  bodyHtml: string
  ctaLabel?: string
  ctaUrl?: string
}): string {
  const { preheader, heading, bodyHtml, ctaLabel, ctaUrl } = options

  const cta =
    ctaLabel && ctaUrl
      ? `
        <tr>
          <td align="center" style="padding: 8px 0 8px;">
            <a href="${ctaUrl}" style="display:inline-block; background:${MINT}; color:#08130c; font-weight:700; font-size:15px; text-decoration:none; padding:14px 30px; border-radius:10px; font-family:${FONT_STACK};">
              ${ctaLabel}
            </a>
          </td>
        </tr>`
      : ''

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>${heading}</title>
  </head>
  <body style="margin:0; padding:0; background:${BG_OUTER}; font-family:${FONT_STACK};">
    ${preheader ? `<div style="display:none; max-height:0; overflow:hidden; opacity:0;">${preheader}</div>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG_OUTER}; padding: 40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background:${BG_CARD}; border-radius:16px; overflow:hidden; border:1px solid ${BORDER};">
            <tr>
              <td style="padding: 28px 32px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align:middle;">${LOGO_MARK_SVG}</td>
                    <td style="padding-left:9px; vertical-align:middle; font-size:16px; letter-spacing:-0.02em;">
                      <span style="color:${TEXT_PRIMARY}; font-weight:700;">keepr</span><span style="color:${LOGO_GREEN}; font-weight:500;">one</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 4px 32px 28px;">
                <div style="height:1px; width:44px; background:${MINT}; margin-bottom:22px;"></div>
                <h1 style="margin:0 0 16px; font-size:24px; line-height:1.25; letter-spacing:-0.02em; font-weight:500; color:${TEXT_PRIMARY};">${heading}</h1>
                <div style="font-size:15px; line-height:1.65; color:${TEXT_MUTED};">${bodyHtml}</div>
              </td>
            </tr>
            ${cta}
            <tr>
              <td style="padding: 8px 32px 28px;">
                <div style="border-top:1px solid ${BORDER}; padding-top:20px;">
                  <p style="margin:0; font-size:12px; line-height:1.6; color:${TEXT_FAINT};">
                    Este é um e-mail automático do Keepr One. Se você não reconhece esta ação, ignore esta mensagem ou entre em contato com o suporte.
                  </p>
                </div>
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; margin-top:20px;">
            <tr>
              <td style="padding: 0 8px; font-size:11px; letter-spacing:0.04em; text-transform:uppercase; color:${TEXT_FAINT};">
                © ${new Date().getUTCFullYear()} Keepr One · Privacidade por padrão
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}
