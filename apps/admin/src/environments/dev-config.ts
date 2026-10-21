import { EnvironmentConfig } from '@sankore/crm/common';
import { environment } from './environment';

/** Ce qu'un `config.json` de développement peut changer : les URL et la clé de l'API locale. */
const OVERRIDABLE_KEYS = ['apiUrl', 'apiKey'] as const;

/**
 * La configuration de l'admin, avec en DÉVELOPPEMENT seulement les surcharges de
 * `apps/admin/dev/config.json` — pour pointer un `nx serve admin` vers une autre API sans
 * toucher `environment.ts`.
 *
 * En production, rien n'est lu : l'URL de l'API est compilée depuis `environment.prod.ts`
 * (choix du propriétaire), le fichier n'est pas copié dans le build et aucun `fetch` n'est fait.
 * C'est `environment.production` qui tranche, et non la présence du fichier : une image de
 * production qui irait chercher un `config.json` servirait à n'importe qui une porte d'entrée
 * pour réorienter l'admin.
 */
export async function loadConfig(): Promise<EnvironmentConfig> {
  if (environment.production) return environment;

  try {
    const response = await fetch('config.json', { cache: 'no-store' });
    if (!response.ok) return environment;
    return { ...environment, ...pickUsable(await response.json()) };
  } catch {
    // Pas de fichier, ou une réponse qui n'est pas du JSON : les valeurs de `environment.ts`.
    return environment;
  }
}

/** Une valeur absente ou vide laisse gagner celle de `environment.ts`. */
function pickUsable(payload: unknown): Partial<Pick<EnvironmentConfig, (typeof OVERRIDABLE_KEYS)[number]>> {
  if (payload === null || typeof payload !== 'object') return {};

  const source = payload as Record<string, unknown>;
  const overrides: Partial<Pick<EnvironmentConfig, (typeof OVERRIDABLE_KEYS)[number]>> = {};

  for (const key of OVERRIDABLE_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.trim() !== '') overrides[key] = value.trim();
  }

  return overrides;
}
