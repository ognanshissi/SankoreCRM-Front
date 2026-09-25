import { IngestPayload, SdkConfig, SendOutcome } from './types';

/**
 * FE-13 AC5 — une erreur reseau ou 5xx donne lieu a UN seul reessai, puis
 * abandon silencieux. Aucune exception ne remonte a la page du client.
 */
const RETRY_DELAY_MS = 800;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ingestUrl(config: SdkConfig): string {
  return `${config.endpoint}/api/ingest/web/${encodeURIComponent(config.publicKey)}`;
}

async function postOnce(url: string, body: string): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      // `keepalive` permet a la requete de survivre a la navigation declenchee
      // par la soumission d'origine (FE-13 AC3).
      keepalive: true,
      credentials: 'omit',
      mode: 'cors',
    });
  } catch {
    return null;
  }
}

export async function sendLead(
  config: SdkConfig,
  payload: IngestPayload,
): Promise<SendOutcome> {
  const url = ingestUrl(config);
  const body = JSON.stringify(payload);

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await postOnce(url, body);

    if (!response) {
      // Echec reseau : un seul reessai.
      if (attempt === 0) {
        await delay(RETRY_DELAY_MS);
        continue;
      }
      return { kind: 'failed' };
    }

    if (response.ok) return { kind: 'accepted' };

    // FE-14 AC3 — 422 : champ invalide, le message du serveur est affiche.
    if (response.status === 422) {
      return { kind: 'invalid', message: await readMessage(response) };
    }

    // 4xx autre que 422 : la requete ne passera pas davantage au second essai.
    if (response.status < 500) return { kind: 'failed' };

    if (attempt === 0) {
      await delay(RETRY_DELAY_MS);
      continue;
    }
    return { kind: 'failed' };
  }

  return { kind: 'failed' };
}

const DEFAULT_INVALID_MESSAGE = 'Certaines informations sont invalides. Vérifiez votre saisie.';

async function readMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string; title?: string };
    return body?.detail || body?.title || DEFAULT_INVALID_MESSAGE;
  } catch {
    return DEFAULT_INVALID_MESSAGE;
  }
}

/** FE-13 AC1 — signale que le script est installe, une fois par session. */
export function sendPing(config: SdkConfig): void {
  const url = `${config.endpoint}/api/ingest/web/${encodeURIComponent(config.publicKey)}/ping`;
  try {
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: location.href, referrer: document.referrer }),
      keepalive: true,
      credentials: 'omit',
      mode: 'cors',
    }).catch(() => undefined);
  } catch {
    /* le ping est indicatif : jamais bloquant */
  }
}
