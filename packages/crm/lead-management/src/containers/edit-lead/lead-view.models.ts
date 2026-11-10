import { ActivityDtoTypeEnum, LeadDto, SetIntentLevelRequestIntentLevelEnum } from '@sankore/crm-api';
import { Severity } from '@talisoft/ui/tag';
import { currencyUnit } from '@sankore/crm/common';

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

/**
 * Le parcours du lead en cinq étapes (maquette de la fiche, 2026-11-02) : Nouveau, Contacté,
 * Intéressé, Qualifié, puis l'issue. L'étape de pipeline (`PipelineStage` côté serveur) place le
 * lead ; le statut l'emporte quand il est allé plus loin. La frise à six étapes qu'elle remplace
 * distinguait « contact tenté » et « contact établi », que l'agent lit comme un seul moment.
 */
export const LEAD_STATUS_STEPS = ['Nouveau', 'Contacté', 'Intéressé', 'Qualifié', 'Converti / Perdu'] as const;

const STEP_OF_STAGE: Record<string, number> = {
  New: 0,
  ContactAttempted: 1,
  ContactEstablished: 1,
  NeedIdentified: 2,
  Qualified: 3,
  ProductProposed: 3,
  ApplicationStarted: 3,
  DocumentCollection: 3,
  ApplicationCompleted: 3,
  ApprovalPending: 3,
  Converted: 4,
  Lost: 4,
};

/** Rang de l'étape courante dans `LEAD_STATUS_STEPS`. */
export function statusStepIndex(lead: LeadDto | null | undefined): number {
  const status = lead?.status;
  if (status === 'Converted' || status === 'Lost' || status === 'Disqualified') return 4;
  const byStage = STEP_OF_STAGE[lead?.pipelineStage ?? ''] ?? 0;
  if (status === 'Qualified') return Math.max(byStage, 3);
  if (status === 'Open' || status === 'Qualifying') return Math.max(byStage, 1);
  return byStage;
}

/** La dernière étape dit l'issue quand elle est connue : « Converti », « Perdu », « Disqualifié ». */
export function statusStepLabel(lead: LeadDto | null | undefined, index: number): string {
  if (index !== LEAD_STATUS_STEPS.length - 1) return LEAD_STATUS_STEPS[index];
  const status = lead?.status;
  if (status === 'Converted' || status === 'Disqualified') return leadStatusMeta(status).label;
  if (status === 'Lost' || lead?.pipelineStage === 'Lost') return 'Perdu';
  return LEAD_STATUS_STEPS[index];
}

/** Les statuts qui sortent le lead du parcours sans issue : la frise s'éteint, le statut s'affiche à côté. */
const OFF_JOURNEY_STATUSES = ['Archived', 'Nurturing', 'Recycled'];

/** « Nurturing », « Recyclé », « Archivé » quand le lead a quitté le parcours ; null sinon. */
export function journeyOffTrack(lead: LeadDto | null | undefined): { label: string; severity: Severity } | null {
  return OFF_JOURNEY_STATUSES.includes(lead?.status ?? '') ? leadStatusMeta(lead?.status) : null;
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

/** Icône, libellé et teinte d'un type d'activité — l'onglet Activités et l'aperçu du lead. */
export function activityTypeMeta(type: ActivityDtoTypeEnum | undefined): { icon: string; label: string; severity: Severity } {
  switch (type) {
    case ActivityDtoTypeEnum.Call:     return { icon: 'feather:phone',        label: 'Appel',     severity: 'info' };
    case ActivityDtoTypeEnum.Meeting:  return { icon: 'feather:users',        label: 'Réunion',   severity: 'warning' };
    case ActivityDtoTypeEnum.Email:    return { icon: 'feather:mail',         label: 'E-mail',    severity: 'info' };
    case ActivityDtoTypeEnum.Visit:    return { icon: 'feather:map-pin',      label: 'Visite',    severity: 'success' };
    case ActivityDtoTypeEnum.Note:     return { icon: 'feather:file-text',    label: 'Note',      severity: 'neutral' };
    case ActivityDtoTypeEnum.Sms:      return { icon: 'feather:message-square', label: 'SMS',     severity: 'info' };
    case ActivityDtoTypeEnum.WhatsApp: return { icon: 'feather:message-circle', label: 'WhatsApp', severity: 'success' };
    case ActivityDtoTypeEnum.Task:     return { icon: 'feather:check-square', label: 'Tâche',     severity: 'warning' };
    default:                           return { icon: 'feather:circle',       label: 'Autre',     severity: 'neutral' };
  }
}

const AMOUNT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/**
 * « 2 800 000 FCFA ». Par `Intl` et non par le pipe `number` : l'application n'enregistre pas la
 * locale française d'Angular, et `number: …: 'fr'` lèverait « Missing locale data ».
 */
export function formatAmount(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return '';
  // Sans devise (un total, un montant d'avant les devises) : la monnaie de l'institution.
  return `${AMOUNT.format(amount)} ${currencyUnit(currency)}`;
}

/** « 17 avril 2027 », ou « 14 oct. » en version courte — en français, pour la même raison. */
export function formatDay(iso: string | null | undefined, short = false): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', short ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'long', year: 'numeric' });
}

// ——— Identité : l'adresse, la vérification du nom, la provenance ———

export type AddressPartKey = 'countryCode' | 'city' | 'neighbourhood' | 'landmark';

export interface AddressPart {
  key: AddressPartKey;
  label: string;
  points: number;
}

/**
 * Ce que chaque élément de l'adresse rapporte au score. Recopie de
 * `LeadScoreCalculator.AddressScore` côté serveur, que `AddressScoreTests` épingle : les deux se
 * changent ensemble, sinon l'écran promet des points que le score ne donne pas.
 */
export const ADDRESS_POINTS: ReadonlyArray<AddressPart> = [
  { key: 'countryCode', label: 'Pays', points: 2 },
  { key: 'city', label: 'Ville', points: 8 },
  { key: 'neighbourhood', label: 'Quartier', points: 6 },
  { key: 'landmark', label: 'Repère', points: 2 },
];

type AddressValues = Partial<Record<AddressPartKey, string | null | undefined>>;

/** Les éléments de l'adresse encore vides — le badge du menu Identité et les pastilles de l'onglet. */
export function missingAddressParts(address: AddressValues | null | undefined): AddressPart[] {
  return ADDRESS_POINTS.filter((part) => !(address?.[part.key] ?? '').trim());
}

/** Les canaux où le prospect saisit lui-même : ce qu'ils portent est déclaratif. */
const SELF_SERVICE = new Set(['Ussd', 'Sms', 'Web', 'WhatsApp']);

export function isSelfServiceCapture(lead: LeadDto | null | undefined): boolean {
  return SELF_SERVICE.has(lead?.channel ?? '') || SELF_SERVICE.has(lead?.source ?? '');
}

/**
 * Un nom à faire vérifier : saisi par USSD ou SMS, tout en majuscules (donc sans accents), et que
 * personne n'a encore confirmé. Un nom en minuscules a déjà été retouché par quelqu'un.
 */
export function nameNeedsCheck(lead: LeadDto | null | undefined): boolean {
  if (!lead || lead.nameVerifiedAt) return false;
  const typed = ['Ussd', 'Sms'];
  if (!typed.includes(lead.channel ?? '') && !typed.includes(lead.source ?? '')) return false;
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.fullName || '';
  return /\p{L}/u.test(name) && !/\p{Ll}/u.test(name);
}

/** Les indicatifs des pays que la liste propose, du plus long au plus court pour le préfixe. */
const DIAL_CODES: ReadonlyArray<readonly [string, string]> = [
  ['225', 'CI'], ['221', 'SN'], ['226', 'BF'], ['223', 'ML'], ['229', 'BJ'], ['228', 'TG'],
  ['227', 'NE'], ['245', 'GW'], ['233', 'GH'], ['224', 'GN'], ['231', 'LR'], ['234', 'NG'],
  ['237', 'CM'], ['212', 'MA'], ['33', 'FR'], ['1', 'US'],
];

/** « +225 07… » → `{ dial: '225', country: 'CI' }` ; null sans indicatif international reconnu. */
export function countryFromPhone(phone: string | null | undefined): { dial: string; country: string } | null {
  const raw = (phone ?? '').trim();
  const digits = raw.startsWith('+') ? raw.slice(1).replace(/\D/g, '')
    : raw.startsWith('00') ? raw.slice(2).replace(/\D/g, '') : '';
  if (!digits) return null;
  const match = DIAL_CODES.find(([dial]) => digits.startsWith(dial));
  return match ? { dial: match[0], country: match[1] } : null;
}

// ——— Foyer : ce qu'il gagne et ce qu'il doit déjà ———

/**
 * « 450 000 », « 450000 », « 450 000 FCFA » → 450000 ; vide → null ; illisible ou négatif → NaN,
 * que la validation du formulaire refuse.
 */
export function parseAmount(text: string | null | undefined): number | null {
  const cleaned = (text ?? '').replace(/fcfa|xof/gi, '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!cleaned) return null;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

/** « 450 000 » — l'affichage d'un montant dans un champ, sans unité. */
export function amountText(value: number | null | undefined): string {
  return value == null ? '' : AMOUNT.format(value);
}

export interface HouseholdBudget {
  /** Ce qui reste chaque mois une fois le logement et les crédits payés. */
  disposable: number;
  /** Part des revenus déjà engagée, en pourcentage arrondi. */
  commitmentPercent: number;
}

/** Null tant que les revenus ne sont pas connus : sans eux, ni reste ni part ne veulent rien dire. */
export function householdBudget(
  income: number | null,
  housing: number | null,
  otherDebts: number | null,
): HouseholdBudget | null {
  if (income == null || Number.isNaN(income) || income <= 0) return null;
  const charges = (housing && !Number.isNaN(housing) ? housing : 0) + (otherDebts && !Number.isNaN(otherDebts) ? otherDebts : 0);
  return { disposable: income - charges, commitmentPercent: Math.round((charges / income) * 100) };
}

/**
 * Secteurs d'activité d'un prospect entreprise — la liste neutre du socle, la même que celle du
 * serveur (`LeadActivitySectors`) et des options du formulaire des leads (grands comptes, lot 1).
 */
export const ACTIVITY_SECTOR_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'WholesaleTrade', label: 'Commerce de gros et distribution' },
  { value: 'RetailTrade', label: 'Commerce de détail' },
  { value: 'Construction', label: 'BTP et construction' },
  { value: 'Manufacturing', label: 'Industrie et transformation' },
  { value: 'Agriculture', label: 'Agriculture, élevage et pêche' },
  { value: 'EnergyMining', label: 'Énergie, mines et pétrole' },
  { value: 'TransportLogistics', label: 'Transport et logistique' },
  { value: 'HospitalityTourism', label: 'Hôtellerie, restauration et tourisme' },
  { value: 'Health', label: 'Santé et pharmacie' },
  { value: 'Education', label: 'Éducation et formation' },
  { value: 'PublicSector', label: 'Administration et collectivités' },
  { value: 'NonProfit', label: 'ONG, associations et organisations internationales' },
  { value: 'Technology', label: 'Informatique et télécommunications' },
  { value: 'BusinessServices', label: 'Services aux entreprises' },
  { value: 'RealEstate', label: 'Immobilier' },
  { value: 'FinancialServices', label: 'Banques, assurances et services financiers' },
  { value: 'MediaEvents', label: 'Médias, communication et événementiel' },
  { value: 'Other', label: 'Autre' },
];

/** Tranches d'effectif, aux noms de `LeadCompanySize`. */
export const COMPANY_SIZE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'Micro', label: '1 à 9 personnes' },
  { value: 'Small', label: '10 à 49 personnes' },
  { value: 'Medium', label: '50 à 249 personnes' },
  { value: 'Large', label: '250 personnes et plus' },
];

export function activitySectorLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return ACTIVITY_SECTOR_OPTIONS.find((o) => o.value === code)?.label ?? code;
}

export function companySizeLabel(size: string | null | undefined): string | null {
  if (!size) return null;
  return COMPANY_SIZE_OPTIONS.find((o) => o.value === size)?.label ?? size;
}

/**
 * Le palier d'un lead entreprise face aux seuils « grands comptes » de l'institution (lot 4), en
 * pastille ; null pour un particulier ou une entreprise sous les seuils.
 */
export function potentialBadge(tier: string | null | undefined): { label: string; tone: string } | null {
  switch (tier) {
    case 'KeyAccount': return { label: 'Grand compte', tone: 'bg-violet-50 text-violet-700' };
    case 'GoodCustomer': return { label: 'Bon client', tone: 'bg-slate-100 text-slate-700' };
    default: return null;
  }
}

/** L'entreprise d'un lead entreprise, ce qui se lit d'abord en B2B ; null pour un particulier. */
export function companyOf(lead: LeadDto | null | undefined): string | null {
  return lead?.prospectType === 'Corporate' ? lead.companyName?.trim() || null : null;
}
