import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  CancelIntegrationCommandResult,
  ConnectionDetailDto,
  ConnectionHealthDto,
  ConnectionListDto,
  PagedResultOfConnectionListDto,
  ConnectionSecretStatusDto,
  CreateConnectionRequest,
  CreateInsuranceProductRequest,
  InsuranceProductDto,
  PagedResultOfInsuranceProductDto,
  InsuranceProductWriteRequest,
  InsuranceQuoteDto,
  IntegrationApiService,
  IntegrationCommandDto,
  IntegrationCommandListPage,
  IntegrationReferenceDto,
  ListMappingsResponse,
  LiveBalanceDto,
  MappingImportReport,
  ReconciliationGapPage,
  RelayAgentDto,
  RelayAgentEnrolmentDto,
  ReplayIntegrationCommandResult,
  ResolveReconciliationGapResult,
  TemenosSettings,
  UnmappedCodesResponse,
  UpdateConnectionRequest,
  UpsertMappingResponse,
} from '@sankore/crm-api';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ConnectionFamily, MappingDomain } from './integration-referential';

/**
 * Façade du module Intégration.
 *
 * Le service généré expose 41 méthodes aux signatures positionnelles longues
 * (`listIntegrationCommands(status, errorFamily, commandType, entityType, crmId,
 * connectionId, from, to, page, pageSize)`) : appelées directement depuis les écrans,
 * un filtre inséré au mauvais rang passe inaperçu et renvoie silencieusement la
 * mauvaise page. La façade n'ajoute donc pas de logique, elle nomme les arguments et
 * normalise les listes nullables en tableaux.
 */
@Injectable({ providedIn: 'root' })
export class IntegrationFacadeService {
  private readonly _api = inject(IntegrationApiService);

  // ——— Connexions ———

  public listConnections(filters: {
    family?: ConnectionFamily;
    isActive?: boolean;
    page?: number;
    pageSize?: number;
  }): Observable<PagedResultOfConnectionListDto> {
    return this._api.listIntegrationConnections(
      filters.family,
      filters.isActive,
      filters.page,
      filters.pageSize,
    );
  }

  public listAllConnections(family?: ConnectionFamily): Observable<ConnectionListDto[]> {
    // Les sélecteurs de connexion des autres écrans ont besoin de la liste entière,
    // pas d'une page : 200 est au-delà de ce qu'un tenant déclare jamais.
    return this.listConnections({ family, page: 1, pageSize: 200 }).pipe(
      map((result) => result.items ?? []),
    );
  }

  public getConnection(connectionId: string): Observable<ConnectionDetailDto> {
    return this._api.getIntegrationConnection(connectionId);
  }

  public createConnection(request: CreateConnectionRequest): Observable<string | undefined> {
    return this._api
      .createIntegrationConnection(request)
      .pipe(map((response) => response.connectionId));
  }

  public updateConnection(
    connectionId: string,
    request: UpdateConnectionRequest,
  ): Observable<unknown> {
    return this._api.updateIntegrationConnection(connectionId, request);
  }

  public activateConnection(connectionId: string): Observable<unknown> {
    return this._api.activateIntegrationConnection(connectionId);
  }

  public deactivateConnection(connectionId: string): Observable<unknown> {
    return this._api.deactivateIntegrationConnection(connectionId);
  }

  public checkConnectionHealth(connectionId: string): Observable<ConnectionHealthDto> {
    return this._api.checkIntegrationConnectionHealth(connectionId);
  }

  public getSecretStatus(connectionId: string): Observable<ConnectionSecretStatusDto[]> {
    return this._api
      .getIntegrationConnectionSecretStatus(connectionId)
      .pipe(map((rows) => rows ?? []));
  }

  public setSecret(
    connectionId: string,
    name: string,
    value: string,
    expiresAt: string | null,
  ): Observable<unknown> {
    return this._api.setIntegrationConnectionSecret(connectionId, name, { value, expiresAt });
  }

  // ——— Mappings ———

  public listMappings(
    connectionId: string,
    domain?: MappingDomain,
  ): Observable<ListMappingsResponse> {
    return this._api.listIntegrationMappings(connectionId, domain);
  }

  public listUnmappedCodes(
    connectionId: string,
    domain: MappingDomain,
  ): Observable<UnmappedCodesResponse> {
    return this._api.listUnmappedIntegrationCodes(connectionId, domain);
  }

  public upsertMapping(
    connectionId: string,
    domain: MappingDomain,
    crmCode: string,
    externalCode: string,
    label: string | null,
  ): Observable<UpsertMappingResponse> {
    return this._api.upsertIntegrationMapping(connectionId, domain, crmCode, {
      externalCode,
      label,
    });
  }

  public deleteMapping(
    connectionId: string,
    domain: MappingDomain,
    crmCode: string,
  ): Observable<unknown> {
    return this._api.deleteIntegrationMapping(connectionId, domain, crmCode);
  }

  public exportMappings(connectionId: string, domain: MappingDomain): Observable<string> {
    return this._api.exportIntegrationMappings(connectionId, domain);
  }

  public validateMappingImport(
    connectionId: string,
    domain: MappingDomain,
    file: Blob,
  ): Observable<MappingImportReport> {
    return this._api.validateIntegrationMappingImport(connectionId, domain, file);
  }

  public importMappings(
    connectionId: string,
    domain: MappingDomain,
    file: Blob,
  ): Observable<MappingImportReport> {
    return this._api.importIntegrationMappings(connectionId, domain, file);
  }

  // ——— Commandes ———

  public listCommands(filters: {
    status?: string;
    errorFamily?: string;
    commandType?: string;
    entityType?: string;
    crmId?: string;
    connectionId?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }): Observable<IntegrationCommandListPage> {
    return this._api.listIntegrationCommands(
      filters.status,
      filters.errorFamily,
      filters.commandType,
      filters.entityType,
      filters.crmId,
      filters.connectionId,
      filters.from,
      filters.to,
      filters.page,
      filters.pageSize,
    );
  }

  public getCommand(commandId: string): Observable<IntegrationCommandDto> {
    return this._api.getIntegrationCommand(commandId);
  }

  public replayCommand(commandId: string): Observable<ReplayIntegrationCommandResult> {
    return this._api.replayIntegrationCommand(commandId);
  }

  public cancelCommand(
    commandId: string,
    reason: string,
  ): Observable<CancelIntegrationCommandResult> {
    return this._api.cancelIntegrationCommand(commandId, { reason });
  }

  // ——— Références et soldes ———

  public getReference(
    connectionId: string,
    entityType: string,
    crmId: string,
  ): Observable<IntegrationReferenceDto> {
    return this._api.getIntegrationReference(connectionId, entityType, crmId);
  }

  public getLiveBalance(crmCustomerId: string, accountRef: string): Observable<LiveBalanceDto> {
    return this._api.getLiveBalance(crmCustomerId, accountRef);
  }

  // ——— Agent relais ———

  public listRelayAgents(): Observable<RelayAgentDto[]> {
    return this._api.listIntegrationRelayAgents().pipe(map((rows) => rows ?? []));
  }

  public registerRelayAgent(name: string): Observable<RelayAgentEnrolmentDto> {
    return this._api.registerIntegrationRelayAgent({ name });
  }

  public revokeRelayAgent(agentId: string): Observable<unknown> {
    return this._api.revokeIntegrationRelayAgent(agentId);
  }

  // ——— Réconciliation ———

  public listReconciliationGaps(filters: {
    connectionId?: string;
    gapType?: string;
    resolution?: string;
    page?: number;
    pageSize?: number;
  }): Observable<ReconciliationGapPage> {
    return this._api.listReconciliationGaps(
      filters.connectionId,
      filters.gapType,
      filters.resolution,
      filters.page,
      filters.pageSize,
    );
  }

  public resolveReconciliationGap(
    gapId: string,
    note: string,
  ): Observable<ResolveReconciliationGapResult> {
    return this._api.resolveReconciliationGap(gapId, { note });
  }

  // ——— Assurance ———

  public listInsuranceProducts(filters: {
    connectionId?: string;
    isActive?: boolean;
    offerableOnly?: boolean;
    page?: number;
    pageSize?: number;
  }): Observable<PagedResultOfInsuranceProductDto> {
    return this._api.listInsuranceProducts(
      filters.connectionId,
      filters.isActive,
      filters.offerableOnly,
      filters.page,
      filters.pageSize,
    );
  }

  public getInsuranceProduct(productId: string): Observable<InsuranceProductDto> {
    return this._api.getInsuranceProduct(productId);
  }

  public createInsuranceProduct(
    request: CreateInsuranceProductRequest,
  ): Observable<InsuranceProductDto> {
    return this._api.createInsuranceProduct(request);
  }

  public updateInsuranceProduct(
    productId: string,
    request: InsuranceProductWriteRequest,
  ): Observable<InsuranceProductDto> {
    return this._api.updateInsuranceProduct(productId, request);
  }

  public activateInsuranceProduct(productId: string): Observable<InsuranceProductDto> {
    return this._api.activateInsuranceProduct(productId);
  }

  public deactivateInsuranceProduct(productId: string): Observable<InsuranceProductDto> {
    return this._api.deactivateInsuranceProduct(productId);
  }

  public quoteInsuranceProduct(
    productId: string,
    crmCustomerId: string,
    insuredAmount: number | null,
  ): Observable<InsuranceQuoteDto> {
    return this._api.quoteInsuranceProduct(productId, { crmCustomerId, insuredAmount });
  }
}

/**
 * Réglages par défaut d'une nouvelle connexion. Le serveur valide des bornes mais ne
 * remplit rien : sans ces valeurs, une connexion est créée avec des zéros, donc une
 * limite d'appels nulle et un délai d'attente nul.
 */
/**
 * Socle commun des réglages, sans discriminant.
 *
 * Le type n'est plus `ConnectionSettings` : depuis que le contrat publie la variante par
 * `$kind`, `ConnectionSettings` est une union dont chaque membre EXIGE son discriminant, et
 * des valeurs par défaut ne peuvent pas en nommer un — elles servent à amorcer le
 * formulaire, pas à décrire une connexion existante.
 */
export type ConnectionSettingsDefaults = Pick<
  TemenosSettings,
  | 'schemaVersion'
  | 'rateLimitPerMinute'
  | 'timeoutSeconds'
  | 'circuitBreakerFailureThreshold'
  | 'circuitBreakerBreakSeconds'
  // Reprise par `Pick` et non importée : le générateur nomme ce dictionnaire d'après le
  // premier schéma qui le porte, un nom qui change dès qu'un `$kind` s'ajoute avant.
  | 'syncIntervalMinutes'
>;

export function defaultConnectionSettings(): ConnectionSettingsDefaults {
  return {
    schemaVersion: 1,
    rateLimitPerMinute: 60,
    timeoutSeconds: 30,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerBreakSeconds: 60,
  };
}

/**
 * Message d'erreur serveur, tel que le reste du repo le remonte : un message
 * générique masque exactement l'information qui fait gagner une heure. Les codes
 * métier documentés par le contrat sont traduits ; le reste retombe sur `errors` puis
 * `title` de `ProblemDetails`.
 */
export function integrationErrorMessage(error: HttpErrorResponse, fallback: string): string {
  const body = error?.error as
    | { code?: string; title?: string; detail?: string; errors?: Record<string, string[]> }
    | undefined;

  switch (body?.code) {
    case 'INTEGRATION_CONNECTION_NOT_HEALTHY':
      return "Le test de connexion n'est pas passé. Lancez un test réussi avant d'activer.";
    case 'INTEGRATION_CORE_BANKING_ALREADY_ACTIVE':
      return 'Une connexion core banking est déjà active. Désactivez-la avant d’activer celle-ci.';
    case 'INTEGRATION_CONNECTION_NOT_FOUND':
      return "Cette connexion n'existe pas, ou plus.";
    case 'INTEGRATION_BALANCE_NOT_AVAILABLE':
      return "Aucun solde n'est disponible pour ce compte.";
    case 'INTEGRATION_CONCURRENCY_CONFLICT':
      return 'Quelqu’un a modifié cet élément entre-temps. Rechargez la page avant de réessayer.';
    case 'INSURANCE_PRODUCT_ALREADY_EXISTS':
      return 'Ce code produit existe déjà chez cet assureur.';
    case 'INSURANCE_CONNECTION_WRONG_FAMILY':
      return "Cette connexion n'est pas une connexion assurance.";
    case 'INSURANCE_PRODUCT_NOT_FOUND':
      return "Ce produit d'assurance n'existe pas, ou plus.";
    case 'INSURANCE_PRODUCT_NOT_OFFERABLE':
      return "Ce produit n'est pas proposable : vérifiez son état et la connexion de l'assureur.";
    default:
      break;
  }

  if (body?.errors) {
    const first = Object.values(body.errors).flat()[0];
    if (first) return first;
  }

  if (error?.status === 403) {
    return "Vous n'avez pas le droit d'effectuer cette action.";
  }

  return body?.detail || body?.title || fallback;
}
