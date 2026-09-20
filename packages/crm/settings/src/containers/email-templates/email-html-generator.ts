export interface EmailTemplateOptions {
  primaryColor: string;
  logoUrl: string;
  companyName: string;
  footerText: string;
  preheader: string;
}

const DEFAULT_OPTIONS: EmailTemplateOptions = {
  primaryColor: '#6366f1',
  logoUrl: '',
  companyName: 'Sankore CRM',
  footerText: 'Cet e-mail a ete envoye automatiquement. Merci de ne pas repondre directement.',
  preheader: '',
};

const TAG_STYLES: Record<string, string> = {
  h1: 'margin:0 0 16px;font-size:24px;font-weight:700;line-height:1.3;color:#1e293b;',
  h2: 'margin:0 0 14px;font-size:20px;font-weight:700;line-height:1.3;color:#1e293b;',
  h3: 'margin:0 0 12px;font-size:16px;font-weight:600;line-height:1.4;color:#1e293b;',
  p: 'margin:0 0 16px;font-size:15px;line-height:1.7;color:#334155;',
  a: 'color:{{PRIMARY}};text-decoration:underline;',
  strong: 'font-weight:700;',
  em: 'font-style:italic;',
  u: 'text-decoration:underline;',
  s: 'text-decoration:line-through;',
  ul: 'margin:0 0 16px;padding-left:24px;',
  ol: 'margin:0 0 16px;padding-left:24px;',
  li: 'margin:0 0 6px;font-size:15px;line-height:1.7;color:#334155;',
  blockquote: 'margin:0 0 16px;padding:12px 16px;border-left:4px solid #e2e8f0;color:#64748b;font-style:italic;background:#f8fafc;',
  img: 'max-width:100%;height:auto;display:block;border:0;outline:none;',
  hr: 'margin:24px 0;border:none;border-top:1px solid #e2e8f0;',
  br: '',
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineStyles(html: string, primaryColor: string): string {
  if (!html) return '';

  let result = html;

  for (const [tag, style] of Object.entries(TAG_STYLES)) {
    if (!style) continue;
    const resolvedStyle = style.replace(/\{\{PRIMARY\}\}/g, primaryColor);

    // Handle tags with existing style attribute
    const withStyleRegex = new RegExp(`<${tag}(\\s[^>]*?)\\sstyle="([^"]*)"([^>]*)>`, 'gi');
    result = result.replace(withStyleRegex, (_, before, existingStyle, after) => {
      return `<${tag}${before} style="${resolvedStyle}${existingStyle}"${after}>`;
    });

    // Handle tags without style attribute
    const withoutStyleRegex = new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi');
    result = result.replace(withoutStyleRegex, (match) => {
      if (match.includes('style="')) return match; // already processed
      return match.replace(`<${tag}`, `<${tag} style="${resolvedStyle}"`);
    });
  }

  return result;
}

function stripHtmlToText(html: string): string {
  let text = html;
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '  - ');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  text = text.replace(/<hr[^>]*>/gi, '\n---\n');
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#64;/g, '@');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

export function generateEmailHtml(
  subject: string,
  bodyHtml: string,
  options?: Partial<EmailTemplateOptions>,
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const inlinedBody = inlineStyles(bodyHtml, opts.primaryColor);

  const logoBlock = opts.logoUrl
    ? `<tr>
        <td align="center" style="padding:32px 0 24px;">
          <img src="${escapeHtml(opts.logoUrl)}" alt="${escapeHtml(opts.companyName)}" width="140" style="display:block;border:0;outline:none;max-width:140px;height:auto;" />
        </td>
      </tr>`
    : `<tr>
        <td align="center" style="padding:32px 0 24px;">
          <table border="0" cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td style="background:${opts.primaryColor};border-radius:8px;padding:10px 20px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">${escapeHtml(opts.companyName)}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;

  const preheaderBlock = opts.preheader
    ? `<div style="display:none;font-size:1px;color:#f8fafc;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(opts.preheader)}</div>`
    : '';

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(subject)}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    #outlook a { padding: 0; }
    body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    a { color: ${opts.primaryColor}; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .email-content { padding: 24px 16px !important; }
      .email-footer { padding: 16px !important; }
      h1 { font-size: 20px !important; }
      h2 { font-size: 18px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  ${preheaderBlock}

  <!-- Background wrapper -->
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:20px 0;">

        <!--[if mso]>
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" align="center">
        <tr><td>
        <![endif]-->

        <table class="email-container" role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;margin:0 auto;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

          <!-- Logo -->
          ${logoBlock}

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <div style="border-top:1px solid #e2e8f0;"></div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="email-content" style="padding:32px 40px 40px;">
              ${inlinedBody || '<p style="margin:0;font-size:15px;line-height:1.7;color:#94a3b8;text-align:center;">Contenu de l\'e-mail</p>'}
            </td>
          </tr>

          <!-- Footer divider -->
          <tr>
            <td style="padding:0 40px;">
              <div style="border-top:1px solid #e2e8f0;"></div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="email-footer" style="padding:24px 40px 32px;text-align:center;">
              <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#94a3b8;">${escapeHtml(opts.footerText)}</p>
              <p style="margin:0;font-size:11px;line-height:1.6;color:#cbd5e1;">&copy; ${new Date().getFullYear()} ${escapeHtml(opts.companyName)}. Tous droits reserves.</p>
            </td>
          </tr>

        </table>

        <!--[if mso]>
        </td></tr></table>
        <![endif]-->

      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function generateTextFromHtml(html: string): string {
  return stripHtmlToText(html);
}

export function getEmailHtmlSize(html: string): number {
  return new Blob([html]).size;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' o';
  return (bytes / 1024).toFixed(1) + ' Ko';
}
