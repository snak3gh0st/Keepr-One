import 'server-only'

const BRAND_GREEN = '#0d5f35'
const ACCENT_GREEN = '#65e497'
const INK = '#111813'
const MUTED = '#5b6a61'

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
          <td align="center" style="padding: 8px 0 32px;">
            <a href="${ctaUrl}" style="display:inline-block; background:${ACCENT_GREEN}; color:${BRAND_GREEN}; font-weight:700; font-size:15px; text-decoration:none; padding:14px 28px; border-radius:8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
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
    <title>${heading}</title>
  </head>
  <body style="margin:0; padding:0; background:#f4f6f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    ${preheader ? `<div style="display:none; max-height:0; overflow:hidden; opacity:0;">${preheader}</div>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f4; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e4e9e5;">
            <tr>
              <td style="background:${BRAND_GREEN}; padding: 24px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:32px; height:32px; background:${ACCENT_GREEN}; border-radius:8px; text-align:center; vertical-align:middle; font-weight:800; color:${BRAND_GREEN}; font-size:16px;">K</td>
                    <td style="padding-left:10px; color:#ffffff; font-weight:700; font-size:15px; letter-spacing:0.02em;">KEEPR ONE</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 32px;">
                <h1 style="margin:0 0 16px; font-size:20px; line-height:1.3; color:${INK};">${heading}</h1>
                <div style="font-size:15px; line-height:1.6; color:${INK};">${bodyHtml}</div>
              </td>
            </tr>
            ${cta}
            <tr>
              <td style="padding: 0 32px 28px;">
                <p style="margin:0; font-size:12px; line-height:1.5; color:${MUTED};">
                  Este é um e-mail automático do Keepr One. Se você não reconhece esta ação, ignore esta mensagem ou entre em contato com o suporte.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}
