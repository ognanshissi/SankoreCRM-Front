/**
 * Validateurs partages des ecrans « sources de leads ».
 *
 * Mutualises volontairement : les memes formats sont saisis a plusieurs
 * endroits (JSONPath dans l'assistant pull ET dans la connexion webhook,
 * origines dans l'assistant script) et divergeaient jusqu'ici.
 */

// ——— JSONPath (FE-17 AC5, FE-19 AC5, FE-20) ———

/**
 * Sous-ensemble de JSONPath accepte par le back : racine `$`, acces par
 * propriete (`.nom`, `..nom`) et par index (`[0]`, `[*]`, `['nom']`).
 */
const JSONPATH_RE =
  /^\$(?:\.\.?[A-Za-z_$][\w$]*|\[\s*(?:\d+|\*|'[^']*'|"[^"]*")\s*\])*$/;

export function isValidJsonPath(value: string | null | undefined): boolean {
  if (!value) return false;
  return JSONPATH_RE.test(value.trim());
}

/** Message d'erreur unique, pour ne pas le reecrire a chaque ecran. */
export const JSONPATH_HINT =
  "Chemin JSONPath attendu, par exemple $.data, $.items[0].id ou $['external-id'].";

// ——— Adresses IP et plages CIDR (FE-17 AC4) ———

function isValidIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function isValidIpv6(value: string): boolean {
  // Forme compressee acceptee, une seule occurrence de `::`.
  if (!/^[0-9a-fA-F:]+$/.test(value)) return false;
  if ((value.match(/::/g) ?? []).length > 1) return false;
  const groups = value.split(':').filter((g) => g !== '');
  if (groups.length === 0 || groups.length > 8) return false;
  return groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g));
}

export function isValidIpOrCidr(value: string | null | undefined): boolean {
  if (!value) return false;
  const [address, prefix, ...rest] = value.trim().split('/');
  if (rest.length > 0) return false;

  const v4 = isValidIpv4(address);
  const v6 = !v4 && isValidIpv6(address);
  if (!v4 && !v6) return false;

  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const max = v4 ? 32 : 128;
  return Number(prefix) <= max;
}

// ——— Origines autorisees (FE-10 AC1) ———

export interface OriginRules {
  /**
   * `http://localhost` n'est accepte qu'en statut `Testing` : une source
   * active ne doit pas accepter de soumissions depuis un poste de dev.
   */
  allowLocalhost?: boolean;
}

export function isValidOrigin(
  value: string | null | undefined,
  rules: OriginRules = {},
): boolean {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }

  // Une origine n'a ni chemin, ni requete, ni fragment.
  if (url.pathname !== '/' || url.search || url.hash) return false;

  if (url.protocol === 'https:') return true;

  const isLoopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]';
  return !!rules.allowLocalhost && url.protocol === 'http:' && isLoopback;
}

export function originHint(rules: OriginRules = {}): string {
  return rules.allowLocalhost
    ? "Origines https:// sans chemin. http://localhost est accepté tant que la source est en statut « Test »."
    : 'Seules les origines https:// sans chemin sont acceptées.';
}
