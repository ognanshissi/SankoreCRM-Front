import { UtmParams } from './types';

const UTM_KEY = 'sankore.utm';
const PING_KEY = 'sankore.ping.';
const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

/**
 * `sessionStorage` peut lever (navigation privee, cookies bloques, iframe
 * cloisonnee). Aucun acces n'est fait sans garde : le SDK ne doit jamais
 * provoquer d'exception non interceptee sur le site du client (FE-13 AC5).
 */
function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : on continue sans persistance */
  }
}

/**
 * FE-13 AC4 — les UTM retenus sont ceux de la PREMIERE page de la visite.
 * Une navigation interne avant soumission ne doit pas les effacer.
 */
export function captureUtm(): void {
  if (read(UTM_KEY) !== null) return;

  const params = new URLSearchParams(location.search);
  const utm: UtmParams = {};
  for (const field of UTM_FIELDS) {
    const value = params.get(field);
    if (value) utm[field] = value;
  }
  // On ecrit meme un objet vide : c'est le marqueur « premiere page vue ».
  write(UTM_KEY, JSON.stringify(utm));
}

export function storedUtm(): UtmParams {
  const raw = read(UTM_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as UtmParams;
  } catch {
    return {};
  }
}

/** FE-13 AC1 — un seul ping par session et par source. */
export function shouldPing(publicKey: string): boolean {
  const key = PING_KEY + publicKey;
  if (read(key)) return false;
  write(key, '1');
  return true;
}
