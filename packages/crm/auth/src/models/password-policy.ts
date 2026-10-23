export interface PasswordCriterion {
  key: string;
  label: string;
  message: string;
  test: (password: string) => boolean;
}

// Recopie la politique qu'Identity applique réellement côté serveur
// (AdministrationModule : longueur 8 et chiffre, le reste aux valeurs par défaut,
// donc majuscule, minuscule ET caractère spécial obligatoires). Le front ne
// demandait pas de caractère spécial : « Abcdefg1 » passait ici, était refusé par
// le serveur, et l'écran affichait « lien invalide ». Les classes Unicode suivent
// char.IsUpper / IsLower / IsDigit / IsLetterOrDigit de .NET (« é » est une lettre).
export const PASSWORD_CRITERIA: PasswordCriterion[] = [
  {
    key: 'length',
    label: 'Au moins 8 caractères',
    message: 'Le mot de passe doit contenir au moins 8 caractères',
    test: (p) => p.length >= 8,
  },
  {
    key: 'uppercase',
    label: 'Une lettre majuscule',
    message: 'Le mot de passe doit contenir une lettre majuscule',
    test: (p) => /\p{Lu}/u.test(p),
  },
  {
    key: 'lowercase',
    label: 'Une lettre minuscule',
    message: 'Le mot de passe doit contenir une lettre minuscule',
    test: (p) => /\p{Ll}/u.test(p),
  },
  {
    key: 'digit',
    label: 'Un chiffre',
    message: 'Le mot de passe doit contenir un chiffre',
    test: (p) => /\p{Nd}/u.test(p),
  },
  {
    key: 'special',
    label: 'Un caractère spécial (ex. ! @ # ?)',
    message: 'Le mot de passe doit contenir un caractère spécial',
    test: (p) => /[^\p{L}\p{N}]/u.test(p),
  },
];

export const STRONG_PASSWORD_LENGTH = 12;

export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

/**
 * 0 : vide, 1 : faible, 2 : moyen, 3 : acceptable (tous les critères), 4 : fort
 * (tous les critères et au moins 12 caractères).
 */
export function evaluatePasswordStrength(password: string): PasswordStrength {
  if (!password) return 0;
  const met = PASSWORD_CRITERIA.filter((c) => c.test(password)).length;
  if (met === PASSWORD_CRITERIA.length) {
    return password.length >= STRONG_PASSWORD_LENGTH ? 4 : 3;
  }
  return met >= 3 ? 2 : 1;
}

export function firstUnmetPasswordCriterion(password: string): PasswordCriterion | undefined {
  return PASSWORD_CRITERIA.find((c) => !c.test(password));
}
