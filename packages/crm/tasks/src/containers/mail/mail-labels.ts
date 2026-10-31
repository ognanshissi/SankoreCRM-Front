import { MailMessageDto, MailPartyDto } from '@sankore/crm-api';
import { Severity } from '@talisoft/ui/tag';

/** Les limites du serveur (`MailSendLimits`), vérifiées avant l'envoi pour le dire tout de suite. */
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const BLOCKED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.msi', '.js', '.jse', '.vbs', '.vbe', '.wsf', '.ps1', '.jar', '.lnk'];

/** Les codes d'envoi et de lecture du serveur, en français ; un code inconnu reste une phrase générique. */
export const MAIL_SEND_ERRORS: Record<string, string> = {
  MAIL_RECIPIENTS_REQUIRED: 'Indiquez au moins un destinataire.',
  MAIL_RECIPIENT_INVALID: 'Une adresse de destinataire n’est pas valide.',
  MAIL_TEST_RECIPIENT: 'Mode test : seules les adresses des utilisateurs de l’institution reçoivent des e-mails.',
  MAIL_TOO_MANY_RECIPIENTS: '50 destinataires au plus.',
  MAIL_SUBJECT_INVALID: 'L’objet n’est pas valide.',
  MAIL_BODY_TOO_LARGE: 'Le message est trop long.',
  MAIL_TOO_MANY_ATTACHMENTS: '10 pièces jointes au plus.',
  MAIL_ATTACHMENTS_TOO_LARGE: 'Les pièces jointes dépassent 20 Mo au total.',
  MAIL_ATTACHMENT_BLOCKED: 'Les fichiers exécutables ne peuvent pas être envoyés.',
  MAIL_ATTACHMENT_NOT_FOUND: 'Une pièce jointe du message d’origine n’existe plus.',
  MAIL_MESSAGE_NOT_FOUND: 'Le message d’origine n’existe plus.',
  MAIL_MESSAGE_OF_ANOTHER_MAILBOX: 'Une réponse part de la boîte qui a reçu le message.',
  MAIL_SEND_REFUSED: 'Le fournisseur a refusé l’envoi (destinataire, taille ou règle de sécurité).',
  MAIL_SEND_FAILED: 'Le fournisseur ne répond pas pour le moment. Réessayez.',
  MAIL_SMTP_AUTH_FAILED: 'Le serveur d’envoi refuse le mot de passe : corrigez-le dans Mon compte › Agendas et messagerie.',
  MAIL_IMAP_AUTH_FAILED: 'Le serveur refuse le mot de passe : corrigez-le dans Mon compte › Agendas et messagerie.',
  CONNECTED_MAILBOX_DISABLED: 'La messagerie de cette boîte n’est pas activée.',
  CONNECTED_MAILBOX_SIMULATED: 'Un compte simulé ne peut pas envoyer d’e-mail.',
  CONNECTED_ACCOUNT_NEEDS_RECONNECT: 'Le fournisseur a refusé l’accès : reconnectez la boîte dans Mon compte.',
  CONNECTED_ACCOUNT_NOT_FOUND: 'Cette boîte n’est plus connectée.',
  MAIL_CLIENT_NOT_REACHABLE: 'Ce client n’est pas dans votre périmètre, ou n’existe plus.',
  MAIL_CLIENT_RESTRICTED: 'Ce client a demandé l’effacement de ses données : plus de contact à notre initiative.',
  MAIL_CLIENT_EMAIL_MISSING: 'Ce client n’a pas d’adresse e-mail active : ajoutez-en une dans Coordonnées.',
  MAIL_COMPLAINT_NOT_FOUND: 'Cette réclamation n’est pas celle de ce client.',
};

/** « a@b.ci, c@d.ci; e@f.ci » → trois adresses. */
export function splitAddresses(value: string | null | undefined): string[] {
  return (value ?? '').split(/[,;]/).map((a) => a.trim()).filter((a) => a.length > 0);
}

export function addressesOf(parties: MailPartyDto[] | null | undefined): string[] {
  return (parties ?? []).map((p) => p.address ?? '').filter((a) => a.length > 0);
}

export function partyLabel(party: MailPartyDto | null | undefined): string {
  return party?.name?.trim() || party?.address || '';
}

/** Du texte lisible à partir de HTML — pour citer un message, jamais pour l'afficher. */
export function htmlToText(html: string): string {
  const withBreaks = html.replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  doc.querySelectorAll('style,script,head').forEach((n) => n.remove());
  return (doc.body.textContent ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isYesterday(date: Date, now: Date): boolean {
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  return date.toDateString() === y.toDateString();
}

function time(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** La liste : aujourd'hui l'heure, hier « Hier », cette année « 22 oct. », sinon la date complète. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return time(date);
  if (isYesterday(date, now)) return 'Hier';
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return date.toLocaleDateString('fr-FR');
}

/** Un message du fil : « Aujourd’hui · 21:32 », « Hier · 09:10 », « mar. 27 oct. · 18:27 ». */
export function messageDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return `Aujourd’hui · ${time(date)}`;
  if (isYesterday(date, now)) return `Hier · ${time(date)}`;
  const day = date.toLocaleDateString('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  return `${day} · ${time(date)}`;
}

/** « synchronisé il y a 2 min » — l'heure de la dernière lecture de la boîte. */
export function syncedAgo(value: string | null | undefined): string {
  if (!value) return 'jamais synchronisée';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'synchronisé à l’instant';
  if (minutes < 60) return `synchronisé il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `synchronisé il y a ${hours} h`;
  return `synchronisé le ${new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
}

/** « Ognan Shissidevo » → « OS » ; une adresse → ses deux premières lettres. */
export function initials(label: string | null | undefined): string {
  const words = (label ?? '').replace(/@.*/, '').split(/[\s._-]+/).filter((w) => /\p{L}/u.test(w));
  if (words.length === 0) return '?';
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0];
  return letters.toUpperCase();
}

/** Le début de la citation d'un message précédent, en texte : « > », « Le …, X a écrit : », « On … wrote: ». */
const QUOTE_START = /(^|\n)\s*(>|Le .{4,120}? a écrit\s*:|On .{4,120}? wrote\s*:|-{5,}\s*(Message|Original))/;

/**
 * La première ligne lisible d'un message, pour une ligne repliée du fil — SANS la citation du
 * message d'avant : sinon chaque ligne repliée répète la précédente.
 */
export function bodyPreview(message: MailMessageDto): string {
  let text = message.body ?? '';
  if (message.bodyIsHtml) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    doc.querySelectorAll('blockquote,.gmail_quote,.gmail_quote_container,.moz-cite-prefix,#divRplyFwdMsg').forEach((n) => n.remove());
    text = htmlToText(doc.body.innerHTML);
  }
  const at = text.search(QUOTE_START);
  if (at > 0) text = text.slice(0, at);
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** L'objet d'une réponse ou d'un transfert : « RE: … », sans doubler un préfixe déjà là. */
export function prefixedSubject(prefix: 'RE' | 'TR', subject: string): string {
  return new RegExp(`^\\s*${prefix}\\s*:`, 'i').test(subject) ? subject : `${prefix}: ${subject}`;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * La citation du message d'origine, sous le texte : en texte simple, l'éditeur ne garderait pas sa
 * mise en page. Partagée par le tiroir de rédaction et la réponse rapide, pour qu'une réponse ait
 * la même forme d'où qu'elle parte.
 */
export function quoteHtml(source: MailMessageDto, mode: 'reply' | 'forward'): string {
  const text = escapeHtml(source.bodyIsHtml ? htmlToText(source.body ?? '') : source.body ?? '').replace(/\n/g, '<br>');
  const when = source.sentAt ? new Date(source.sentAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) : '';
  const who = escapeHtml(source.from?.name ? `${source.from.name} <${source.from.address}>` : source.from?.address ?? '');

  const header = mode === 'forward'
    ? `<p>---------- Message transféré ----------<br>De : ${who}<br>Date : ${when}<br>Objet : ${escapeHtml(source.subject ?? '')}<br>À : ${escapeHtml(addressesOf(source.to).join(', '))}</p>`
    : `<p>Le ${when}, ${who} a écrit :</p>`;

  return `<p><br></p>${header}<blockquote>${text}</blockquote>`;
}

/** À qui part une réponse : à l'expéditeur, ou — pour son propre message — à ses destinataires. */
export function replyRecipients(source: MailMessageDto, all: boolean): { to: string[]; cc: string[] } {
  const to = source.direction === 'Sent' ? addressesOf(source.to) : [source.from?.address ?? ''].filter(Boolean);
  if (!all) return { to, cc: [] };
  const own = (source.direction === 'Sent' ? source.from?.address : undefined)?.toLowerCase();
  const cc = [...addressesOf(source.to), ...addressesOf(source.cc)].filter(
    (a, i, list) => a.toLowerCase() !== own && !to.some((t) => t.toLowerCase() === a.toLowerCase()) && list.indexOf(a) === i,
  );
  return { to, cc };
}

// Copies volontaires des libellés de la fiche lead et de la fiche client : leurs libs importent
// celle-ci (le bouton « E-mail »), l'inverse ferait un cycle. Un statut inconnu reste lisible.
const LEAD_STATUS: Record<string, { label: string; severity: Severity }> = {
  New: { label: 'Nouveau', severity: 'info' },
  Open: { label: 'Contacté', severity: 'warning' },
  Qualifying: { label: 'En qualification', severity: 'warning' },
  Qualified: { label: 'Qualifié', severity: 'primary' },
  Converted: { label: 'Converti', severity: 'success' },
  Lost: { label: 'Perdu', severity: 'error' },
  Disqualified: { label: 'Disqualifié', severity: 'error' },
  Archived: { label: 'Archivé', severity: 'neutral' },
  Nurturing: { label: 'Nurturing', severity: 'accent' },
  Recycled: { label: 'Recyclé', severity: 'secondary' },
};

const CLIENT_STATUS: Record<string, { label: string; severity: Severity }> = {
  PendingKyc: { label: 'KYC en attente', severity: 'warning' },
  Active: { label: 'Actif', severity: 'success' },
  Suspended: { label: 'Suspendu', severity: 'error' },
  KycRejected: { label: 'KYC rejeté', severity: 'error' },
  Archived: { label: 'Archivé', severity: 'neutral' },
  Merged: { label: 'Fusionné', severity: 'secondary' },
};

export function contactStatus(entityType: string | null | undefined, status: string | null | undefined): { label: string; severity: Severity } {
  const table = entityType === 'Client' ? CLIENT_STATUS : LEAD_STATUS;
  return table[status ?? ''] ?? { label: status ?? '—', severity: 'neutral' };
}

// Les tailles et polices de l'éditeur (classes de Quill), écrites dans le style de chaque élément.
const EMAIL_FONTS: Record<string, string> = {
  serif: "Georgia, 'Times New Roman', serif",
  monospace: "'Courier New', Courier, monospace",
};
const EMAIL_SIZES: Record<string, string> = { small: '0.75em', large: '1.5em', huge: '2.5em' };
const EMAIL_QUOTE_STYLE = 'margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex';

/**
 * Le HTML de l'éditeur tel qu'une messagerie l'affichera. L'éditeur marque la mise en forme par
 * des classes (`ql-size-large`, `ql-align-center`…) dont la feuille de style n'existe que dans le
 * CRM : chez le destinataire le texte perdait taille, police, alignement et retrait. Elles
 * deviennent des styles en ligne, la seule forme que toutes les messageries lisent.
 */
export function toEmailHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

  doc.body.querySelectorAll<HTMLElement>('[class]').forEach((el) => {
    const styles: string[] = [];
    for (const cls of Array.from(el.classList)) {
      let match: RegExpExecArray | null;
      if ((match = /^ql-font-(.+)$/.exec(cls))) styles.push(`font-family:${EMAIL_FONTS[match[1]] ?? match[1]}`);
      else if ((match = /^ql-size-(.+)$/.exec(cls)) && EMAIL_SIZES[match[1]]) styles.push(`font-size:${EMAIL_SIZES[match[1]]}`);
      else if ((match = /^ql-align-(.+)$/.exec(cls))) styles.push(`text-align:${match[1]}`);
      else if ((match = /^ql-indent-(\d+)$/.exec(cls))) styles.push(`margin-left:${Number(match[1]) * 3}em`);
      else continue;
      el.classList.remove(cls);
    }
    if (styles.length > 0) el.setAttribute('style', [el.getAttribute('style'), ...styles].filter(Boolean).join(';'));
    if (el.classList.length === 0) el.removeAttribute('class');
  });

  doc.body.querySelectorAll('blockquote:not([style])').forEach((b) => b.setAttribute('style', EMAIL_QUOTE_STYLE));
  return doc.body.innerHTML;
}

/** La signature sous le texte : une ligne vide pour écrire au-dessus, puis la signature. */
export function signatureBlock(signature: string | null | undefined): string {
  return signature ? `<p><br></p><p><br></p>${signature}` : '';
}

/** Les envois programmés proposés sous « Envoyer » : demain matin, demain après-midi, lundi matin. */
export function scheduleChoices(now = new Date()): { label: string; at: Date }[] {
  const at = (days: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  const choices = [
    { label: 'Demain matin', at: at(1, 8) },
    { label: 'Demain après-midi', at: at(1, 14) },
    { label: 'Lundi matin', at: at(toMonday, 8) },
  ];
  // Lundi matin et demain matin sont le même instant le dimanche : une seule ligne.
  return choices.filter((c, i) => choices.findIndex((o) => o.at.getTime() === c.at.getTime()) === i);
}

/** « ven. 30 oct., 08:00 » */
export function scheduleLabel(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return `${d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}
