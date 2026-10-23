/**
 * Les modules payants qu'un tenant peut souscrire, mêmes codes que `TenantModules` côté serveur.
 * Tout le reste est le socle, toujours actif — la téléphonie et la conformité comprises.
 */
export const TENANT_MODULES = {
  BANKING_MICROFINANCE: 'BankingMicrofinance',
  INSURANCE: 'Insurance',
} as const;

export type TenantModule = (typeof TENANT_MODULES)[keyof typeof TENANT_MODULES];

export const TENANT_MODULE_LABELS: Record<TenantModule, string> = {
  BankingMicrofinance: 'Banking - Microfinance',
  Insurance: 'Assurance',
};

/**
 * Le module dont relève chaque catégorie de produit, comme `ProductCategories.ModuleOf` côté
 * serveur ; `null` pour `Standard`, la catégorie du socle. Une catégorie absente d'ici est traitée
 * comme ouverte : c'est le serveur qui tranche à la création.
 */
export const PRODUCT_CATEGORY_MODULE: Record<string, TenantModule | null> = {
  Standard: null,
  Insurance: TENANT_MODULES.INSURANCE,
  HealthInsurance: TENANT_MODULES.INSURANCE,
  ForecastInsurance: TENANT_MODULES.INSURANCE,
  Loan: TENANT_MODULES.BANKING_MICROFINANCE,
  Savings: TENANT_MODULES.BANKING_MICROFINANCE,
  CurrentAccount: TENANT_MODULES.BANKING_MICROFINANCE,
  Tontine: TENANT_MODULES.BANKING_MICROFINANCE,
  GroupCredit: TENANT_MODULES.BANKING_MICROFINANCE,
  Agriculture: TENANT_MODULES.BANKING_MICROFINANCE,
};

/** Une catégorie est-elle ouverte à la création avec ces modules actifs ? */
export function isCategoryOpen(category: string, activeModules: ReadonlySet<string>): boolean {
  const module = PRODUCT_CATEGORY_MODULE[category];
  return !module || activeModules.has(module);
}
