import { LeadDto, SetIntentLevelRequestIntentLevelEnum } from '@sankore/crm-api';
import { Severity } from '@talisoft/ui/tag';

/**
 * Libellés et petits calculs d'affichage partagés par la coque de la fiche lead et son onglet
 * Informations — un seul endroit pour dire « Contacté », « Centre d'appels » ou « 49 ans ».
 */

export function leadStatusMeta(status: string | null | undefined): { label: string; severity: Severity } {
  switch (status) {
    case 'New':          return { label: 'Nouveau', severity: 'info' };
    case 'Open':         return { label: 'Contacté', severity: 'warning' };
    case 'Qualifying':   return { label: 'En qualification', severity: 'warning' };
    case 'Qualified':    return { label: 'Qualifié', severity: 'primary' };
    case 'Converted':    return { label: 'Converti', severity: 'success' };
    case 'Lost':         return { label: 'Perdu', severity: 'error' };
    case 'Disqualified': return { label: 'Disqualifié', severity: 'error' };
    case 'Archived':     return { label: 'Archivé', severity: 'neutral' };
    case 'Nurturing':    return { label: 'Nurturing', severity: 'accent' };
    case 'Recycled':     return { label: 'Recyclé', severity: 'secondary' };
    default:             return { label: status ?? '—', severity: 'neutral' };
  }
}

export interface IntentOption {
  value: SetIntentLevelRequestIntentLevelEnum;
  label: string;
  dot: string;
}

/**
 * L'intérêt ressenti, avec les valeurs que l'API renvoie et accepte (`Unknown`, `Cold`, `Warm`,
 * `Hot`). L'ancienne coque comparait `intentLevel` à « 0 »…« 3 » : aucune valeur ne correspondait
 * jamais, et la température s'affichait « Inconnu » sur tous les leads.
 */
export const INTENT_OPTIONS: ReadonlyArray<IntentOption> = [
  { value: SetIntentLevelRequestIntentLevelEnum.Unknown, label: 'Pas encore évalué', dot: 'bg-slate-300' },
  { value: SetIntentLevelRequestIntentLevelEnum.Cold, label: 'Froid', dot: 'bg-blue-500' },
  { value: SetIntentLevelRequestIntentLevelEnum.Warm, label: 'Tiède', dot: 'bg-amber-500' },
  { value: SetIntentLevelRequestIntentLevelEnum.Hot, label: 'Chaud', dot: 'bg-red-600' },
];

export function intentOption(level: string | null | undefined): IntentOption {
  return INTENT_OPTIONS.find((o) => o.value === level) ?? INTENT_OPTIONS[0];
}

/** « Centre d'appels » — par où le lead est arrivé, le canal d'abord, la source à défaut. */
export function originLabel(lead: LeadDto | null | undefined): string {
  const byChannel: Record<string, string> = {
    Web: 'Site web',
    MobileAgent: 'Agent mobile',
    Agency: 'Agence',
    CallCenter: "Centre d'appels",
    Sms: 'SMS',
    Ussd: 'USSD',
    WhatsApp: 'WhatsApp',
    Referral: 'Recommandation',
    Partner: 'Partenaire',
    Import: 'Import',
    MarketingCampaign: 'Campagne marketing',
  };
  const bySource: Record<string, string> = {
    Web: 'Site web',
    MobileAgent: 'Agent mobile',
    Agency: 'Agence',
    CallCenter: "Centre d'appels",
    Sms: 'SMS',
    Ussd: 'USSD',
    WhatsApp: 'WhatsApp',
    Referral: 'Recommandation',
    Partner: 'Partenaire',
    FileImport: 'Import de fichier',
    Campaign: 'Campagne',
  };
  if (lead?.leadSourceLabel) return lead.leadSourceLabel;
  return (lead?.channel && byChannel[lead.channel]) || (lead?.source && bySource[lead.source]) || '—';
}

/** « par le centre d'appels », « par le site web » — la phrase sous la date d'arrivée. */
export function originPhrase(lead: LeadDto | null | undefined): string {
  const label = originLabel(lead);
  if (label === '—') return '';
  const lower = label.charAt(0).toLowerCase() + label.slice(1);
  return /^[aeiouéè]/i.test(label) ? `par l'${lower}` : `par le ${lower}`;
}

export function displayName(lead: LeadDto | null | undefined): string {
  if (!lead) return 'Lead';
  if (lead.fullName) return lead.fullName;
  const parts = [lead.firstName, lead.lastName].filter(Boolean);
  return parts.length ? parts.join(' ') : lead.phoneNumber ?? lead.email ?? 'Lead';
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[\p{L}]/u.test(w));
  return (words.length >= 2 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

/** L'âge en années révolues à aujourd'hui, ou null sans date de naissance lisible. */
export function ageOf(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const birth = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

export function prospectTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case 'Individual': return 'Particulier';
    case 'Corporate':  return 'Entreprise';
    default:           return type ?? '—';
  }
}

/** Les codes de la jauge de complétude qui désignent un consentement à recueillir. */
export function isConsentGap(code: string | null | undefined): boolean {
  return (code ?? '').includes('CONSENT');
}

const AMOUNT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/**
 * « 2 800 000 FCFA ». Par `Intl` et non par le pipe `number` : l'application n'enregistre pas la
 * locale française d'Angular, et `number: …: 'fr'` lèverait « Missing locale data ».
 */
export function formatAmount(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return '';
  const unit = !currency || currency === 'XOF' ? 'FCFA' : currency;
  return `${AMOUNT.format(amount)} ${unit}`;
}

/** « 17 avril 2027 », ou « 14 oct. » en version courte — en français, pour la même raison. */
export function formatDay(iso: string | null | undefined, short = false): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', short ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'long', year: 'numeric' });
}
