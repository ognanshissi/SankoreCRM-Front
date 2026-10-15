import { Severity } from '@talisoft/ui/tag';
import { IngestionDto } from '@sankore/crm-api';

/**
 * `IngestionDto.leadId` est un `uuid` non nullable au contrat : une ingestion
 * sans lead renvoie le GUID nul, qui est *truthy*. Sans ce garde-fou, le lien
 * « Voir le lead » menait vers un lead inexistant.
 */
export const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

/** Cadence de l'actualisation automatique des réceptions d'une source script. */
export const INGESTION_AUTO_REFRESH_MS = 15_000;

export function ingestionHasLead(ing: IngestionDto | null | undefined): boolean {
  return !!ing?.leadId && ing.leadId !== EMPTY_GUID;
}

export function ingestionStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'Accepted': return 'Accepté';
    case 'Rejected': return 'Rejeté';
    case 'Duplicate': return 'Doublon';
    case 'Failed': return 'Échoué';
    default: return status ?? '—';
  }
}

export function ingestionStatusSeverity(status: string | null | undefined): Severity {
  switch (status) {
    case 'Accepted': return 'success';
    case 'Rejected': return 'error';
    case 'Duplicate': return 'warning';
    case 'Failed': return 'error';
    default: return 'neutral';
  }
}

export function isReplayableIngestion(ing: IngestionDto | null | undefined): boolean {
  return ing?.status === 'Rejected' || ing?.status === 'Failed';
}

/**
 * Métadonnées ajoutées par `WebIngestEndpoint` au payload d'une soumission
 * script : préfixées par `_`, elles ne viennent pas du formulaire et ne doivent
 * pas se mélanger aux champs saisis par le prospect.
 */
const CONTEXT_LABELS: Record<string, string> = {
  _page: 'Page',
  _referrer: 'Provenance',
  _origin: 'Origine',
  _ip: 'Adresse IP',
  _userAgent: 'Navigateur',
  _consentVersion: 'Version du consentement',
};

export interface PayloadEntry {
  key: string;
  label: string;
  value: string;
}

export interface ParsedPayload {
  fields: PayloadEntry[];
  context: PayloadEntry[];
  /** JSON indenté, ou texte brut s'il n'était pas du JSON. */
  pretty: string;
}

export function parseIngestionPayload(raw: string | null | undefined): ParsedPayload {
  const text = raw ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text || '{}');
  } catch {
    return { fields: [], context: [], pretty: text };
  }

  const fields: PayloadEntry[] = [];
  const context: PayloadEntry[] = [];
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const display = formatValue(value);
      if (key.startsWith('_')) {
        if (display) context.push({ key, label: CONTEXT_LABELS[key] ?? key.slice(1), value: display });
      } else {
        fields.push({ key, label: key, value: display });
      }
    }
  }
  return { fields, context, pretty: JSON.stringify(parsed, null, 2) };
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Ce qu'il manquait à une réception pour devenir un lead, d'après son motif. */
export interface MissingLeadFields {
  phone: boolean;
  name: boolean;
}

/**
 * Le pipeline stocke `REQUIRED_FIELDS_MISSING:phoneNumber,fullName|firstName|lastName`.
 * Une `MAPPING_ERROR` ne dit pas quel champ manque : on propose alors les deux, et c'est
 * le serveur qui tranche à la soumission. Tout autre motif ne se corrige pas par une
 * correspondance de champs (`null`).
 */
export function missingLeadFields(ing: IngestionDto | null | undefined): MissingLeadFields | null {
  if (!isReplayableIngestion(ing)) return null;
  const reason = ing?.rejectionReason ?? '';
  if (reason.startsWith('REQUIRED_FIELDS_MISSING:')) {
    const tokens = reason.slice('REQUIRED_FIELDS_MISSING:'.length).split(',');
    return {
      phone: tokens.includes('phoneNumber'),
      name: tokens.some((t) => t.split('|').includes('fullName')),
    };
  }
  if (reason.startsWith('MAPPING_ERROR:')) return { phone: true, name: true };
  return null;
}

/** Libellé lisible d'un motif technique du pipeline. */
export function ingestionReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason.startsWith('REQUIRED_FIELDS_MISSING:')) {
    const tokens = reason.slice('REQUIRED_FIELDS_MISSING:'.length).split(',');
    const parts = tokens.map((t) => (t === 'phoneNumber' ? 'le téléphone' : 'le nom'));
    return `Champs obligatoires absents : ${parts.join(' et ')}.`;
  }
  if (reason === 'INVALID_PAYLOAD') return 'Le contenu reçu n\'est pas un objet JSON lisible.';
  return reason;
}

/**
 * Devine la clé du payload qui porte chaque champ, d'après les noms usuels d'un formulaire
 * français ou anglais. Une simple suggestion : l'opérateur la voit et la corrige.
 */
export function guessFieldLinks(keys: string[]): {
  phoneNumber: string; fullName: string; firstName: string; lastName: string; email: string;
} {
  const find = (re: RegExp) => keys.find((k) => re.test(k)) ?? '';
  const firstName = find(/pr[eé]nom|first_?name|given/i);
  const lastName = find(/^(nom|last_?name|surname|nom_?de_?famille|nom_?famille)$/i);
  const fullName = find(/full_?name|nom_?complet|^name$|nom_?prenom/i);
  return {
    phoneNumber: find(/t[eé]l|phone|mobile|portable|gsm|whatsapp/i),
    // « nom » seul désigne le nom de famille quand le formulaire a aussi un prénom.
    fullName: fullName || (firstName ? '' : lastName),
    firstName,
    lastName: firstName ? lastName : '',
    email: find(/e-?mail|courriel/i),
  };
}

/**
 * Champs du lead qu'une correspondance manuelle peut renseigner : exactement
 * `InboundLeadFactory.CapturedFields` côté serveur, qui refuse tout autre champ. Le genre,
 * la date de naissance ou le montant souhaité ne sont pas repris par ce chemin et n'y
 * figurent donc pas, plutôt que d'être acceptés puis perdus.
 */
export const LEAD_LINK_TARGETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'phoneNumber', label: 'Téléphone' },
  { value: 'fullName', label: 'Nom complet' },
  { value: 'firstName', label: 'Prénom' },
  { value: 'lastName', label: 'Nom' },
  { value: 'email', label: 'E-mail' },
  { value: 'interestedProduct', label: 'Produit d\'intérêt' },
  { value: 'preferredLanguage', label: 'Langue préférée' },
  { value: 'nationalId', label: 'N° de pièce d\'identité' },
  { value: 'customerReference', label: 'Référence client' },
  { value: 'comment', label: 'Commentaire' },
  { value: 'campaign', label: 'Campagne' },
  { value: 'externalReference', label: 'Référence externe' },
  { value: 'externalId', label: 'ID externe' },
  { value: 'utmSource', label: 'UTM source' },
  { value: 'utmMedium', label: 'UTM medium' },
  { value: 'utmCampaign', label: 'UTM campagne' },
  { value: 'utmContent', label: 'UTM contenu' },
  { value: 'utmTerm', label: 'UTM terme' },
  { value: 'landingPage', label: 'Page d\'arrivée' },
  { value: 'referrer', label: 'Provenance' },
  { value: 'latitude', label: 'Latitude' },
  { value: 'longitude', label: 'Longitude' },
];

export const NAME_TARGETS = ['fullName', 'firstName', 'lastName'];
