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
