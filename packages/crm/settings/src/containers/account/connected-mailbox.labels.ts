import { HttpErrorResponse } from '@angular/common/http';

/**
 * Les codes de la messagerie connectée (lot 1-2 serveur) en français. Un code inconnu devient une
 * phrase générique, jamais l'identifiant lui-même sous les yeux de l'agent.
 */
export const MAILBOX_ERRORS: Record<string, string> = {
  MAIL_IMAP_UNREACHABLE: 'Le serveur de réception (IMAP) ne répond pas : vérifiez son nom et son port.',
  MAIL_IMAP_TLS_FAILED: 'La connexion sécurisée au serveur IMAP a échoué : vérifiez la sécurité choisie (SSL ou STARTTLS).',
  MAIL_IMAP_AUTH_FAILED: 'Le serveur IMAP refuse l’identifiant ou le mot de passe. Gmail, Yahoo et d’autres exigent un mot de passe d’application.',
  MAIL_SMTP_UNREACHABLE: 'Le serveur d’envoi (SMTP) ne répond pas : vérifiez son nom et son port.',
  MAIL_SMTP_TLS_FAILED: 'La connexion sécurisée au serveur SMTP a échoué : vérifiez la sécurité choisie (SSL ou STARTTLS).',
  MAIL_SMTP_AUTH_FAILED: 'Le serveur SMTP refuse l’identifiant ou le mot de passe.',
  MAIL_IMAP_HOST_INVALID: 'Le nom du serveur IMAP n’est pas valide (sans « https:// » ni port).',
  MAIL_SMTP_HOST_INVALID: 'Le nom du serveur SMTP n’est pas valide (sans « https:// » ni port).',
  MAIL_IMAP_PORT_NOT_ALLOWED: 'Port IMAP non autorisé : 993 ou 143.',
  MAIL_SMTP_PORT_NOT_ALLOWED: 'Port SMTP non autorisé : 465, 587, 25 ou 2525.',
  MAIL_SECURITY_INVALID: 'Choisissez SSL ou STARTTLS.',
  MAIL_USERNAME_REQUIRED: 'L’identifiant est obligatoire.',
  MAIL_EMAIL_INVALID: 'L’adresse e-mail n’est pas valide.',
  MAIL_PASSWORD_REQUIRED: 'Le mot de passe est obligatoire.',
  CONNECTED_MAILBOX_ALREADY_CONNECTED: 'Cette boîte est déjà connectée.',
  CONNECTED_MAILBOX_NOT_IMAP: 'Ce compte n’est pas une boîte IMAP.',
  CONNECTED_MAILBOX_IMAP_REMOVE_INSTEAD: 'Une boîte IMAP se retire, elle ne se désactive pas.',
  CONNECTED_MAILBOX_DISABLED: 'La messagerie de ce compte n’est pas activée.',
  CONNECTED_ACCOUNT_NEEDS_RECONNECT: 'Le fournisseur a refusé l’accès : reconnectez le compte.',
  CONNECTED_ACCOUNT_NOT_FOUND: 'Ce compte n’existe plus.',
};

export function mailboxErrorMessage(err: HttpErrorResponse, fallback = 'Une erreur est survenue. Réessayez.'): string {
  if (err.status === 429) return 'Trop d’essais rapprochés : patientez une minute avant de recommencer.';
  const code = typeof err.error?.detail === 'string' ? err.error.detail : null;
  return (code && MAILBOX_ERRORS[code]) || fallback;
}

/** Ce que dit la dernière lecture en échec d'une boîte, en quelques mots. */
export function mailSyncErrorLabel(code: string | null | undefined): string {
  if (!code) return '';
  if (code.endsWith('AUTH_FAILED')) return 'mot de passe refusé';
  if (code.endsWith('_http_403')) return 'accès refusé par le fournisseur';
  if (code.endsWith('UNREACHABLE') || code === 'provider_unreachable') return 'serveur injoignable';
  return 'lecture en échec';
}

/** Réglages connus, pour ne pas faire chercher l'agent. Outlook.com n'y est pas : Microsoft n'y accepte plus de mot de passe, il passe par le bouton Microsoft. */
export interface MailPreset {
  value: string;
  label: string;
  domains: string[];
  imapHost: string;
  imapPort: number;
  imapSecurity: 'Ssl' | 'StartTls';
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: 'Ssl' | 'StartTls';
  hint?: string;
}

export const MAIL_PRESETS: MailPreset[] = [
  {
    value: 'gmail', label: 'Gmail (mot de passe d’application)', domains: ['gmail.com', 'googlemail.com'],
    imapHost: 'imap.gmail.com', imapPort: 993, imapSecurity: 'Ssl', smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecurity: 'Ssl',
    hint: 'Gmail refuse votre mot de passe habituel : créez un mot de passe d’application dans votre compte Google (Sécurité › Validation en deux étapes). Le bouton « Google » plus haut évite cette étape.',
  },
  {
    value: 'yahoo', label: 'Yahoo Mail', domains: ['yahoo.com', 'yahoo.fr'],
    imapHost: 'imap.mail.yahoo.com', imapPort: 993, imapSecurity: 'Ssl', smtpHost: 'smtp.mail.yahoo.com', smtpPort: 465, smtpSecurity: 'Ssl',
    hint: 'Yahoo exige un mot de passe d’application (Sécurité du compte › Générer un mot de passe d’application).',
  },
  {
    value: 'ovh', label: 'OVHcloud (MX Plan)', domains: [],
    imapHost: 'ssl0.ovh.net', imapPort: 993, imapSecurity: 'Ssl', smtpHost: 'ssl0.ovh.net', smtpPort: 465, smtpSecurity: 'Ssl',
  },
  {
    value: 'zoho', label: 'Zoho Mail', domains: ['zoho.com', 'zohomail.com'],
    imapHost: 'imap.zoho.com', imapPort: 993, imapSecurity: 'Ssl', smtpHost: 'smtp.zoho.com', smtpPort: 465, smtpSecurity: 'Ssl',
  },
];
