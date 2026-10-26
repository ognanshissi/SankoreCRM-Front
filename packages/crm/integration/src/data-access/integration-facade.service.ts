import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  CancelIntegrationCommandResult,
  ClaimDocumentDto,
  ClaimDto,
  CloseComplaintRequest,
  ComplaintDto,
  ComplaintReportDto,
  EscalateComplaintRequest,
  RecordComplaintRequest,
  ResolveComplaintRequest,
  DeclareClaimRequest,
  DeclareClaimResult,
  UploadClaimDocumentResponse,
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
  InsurancePolicyDto,
  InsuranceSubscriptionDto,
  IntegrationApiService,
  SubscribeInsurancePolicyRequest,
  SubscribeInsurancePolicyResult,
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

  // ——— Sinistres et pièces (ASS-09) ———

  /**
   * Les sinistres d'un client, ou les dossiers encore ouverts du tenant.
   *
   * `openOnly` est passé explicitement plutôt que laissé à son défaut : le serveur
   * répond l'ensemble du registre sans lui, et une liste « sinistres du client » qui
   * ramène aussi les dossiers clos serait une liste qu'un agent trie à la main.
   */
  public listClaims(filters: {
    crmCustomerId?: string;
    openOnly?: boolean;
  }): Observable<ClaimDto[]> {
    return this._api
      .listInsuranceClaims(filters.crmCustomerId, filters.openOnly ?? false)
      .pipe(map((rows) => rows ?? []));
  }

  /** Les polices d'un client, dans le périmètre d'agence de l'appelant. */
  public listPolicies(crmCustomerId: string): Observable<InsurancePolicyDto[]> {
    return this._api.listInsurancePolicies(crmCustomerId).pipe(map((rows) => rows ?? []));
  }

  /** L'attestation, demandée à l'assureur au moment du clic. */
  public getPolicyCertificate(policyId: string): Observable<Blob> {
    return this._api.getInsurancePolicyCertificate(policyId) as unknown as Observable<Blob>;
  }

  /**
   * Prépare la souscription d'un produit détenu signé : produit de l'assureur, prime, paiement et
   * consentement. Rien n'est prélevé ni envoyé tant que le produit détenu n'est pas envoyé.
   */
  public prepareInsuranceSubscription(
    request: SubscribeInsurancePolicyRequest,
  ): Observable<SubscribeInsurancePolicyResult> {
    return this._api.subscribeInsurancePolicy(request);
  }

  public getInsuranceSubscription(subscriptionId: string): Observable<InsuranceSubscriptionDto> {
    return this._api.getInsuranceSubscription(subscriptionId);
  }

  public getClaim(claimId: string): Observable<ClaimDto> {
    return this._api.getInsuranceClaim(claimId);
  }

  public declareClaim(request: DeclareClaimRequest): Observable<DeclareClaimResult> {
    return this._api.declareInsuranceClaim(request);
  }

  public listClaimDocuments(claimId: string): Observable<ClaimDocumentDto[]> {
    return this._api.listClaimDocuments(claimId).pipe(map((rows) => rows ?? []));
  }

  /**
   * Dépose une pièce. `requestedByInsurer` décide si elle partira automatiquement à
   * l'assureur une fois l'antivirus passé — le serveur ne pousse pas une pièce que
   * personne n'a réclamée sur un dossier à l'étude.
   */
  public uploadClaimDocument(
    claimId: string,
    documentKind: string,
    file: Blob,
    requestedByInsurer: boolean,
  ): Observable<UploadClaimDocumentResponse> {
    return this._api.uploadClaimDocument(claimId, documentKind, requestedByInsurer, file);
  }

  /**
   * Le contenu d'une pièce.
   *
   * <b>Le cast est nécessaire et sans risque.</b> Le générateur type la réponse
   * `object` parce que le swagger annonce `application/octet-stream`, mais le code
   * généré met bien `responseType: 'blob'` pour tout média non-JSON — c'est donc un
   * `Blob` à l'exécution, et le type déclaré est le seul endroit qui l'ignore.
   *
   * Le serveur refuse par 409 toute pièce dont le verdict antivirus n'est pas `Clean` :
   * l'appelant ne doit proposer ce bouton que sur `isTransmittable`.
   */
  public downloadClaimDocument(claimId: string, documentId: string): Observable<Blob> {
    return this._api
      .downloadClaimDocument(claimId, documentId)
      .pipe(map((payload) => payload as unknown as Blob));
  }

  // ——— Réclamations (règlement 01/CIMA/2024) ———

  /**
   * Le registre. Les trois filtres sont nommés parce que la signature générée les prend
   * en positionnel (`crmCustomerId, openOnly, overdueOnly`) : deux booléens de suite,
   * c'est exactement la forme où un appel inverse les deux sans que rien ne le dise.
   *
   * `overdueOnly` implique `openOnly` côté serveur — une réclamation close ne peut plus
   * être en retard — donc l'écran n'a pas à combiner les deux.
   */
  public listComplaints(filters: {
    crmCustomerId?: string;
    openOnly?: boolean;
    overdueOnly?: boolean;
  }): Observable<ComplaintDto[]> {
    return this._api
      .listInsuranceComplaints(
        filters.crmCustomerId,
        filters.openOnly ?? false,
        filters.overdueOnly ?? false,
      )
      .pipe(map((rows) => rows ?? []));
  }

  public getComplaint(complaintId: string): Observable<ComplaintDto> {
    return this._api.getInsuranceComplaint(complaintId);
  }

  /**
   * Les chiffres du mécanisme sur une fenêtre. Les bornes sont des jours (`YYYY-MM-DD`)
   * et le serveur refuse une fenêtre inversée.
   */
  public getComplaintReport(from: string, to: string): Observable<ComplaintReportDto> {
    return this._api.getInsuranceComplaintReport(from, to);
  }

  public recordComplaint(request: RecordComplaintRequest): Observable<ComplaintDto> {
    return this._api.recordInsuranceComplaint(request);
  }

  /** Idempotent côté serveur : il garde le PREMIER instant d'accusé de réception. */
  public acknowledgeComplaint(complaintId: string): Observable<ComplaintDto> {
    return this._api.acknowledgeInsuranceComplaint(complaintId);
  }

  public escalateComplaint(
    complaintId: string,
    request: EscalateComplaintRequest,
  ): Observable<ComplaintDto> {
    return this._api.escalateInsuranceComplaint(complaintId, request);
  }

  public resolveComplaint(
    complaintId: string,
    request: ResolveComplaintRequest,
  ): Observable<ComplaintDto> {
    return this._api.resolveInsuranceComplaint(complaintId, request);
  }

  /**
   * Clôture sans réponse — un retrait du client, ou une demande hors périmètre. Ce n'est
   * PAS `resolveComplaint` : le serveur compte les deux séparément, parce qu'un rapport
   * qui compterait un retrait comme traité surévaluerait le mécanisme.
   */
  public closeComplaint(
    complaintId: string,
    request: CloseComplaintRequest,
  ): Observable<ComplaintDto> {
    return this._api.closeInsuranceComplaint(complaintId, request);
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
/** Les motifs d'inéligibilité renvoyés par le serveur, en clair. */
function eligibilityReasonLabel(reason: string): string {
  switch (reason) {
    case 'AGE_BELOW_MINIMUM':
      return "âge inférieur au minimum du produit";
    case 'AGE_ABOVE_MAXIMUM':
      return "âge supérieur au maximum du produit";
    case 'AGE_UNKNOWN':
      return 'date de naissance non renseignée';
    case 'KYC_LEVEL_INSUFFICIENT':
      return 'niveau KYC insuffisant';
    case 'KYC_LEVEL_UNKNOWN':
      return 'niveau KYC inconnu';
    case 'NO_CBS_ACCOUNT':
    case 'CBS_ACCOUNT_UNKNOWN':
      return 'le produit exige un compte au système bancaire, débité pour la prime';
    case 'NO_ACTIVE_LOAN':
    case 'ACTIVE_LOAN_UNKNOWN':
      return 'le produit exige un prêt en cours';
    default:
      return reason;
  }
}

export function integrationErrorMessage(error: HttpErrorResponse, fallback: string): string {
  const body = error?.error as
    | { code?: string; error?: string; title?: string; detail?: string; errors?: Record<string, string[]> }
    | undefined;

  // Les sinistres répondent `{ error }` et non `{ code }` ; le refus hors couverture porte en plus
  // son côté (`…:BEFORE_COVER` / `…:AFTER_COVER`).
  const code = body?.code ?? body?.error;
  if (code?.startsWith('INSURANCE_LOSS_OUTSIDE_COVER')) {
    return code.endsWith('BEFORE_COVER')
      ? 'Le sinistre est antérieur au début de la couverture : ce contrat ne le couvre pas.'
      : 'Le sinistre est postérieur à la fin de la couverture : ce contrat ne le couvre plus.';
  }

  if (code?.startsWith('INSURANCE_NOT_ELIGIBLE')) {
    const reasons = code.split(':')[1]?.split(',').filter(Boolean) ?? [];
    return `Le client ne remplit pas les conditions du produit : ${reasons.map(eligibilityReasonLabel).join(' ; ')}.`;
  }
  if (code?.startsWith('INSURANCE_QUESTIONNAIRES_INCOMPLETE')) {
    const missing = code.split(':')[1] ?? '';
    return `${missing ? missing + ' questionnaire(s)' : 'Des questionnaires'} du projet ne sont pas remplis : complétez-les sur le projet avant de souscrire.`;
  }
  if (code?.startsWith('INSURANCE_DISTRIBUTOR_NOT_IN_GOOD_STANDING')) {
    return "Les pièces de distribution de l'institution (agrément, garantie financière, RC professionnelle) sont absentes ou échues : les nouvelles souscriptions sont refusées jusqu'à leur renouvellement (Paramétrage › Distribution d'assurance).";
  }
  // Le code arrive suivi d'un détail technique en anglais (« : No Product mapping for CRM code … »),
  // qui s'affichait tel quel à l'agent.
  if (code?.startsWith('INTEGRATION_MAPPING_MISSING') || body?.detail?.startsWith('INTEGRATION_MAPPING_MISSING')) {
    return "Ce produit n'est pas encore relié au catalogue de l'assureur : un administrateur doit ajouter sa correspondance « Produit » (Paramétrage › Intégrations › Correspondances).";
  }
  if (code?.startsWith('INSURANCE_PAYMENT_INVALID')) {
    return 'Le paiement de la prime est incomplet : mode, référence et date sont nécessaires.';
  }

  switch (code) {
    case 'INSURANCE_PAYER_NOT_FOUND':
      return "Le payeur choisi n'est pas un client de l'institution.";
    case 'INSURANCE_PAYER_KYC_NOT_APPROVED':
      return "Le KYC du payeur n'est pas approuvé : il ne peut pas payer la prime d'un tiers (LBC/FT).";
    case 'INSURANCE_NO_COLLECTION_MANDATE':
      return "Cet assureur n'a pas donné de mandat d'encaissement : la prime ne peut être ni prélevée ni encaissée ici. Choisissez « Encaissée par l'assureur ».";
    case 'INSURANCE_INFORMATION_SHEET_NOT_DELIVERED':
    case 'HOLDING_INFORMATION_SHEET_NOT_DELIVERED':
      return "La fiche d'information du produit doit être remise au client avant sa signature.";
    case 'INSURANCE_INFORMATION_SHEET_MISSING':
      return "Aucune fiche d'information n'a été déposée pour ce produit : un administrateur doit la déposer.";
    case 'INSURANCE_DEROGATION_NOT_ALLOWED':
      return 'Le paiement sous 60 jours est réservé aux primes de plus de 80 fois le SMIG annuel.';
    case 'INSURANCE_PREMIUM_NOT_OUTSTANDING':
      return "Aucune prime n'est due sur cette souscription.";
    case 'DISTRIBUTION_CREDENTIAL_REQUIRED':
      return "Votre carte professionnelle d'intermédiaire d'assurance est absente ou échue : vous ne pouvez pas présenter ce contrat.";
    case 'DESIGNATION_REQUIRED_ROLE_MISSING':
      return 'La clause bénéficiaire du contrat est incomplète : complétez-la depuis la fiche client.';
    case 'INSURANCE_HOLDING_NOT_FOUND':
      return "Ce contrat n'existe pas, ou n'est pas dans votre périmètre.";
    case 'INSURANCE_HOLDING_NOT_SIGNED':
      return "Le contrat doit être signé par le client et pas encore envoyé : enregistrez la signature depuis la fiche client.";
    case 'INSURANCE_PRODUCT_NOT_FOR_HOLDING':
      return "Ce produit de l'assureur ne correspond pas au produit du contrat.";
    case 'INSURANCE_EFFECTIVE_DATE_REQUIRED':
      return "Le contrat n'a pas de date d'effet : renseignez-la dans ses termes avant de souscrire.";
    case 'INSURANCE_PAYMENT_CBS_UNAVAILABLE':
      return "Aucune connexion au système bancaire n'est active : la prime ne peut pas être prélevée. Enregistrez une prime encaissée.";
    case 'INSURANCE_PAYMENT_DATE_IN_FUTURE':
      return "La date d'encaissement ne peut pas être dans le futur.";
    case 'INSURANCE_SUBSCRIPTION_IN_FLIGHT':
      return 'Un autre contrat de ce client souscrit déjà ce produit à cette date.';
    case 'INSURANCE_PREMIUM_UNKNOWN':
      return "La prime n'est pas connue : demandez le tarif à l'assureur.";
    case 'INSURANCE_POLICY_NOT_FOUND':
      return "Ce contrat d'assurance n'existe pas, ou plus.";
    case 'INSURANCE_LOSS_IN_THE_FUTURE':
      return 'La date du sinistre ne peut pas être dans le futur.';
    case 'INSURANCE_CONNECTION_CANNOT_DECLARE_CLAIMS':
      return "Cet assureur ne reçoit pas de déclarations par ce canal : déclarez le sinistre par votre canal habituel.";
    case 'INSURANCE_CLAIM_INDEMNITY_CONFLICT':
      return 'Ce dossier a déjà été indemnisé sous une autre référence.';
    case 'TENANT_MODULE_DISABLED':
      return "Ce type de connexion relève d'un module payant qui n'est pas activé pour votre institution (Paramétrage › Modules et abonnement).";
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
    case 'INSURANCE_CLAIM_NOT_FOUND':
      return "Ce dossier de sinistre n'existe pas, ou plus.";
    case 'INSURANCE_CLAIM_SETTLED':
      return 'Ce dossier est clos : il ne prend plus de pièce.';
    case 'INSURANCE_CLAIM_DOCUMENT_DUPLICATE':
      return 'Cette pièce est déjà au dossier — même fichier, même empreinte.';
    case 'INSURANCE_CLAIM_DOCUMENT_TOO_LARGE':
      return 'Cette pièce dépasse la taille acceptée.';
    case 'INSURANCE_CLAIM_DOCUMENT_CONTENT_TYPE_NOT_ALLOWED':
      return 'Ce type de fichier n’est pas accepté comme pièce de sinistre.';
    case 'INSURANCE_CLAIM_DOCUMENT_NOT_SCANNED':
      return "L'antivirus n'a pas encore validé cette pièce : elle ne peut pas être ouverte.";
    case 'INSURANCE_COMPLAINT_NOT_FOUND':
      return "Cette réclamation n'existe pas, ou plus.";
    case 'INSURANCE_COMPLAINT_ALREADY_CLOSED':
      return 'Cette réclamation est déjà répondue ou retirée : elle ne se rouvre pas.';
    case 'INSURANCE_COMPLAINT_RESOLUTION_REQUIRED':
      return 'Une réponse est obligatoire, même pour une réclamation non fondée.';
    case 'INSURANCE_COMPLAINT_ESCALATION_TARGET_REQUIRED':
      return "Nommez l'assureur ou l'autorité à qui le dossier est transmis.";
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
