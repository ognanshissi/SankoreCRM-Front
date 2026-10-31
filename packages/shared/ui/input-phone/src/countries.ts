export interface CountryDef {
  code: string;
  name: string;
  dial: string;
  flag: string;
  pattern: RegExp;
  placeholder: string;
  /** Le plan a un préfixe national « 0 » (07 69… en France = +33 7 69…) : il ne fait pas partie du numéro. */
  trunkZero?: boolean;
}

/** Les huit pays de l'UEMOA d'abord (US-M01-FE-06), puis le reste de l'Afrique et le monde. */
export const COUNTRIES: CountryDef[] = [
  {
    code: 'CI',
    name: "Côte d'Ivoire",
    dial: '+225',
    flag: '🇨🇮',
    pattern: /^\d{10}$/,
    placeholder: '07 12 34 56 78',
  },
  {
    code: 'SN',
    name: 'Sénégal',
    dial: '+221',
    flag: '🇸🇳',
    pattern: /^\d{9}$/,
    placeholder: '77 123 45 67',
  },
  {
    code: 'ML',
    name: 'Mali',
    dial: '+223',
    flag: '🇲🇱',
    pattern: /^\d{8}$/,
    placeholder: '76 12 34 56',
  },
  {
    code: 'BF',
    name: 'Burkina Faso',
    dial: '+226',
    flag: '🇧🇫',
    pattern: /^\d{8}$/,
    placeholder: '70 12 34 56',
  },
  {
    code: 'TG',
    name: 'Togo',
    dial: '+228',
    flag: '🇹🇬',
    pattern: /^\d{8}$/,
    placeholder: '90 12 34 56',
  },
  {
    code: 'BJ',
    name: 'Bénin',
    dial: '+229',
    flag: '🇧🇯',
    pattern: /^\d{8}$/,
    placeholder: '97 12 34 56',
  },
  {
    code: 'NE',
    name: 'Niger',
    dial: '+227',
    flag: '🇳🇪',
    pattern: /^\d{8}$/,
    placeholder: '96 12 34 56',
  },
  {
    code: 'GW',
    name: 'Guinée-Bissau',
    dial: '+245',
    flag: '🇬🇼',
    pattern: /^\d{7}$/,
    placeholder: '955 12 34',
  },
  {
    code: 'GN',
    name: 'Guinée',
    dial: '+224',
    flag: '🇬🇳',
    pattern: /^\d{9}$/,
    placeholder: '621 12 34 56',
  },
  {
    code: 'MR',
    name: 'Mauritanie',
    dial: '+222',
    flag: '🇲🇷',
    pattern: /^\d{8}$/,
    placeholder: '36 12 34 56',
  },
  {
    code: 'CM',
    name: 'Cameroun',
    dial: '+237',
    flag: '🇨🇲',
    pattern: /^\d{9}$/,
    placeholder: '6 71 23 45 67',
  },
  {
    code: 'GA',
    name: 'Gabon',
    dial: '+241',
    flag: '🇬🇦',
    pattern: /^\d{8}$/,
    placeholder: '06 12 34 56',
  },
  {
    code: 'CG',
    name: 'Congo',
    dial: '+242',
    flag: '🇨🇬',
    pattern: /^\d{9}$/,
    placeholder: '06 612 34 56',
  },
  {
    code: 'CD',
    name: 'RD Congo',
    dial: '+243',
    flag: '🇨🇩',
    pattern: /^\d{9}$/,
    placeholder: '81 234 56 78',
    trunkZero: true,
  },
  {
    code: 'MA',
    name: 'Maroc',
    dial: '+212',
    flag: '🇲🇦',
    pattern: /^\d{9}$/,
    placeholder: '6 12 34 56 78',
    trunkZero: true,
  },
  {
    code: 'TN',
    name: 'Tunisie',
    dial: '+216',
    flag: '🇹🇳',
    pattern: /^\d{8}$/,
    placeholder: '20 12 34 56',
  },
  {
    code: 'DZ',
    name: 'Algérie',
    dial: '+213',
    flag: '🇩🇿',
    pattern: /^\d{9}$/,
    placeholder: '5 12 34 56 78',
    trunkZero: true,
  },
  {
    code: 'FR',
    name: 'France',
    dial: '+33',
    flag: '🇫🇷',
    pattern: /^\d{9}$/,
    placeholder: '6 12 34 56 78',
    trunkZero: true,
  },
  {
    code: 'BE',
    name: 'Belgique',
    dial: '+32',
    flag: '🇧🇪',
    pattern: /^\d{8,9}$/,
    placeholder: '470 12 34 56',
    trunkZero: true,
  },
  {
    code: 'US',
    name: 'États-Unis',
    dial: '+1',
    flag: '🇺🇸',
    pattern: /^\d{10}$/,
    placeholder: '202 555 0123',
  },
  {
    code: 'GB',
    name: 'Royaume-Uni',
    dial: '+44',
    flag: '🇬🇧',
    pattern: /^\d{10}$/,
    placeholder: '7911 123456',
    trunkZero: true,
  },
];

/**
 * Ce que devient le texte tapé dans le champ : chiffres et espaces seulement, et un indicatif
 * international (« +225… ») reconnu dès qu'il est complet — le pays est choisi et l'indicatif sort
 * du champ. Tant qu'il ne l'est pas, le « + » et les chiffres tapés restent : avant, le « + »
 * disparaissait à la première touche et « 225 » restait devant le numéro (+225225…), seul le
 * collage d'un numéro entier marchait. Un indicatif qui peut encore s'allonger attend (« +1 »
 * peut devenir « +1242 », les Bahamas).
 *
 * @returns le texte à afficher, le pays reconnu s'il y en a un, et si l'indicatif est encore en
 * cours de saisie (rien n'est alors transmis au formulaire).
 */
export function readTypedPhone(value: string): { text: string; country: CountryDef | null; pendingDial: boolean } {
  if (value.trimStart().startsWith('+')) {
    const compact = value.replace(/[^\d+]/g, '');
    const stillGrowing = COUNTRIES.some((c) => c.dial.length > compact.length && c.dial.startsWith(compact));
    const match = stillGrowing
      ? null
      // Le plus long indicatif d'abord : « +1 » ne doit pas avaler « +1242 ».
      : [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length).find((c) => compact.startsWith(c.dial));
    if (match) return { text: clean(compact.slice(match.dial.length)), country: match, pendingDial: false };
    return { text: '+' + compact.replace(/\+/g, ''), country: null, pendingDial: true };
  }
  return { text: clean(value), country: null, pendingDial: false };
}

/** Le numéro national sans le « 0 » de préfixe des pays qui en ont un — la Côte d'Ivoire n'en a pas. */
export function nationalNumber(country: CountryDef, digits: string): string {
  return country.trunkZero && digits.startsWith('0') ? digits.slice(1) : digits;
}

/**
 * Le message à afficher sous un champ téléphone. Le contrôle du kit signale lui-même un format
 * faux (`phonePattern`), et un signal form le reçoit sans texte, avant celui de l'écran : lire
 * `errors()[0].message` affichait une erreur vide.
 */
export function phoneErrorMessage(errors: readonly { kind: string; message?: string; context?: unknown }[]): string {
  const withText = errors.find((e) => e.message);
  if (withText?.message) return withText.message;
  const kit = errors.find((e) => e.kind === 'phonePattern')?.context as { country?: string; expected?: string } | undefined;
  if (kit?.country) return `Format attendu pour ${kit.country}${kit.expected ? ` : ${kit.expected}` : ''}.`;
  return 'Numéro invalide';
}

function clean(text: string): string {
  return text.replace(/[^\d ]/g, '').replace(/ {2,}/g, ' ');
}
