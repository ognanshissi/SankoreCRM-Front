import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, EMPTY, finalize, Observable, of, tap } from 'rxjs';
import {
  ClientHouseholdApiService,
  ClientHouseholdDto,
  CustomersHouseholdMemberDto,
} from '@sankore/crm-api';
import { identityLabel } from '@sankore/crm/common';

/**
 * Foyer du client courant, fourni par la coquille de la fiche à côté de
 * `ClientDetailStore`.
 *
 * Deux onglets en dépendent et pour des raisons différentes : l'onglet Foyer
 * l'édite, et la souscription (BNF-F-11) y puise la liste des personnes à cocher
 * comme bénéficiaires — « ne jamais ressaisir une personne déjà connue ». Les
 * laisser charger chacun de leur côté ferait qu'un membre ajouté dans l'onglet
 * Foyer n'apparaîtrait dans le parcours de souscription qu'après un rechargement
 * complet de la page.
 *
 * `includeRemoved` est toujours vrai : les membres retirés restent visibles dans
 * l'historique, et c'est le store qui sépare actifs et retirés.
 */
@Injectable()
export class ClientHouseholdStore {
  private readonly _householdApi = inject(ClientHouseholdApiService);

  private readonly _clientId = signal<string | null>(null);
  private readonly _household = signal<ClientHouseholdDto | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _loadFailed = signal(false);

  public readonly household = this._household.asReadonly();
  public readonly isLoading = this._isLoading.asReadonly();
  public readonly loadFailed = this._loadFailed.asReadonly();

  /**
   * `canEdit` est décidé par l'API (BNF-B-13) : le front affiche les actions
   * autorisées qu'on lui renvoie, il ne rejoue pas la règle d'habilitation.
   */
  public readonly canEdit = computed(() => this._household()?.canEdit === true);

  public readonly maxChildren = computed(() => this._household()?.maxChildren ?? null);

  public readonly principal = computed(() => this._household()?.principal ?? null);
  public readonly principalLabel = computed(() => identityLabel(this.principal()));

  public readonly members = computed<CustomersHouseholdMemberDto[]>(
    () => (this._household()?.members ?? []).filter((m) => m.isActive !== false),
  );

  public readonly removedMembers = computed<CustomersHouseholdMemberDto[]>(
    () => (this._household()?.members ?? []).filter((m) => m.isActive === false),
  );

  public readonly activeSpouse = computed(
    () => this.members().find((m) => m.type === 'Spouse') ?? null,
  );

  public readonly hasPepExposure = computed(() => this._household()?.hasPepExposure === true);

  /** Membres issus de la conversion d'un lead — mention « Repris du lead » (BNF-F-09). */
  public readonly isFromLead = (member: CustomersHouseholdMemberDto): boolean =>
    !!member.sourceLeadMemberId;

  public load(clientId: string): void {
    if (this._clientId() === clientId && this._household() !== null) return;
    this._clientId.set(clientId);
    this._isLoading.set(true);
    this._loadFailed.set(false);
    this._fetch(clientId)
      .pipe(finalize(() => this._isLoading.set(false)))
      .subscribe();
  }

  /** Rechargement silencieux après écriture, sans faire clignoter l'onglet. */
  public reload(): Observable<ClientHouseholdDto | null> {
    const id = this._clientId();
    return id ? this._fetch(id) : EMPTY;
  }

  private _fetch(clientId: string): Observable<ClientHouseholdDto | null> {
    return this._householdApi.getClientHousehold(clientId, true).pipe(
      tap((dto) => this._household.set(dto)),
      catchError(() => {
        this._loadFailed.set(true);
        return of(null);
      }),
    );
  }
}
