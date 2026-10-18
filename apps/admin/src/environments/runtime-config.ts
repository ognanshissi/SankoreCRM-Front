import { EnvironmentConfig } from '@sankore/crm/common';
import { environment } from './environment';

/**
 * Surcharges servies par `/config.json`. Volontairement un sous-ensemble de
 * `EnvironmentConfig` : seules les URL ont leur place ici, la réponse étant publique.
 */
type RuntimeOverrides = Pick<EnvironmentConfig, 'apiUrl' | 'apiKey'>;

const OVERRIDABLE_KEYS = ['apiUrl', 'apiKey'] as const;

/**
 * Résout la configuration au démarrage, avant `bootstrapApplication`.
 *
 * Toutes les routes de l'application sont en `RenderMode.Client`
 * (`app.routes.server.ts`) : le rendu réel a lieu dans le navigateur, qui exécute un
 * bundle statique et ne peut donc pas lire `process.env`. Les valeurs de
 * `environment.ts` sont figées à la compilation. Passer par `/config.json`, que le
 * serveur Express remplit depuis ses variables, est ce qui permet de déployer **une
 * seule image** sur plusieurs environnements au lieu d'en reconstruire une par URL
 * d'API.
 */
export async function loadRuntimeConfig(): Promise<EnvironmentConfig> {
  try {
    const response = await fetch('config.json', { cache: 'no-store' });
    if (!response.ok) {
      return environment;
    }
    return { ...environment, ...pickUsable(await response.json()) };
  } catch {
    // Pas de serveur Express devant l'app (build statique, test unitaire) : on garde les
    // valeurs compilées. Un échec de configuration ne doit pas empêcher le démarrage.
    return environment;
  }
}

/**
 * Une variable absente du conteneur arrive en `undefined`, et une variable déclarée sans
 * valeur en chaîne vide : dans les deux cas il faut laisser la valeur compilée gagner,
 * sinon un `NG_INGEST_URL=` vide effacerait l'hôte d'ingestion de production.
 */
function pickUsable(payload: unknown): Partial<RuntimeOverrides> {
  if (payload === null || typeof payload !== 'object') {
    return {};
  }
  const source = payload as Record<string, unknown>;
  const overrides: Partial<RuntimeOverrides> = {};
  for (const key of OVERRIDABLE_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.trim() !== '') {
      overrides[key] = value.trim();
    }
  }
  return overrides;
}
