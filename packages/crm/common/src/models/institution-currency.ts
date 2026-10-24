/**
 * La monnaie de l'institution : celle de tous les montants saisis, choisie par l'administrateur
 * (Paramétrage › Entreprise). Il n'y a plus de choix de devise dans les formulaires — un montant
 * déjà enregistré garde la devise avec laquelle il a été saisi, un montant nouveau prend celle-ci.
 *
 * Les codes doivent rester ceux de `InstitutionCurrencies.Supported` côté serveur.
 */
export const INSTITUTION_CURRENCIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'XOF', label: 'XOF — Franc CFA (UEMOA)' },
  { value: 'XAF', label: 'XAF — Franc CFA (CEMAC)' },
  { value: 'GNF', label: 'GNF — Franc guinéen' },
  { value: 'CDF', label: 'CDF — Franc congolais' },
  { value: 'MAD', label: 'MAD — Dirham marocain' },
  { value: 'NGN', label: 'NGN — Naira' },
  { value: 'GHS', label: 'GHS — Cedi' },
  { value: 'KES', label: 'KES — Shilling kényan' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'USD', label: 'USD — Dollar américain' },
];

export const DEFAULT_INSTITUTION_CURRENCY = 'XOF';

let current = DEFAULT_INSTITUTION_CURRENCY;

/**
 * La monnaie courante, pour les fonctions pures (valeurs de formulaire, mise en forme) qui ne
 * peuvent pas injecter `TenantProvider`. Posée par `TenantProvider` au chargement du contexte et
 * quand l'administrateur la change ; les composants lisent plutôt le signal `TenantProvider.currency`.
 */
export function institutionCurrency(): string {
  return current;
}

export function setInstitutionCurrency(code: string | null | undefined): void {
  current = code?.trim().toUpperCase() || DEFAULT_INSTITUTION_CURRENCY;
}

/** « FCFA » pour les deux francs CFA — l'unité que lisent les agents ; le code ISO sinon. */
export function currencyUnit(code: string | null | undefined): string {
  const c = (code || current).toUpperCase();
  return c === 'XOF' || c === 'XAF' ? 'FCFA' : c;
}
