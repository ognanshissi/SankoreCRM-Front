import { MailPartyDto } from '@sankore/crm-api';

/** Les limites du serveur (`MailSendLimits`), vérifiées avant l'envoi pour le dire tout de suite. */
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const BLOCKED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.msi', '.js', '.jse', '.vbs', '.vbe', '.wsf', '.ps1', '.jar', '.lnk'];

/** Les codes d'envoi et de lecture du serveur, en français ; un code inconnu reste une phrase générique. */
export const MAIL_SEND_ERRORS: Record<string, string> = {
  MAIL_RECIPIENTS_REQUIRED: 'Indiquez au moins un destinataire.',
  MAIL_RECIPIENT_INVALID: 'Une adresse de destinataire n’est pas valide.',
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

/** Aujourd'hui : l'heure ; cette année : le jour et le mois ; sinon la date complète. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return date.toLocaleDateString('fr-FR');
}
