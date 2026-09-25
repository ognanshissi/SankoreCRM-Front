

export interface EnvironmentConfig {
  apiKey: string;
  apiUrl: string;
  production: boolean;
  applicationAuthorizationKey?: string;
  tenantId?: string;
  /**
   * Hote public d'ingestion (webhooks fournisseurs, script web). Distinct de
   * `apiUrl` : c'est l'URL remise a des tiers. Laisser vide pour retomber sur
   * `apiUrl`, ce qui est le comportement attendu en local.
   */
  ingestUrl?: string;
}
