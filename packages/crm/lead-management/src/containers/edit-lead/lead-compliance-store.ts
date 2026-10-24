import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, EMPTY, finalize, forkJoin, Observable, of, tap } from 'rxjs';
import {
  ConsentDto,
  LeadCompletenessDto,
  LeadFatcaDto,
  LeadHouseholdDto,
  LeadsApiService,
  LeadsHouseholdMemberDto,
} from '@sankore/crm-api';
import { identityLabel } from '@sankore/crm/common';

/**
 * État « foyer et conformité » du lead courant, fourni par la
 * route `leads/:id` à côté de `LeadEditContext`.
 *
 * Il existe parce que ces quatre ressources sont lues par plusieurs onglets **et**
 * par l'en-tête : l'en-tête a besoin de l'exposition PPE et du statut FATCA, la
 * jauge de complétude est posée en tête de l'onglet Identité comme dans le
 * contrôle avant conversion. Sans état partagé, chaque onglet referait les mêmes
 * appels et afficherait sa propre version de la même vérité — c'est exactement la
 * divergence que `ClientDetailStore` est venu supprimer côté clients.
 *
 * Aucune règle métier ici : la complétude, `canConvert` et le statut FATCA sont
 * calculés par l'API. Le store ne fait que les transporter.
 */
@Injectable()
export class LeadComplianceStore {
  private readonly _leadsApi = inject(LeadsApiService);

  private readonly _leadId = signal<string | null>(null);

  private readonly _household = signal<LeadHouseholdDto | null>(null);
  private readonly _completeness = signal<LeadCompletenessDto | null>(null);
  private readonly _fatca = signal<LeadFatcaDto | null>(null);
  private readonly _consents = signal<ConsentDto[]>([]);

  private readonly _isLoading = signal(true);
  private readonly _loadFailed = signal(false);

  public readonly leadId = this._leadId.asReadonly();
  public readonly household = this._household.asReadonly();
  public readonly completeness = this._completeness.asReadonly();
  public readonly fatca = this._fatca.asReadonly();
  public readonly consents = this._consents.asReadonly();
  public readonly isLoading = this._isLoading.asReadonly();
  public readonly loadFailed = this._loadFailed.asReadonly();

  // `householdEnabled` a été retiré : le foyer se saisit sur n'importe quel lead. Le serveur
  // refusait l'écriture avec HOUSEHOLD_DISABLED_FOR_PRODUCT_LINE et la ligne ci-dessus masquait
  // l'écran en conséquence — mais `BeneficiaryPolicy.HouseholdEnabled` vaut FALSE par défaut, donc
  // toute ligne de produit enregistrée sans cocher la case refusait un conjoint que personne
  // n'avait voulu interdire. Ne réintroduis pas de condition de produit ici : `maxChildren` et
  // `childMaxAge` restent les seules règles du produit, et elles sont appliquées à l'écriture.

  public readonly principal = computed(() => this._household()?.principal ?? null);
  public readonly principalLabel = computed(() => identityLabel(this.principal()));

  public readonly members = computed<LeadsHouseholdMemberDto[]>(
    () => (this._household()?.members ?? []).filter((m) => m.isActive !== false),
  );

  /** Les membres retirés restent visibles dans l'historique (BNF-F-03). */
  public readonly removedMembers = computed<LeadsHouseholdMemberDto[]>(
    () => (this._household()?.members ?? []).filter((m) => m.isActive === false),
  );

  public readonly activeSpouse = computed(
    () => this.members().find((m) => m.type === 'Spouse') ?? null,
  );
  public readonly children = computed(() => this.members().filter((m) => m.type === 'Child'));

  public readonly hasPepExposure = computed(() => this._household()?.hasPepExposure === true);

  public readonly fatcaEnabled = computed(() => this._fatca()?.enabled === true);

  /**
   * Statut FATCA du principal, c'est-à-dire celui que porte l'en-tête. Les
   * déclarations superseded sont ignorées : seule la déclaration active compte.
   */
  public readonly principalFatcaStatus = computed(() => {
    const declarations = this._fatca()?.declarations ?? [];
    const principal = declarations.find(
      (d) => d.subjectType === 'Principal' && d.isActive !== false,
    );
    return principal?.status ?? null;
  });

  public readonly canConvert = computed(() => this._completeness()?.canConvert === true);

  public load(leadId: string): void {
    if (this._leadId() === leadId && !this._isLoading()) return;
    this._leadId.set(leadId);
    this._isLoading.set(true);
    this._loadFailed.set(false);

    // `forkJoin` et non quatre souscriptions : un onglet qui s'ouvre doit savoir
    // d'un coup s'il a tout, sinon il affiche une moitié de dossier comme s'il
    // était complet. Chaque appel retombe sur `null` pour que l'échec d'une
    // ressource — FATCA désactivé pour le tenant, par exemple — n'emporte pas
    // les trois autres.
    forkJoin({
      household: this._fetchHousehold(leadId),
      completeness: this._fetchCompleteness(leadId),
      fatca: this._fetchFatca(leadId),
    })
      .pipe(finalize(() => this._isLoading.set(false)))
      .subscribe((result) => {
        const everythingFailed = !result.household && !result.completeness && !result.fatca;
        this._loadFailed.set(everythingFailed);
      });
  }

  public reloadHousehold(): Observable<LeadHouseholdDto | null> {
    const id = this._leadId();
    return id ? this._fetchHousehold(id) : EMPTY;
  }

  public reloadCompleteness(): Observable<LeadCompletenessDto | null> {
    const id = this._leadId();
    return id ? this._fetchCompleteness(id) : EMPTY;
  }

  public reloadFatca(): Observable<LeadFatcaDto | null> {
    const id = this._leadId();
    return id ? this._fetchFatca(id) : EMPTY;
  }

  public reloadConsents(): Observable<ConsentDto[]> {
    const id = this._leadId();
    if (!id) return EMPTY;
    return this._leadsApi.listConsents(id).pipe(
      tap((consents) => this._consents.set(consents ?? [])),
      catchError(() => of([] as ConsentDto[])),
    );
  }

  /**
   * À appeler après toute écriture : le foyer, la PPE et FATCA alimentent tous
   * la même jauge, et un 200 sur une section rend périmé le reste
   * de la fiche. Le rechargement est silencieux, sans état « chargement ».
   */
  public reloadAfterWrite(): void {
    this.reloadHousehold().subscribe();
    this.reloadCompleteness().subscribe();
  }

  private _fetchHousehold(leadId: string): Observable<LeadHouseholdDto | null> {
    return this._leadsApi.getLeadHousehold(leadId).pipe(
      tap((dto) => this._household.set(dto)),
      catchError(() => of(null)),
    );
  }

  private _fetchCompleteness(leadId: string): Observable<LeadCompletenessDto | null> {
    return this._leadsApi.getLeadCompleteness(leadId).pipe(
      tap((dto) => this._completeness.set(dto)),
      catchError(() => of(null)),
    );
  }

  private _fetchFatca(leadId: string): Observable<LeadFatcaDto | null> {
    return this._leadsApi.getLeadFatcaDeclarations(leadId).pipe(
      tap((dto) => this._fatca.set(dto)),
      catchError(() => of(null)),
    );
  }
}
