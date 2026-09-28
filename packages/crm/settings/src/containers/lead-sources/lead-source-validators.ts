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

/** Entier decimal sans zero de tete : `0`, `8`, `255` — mais pas `01` ni `008`. */
const DECIMAL_RE = /^(?:0|[1-9]\d{0,2})$/;

/**
 * Les zeros de tete sont refuses volontairement : `01.02.03.04` etait accepte,
 * or beaucoup de piles reseau interpretent `010` en octal. Une liste blanche
 * d'IP qui ne designe pas la meme adresse que le serveur ne protege rien.
 */
function isValidIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => DECIMAL_RE.test(p) && Number(p) <= 255);
}

/**
 * IPv6 stricte. L'implementation precedente n'imposait aucun nombre de groupes
 * et comptait les `::` par expression reguliere : elle acceptait `cafe`, `a:b`
 * ou `2001:db8:::1` et refusait `::ffff:192.0.2.1`. Un administrateur croyait
 * donc restreindre son webhook alors que la valeur enregistree ne designait
 * aucune adresse.
 */
function isValidIpv6(value: string): boolean {
  if (!/^[0-9a-fA-F:.]+$/.test(value)) return false;
  // `:::` n'est pas une sequence compressee valide, et `x::y::z` en compte deux.
  if (value.includes(':::')) return false;
  const halves = value.split('::');
  if (halves.length > 2) return false;
  const compressed = halves.length === 2;

  // Un suffixe IPv4 (`::ffff:192.0.2.1`) n'est tolere qu'en derniere position
  // et occupe deux groupes de 16 bits.
  let ipv4Groups = 0;
  if (value.includes('.')) {
    const segments = halves[halves.length - 1].split(':');
    const tail = segments.pop() ?? '';
    if (!tail.includes('.') || !isValidIpv4(tail)) return false;
    ipv4Groups = 2;
    halves[halves.length - 1] = segments.join(':');
  }

  const groupsOf = (half: string): string[] | null => {
    if (half === '') return [];
    const groups = half.split(':');
    return groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g)) ? groups : null;
  };

  const head = groupsOf(halves[0]);
  const tail = compressed ? groupsOf(halves[1]) : [];
  if (head === null || tail === null) return false;

  const total = head.length + tail.length + ipv4Groups;
  // Sans `::` l'adresse doit etre complete ; avec, `::` remplace au moins un
  // groupe de zeros, donc le reste doit tenir dans 7 groupes.
  return compressed ? total <= 7 : total === 8;
}

export function isValidIpOrCidr(value: string | null | undefined): boolean {
  if (!value) return false;
  const [address, prefix, ...rest] = value.trim().split('/');
  if (rest.length > 0) return false;

  const v4 = isValidIpv4(address);
  const v6 = !v4 && isValidIpv6(address);
  if (!v4 && !v6) return false;

  if (prefix === undefined) return true;
  // `008` ou `032` etaient acceptes : un prefixe CIDR n'a pas de zero de tete.
  if (!DECIMAL_RE.test(prefix)) return false;
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
