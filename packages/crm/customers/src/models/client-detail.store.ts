import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, EMPTY, finalize, Observable, tap } from 'rxjs';
import { ClientDetailDto, ClientsApiService } from '@sankore/crm-api';
import { isReadOnlyStatus } from './client-labels';

/**
 * État de la fiche client courante, fourni par la coquille et consommé par les onglets.
 *
 * Le module Leads fait l'inverse : chaque onglet recharge le lead pour son compte, si
 * bien qu'une modification faite dans un onglet laisse l'en-tête et les autres onglets
 * sur des données périmées. Un store unique par fiche supprime la classe de bug entière,
 * et `version` — nécessaire au verrouillage optimiste des écritures — reste juste.
 */
@Injectable()
export class ClientDetailStore {
  private readonly _clientsApi = inject(ClientsApiService);

  private readonly _client = signal<ClientDetailDto | null>(null);
  private readonly _isLoading = signal(true);
  private readonly _notFound = signal(false);

  public readonly client = this._client.asReadonly();
  public readonly isLoading = this._isLoading.asReadonly();
  public readonly notFound = this._notFound.asReadonly();

  public readonly clientId = computed(() => this._client()?.id ?? null);

  /** Fusionnée ou archivée, la fiche ne se modifie plus : les onglets s'y réfèrent. */
  public readonly isReadOnly = computed(() => isReadOnlyStatus(this._client()?.status));

  /** Version courante, à passer aux écritures qui font du verrouillage optimiste. */
  public readonly version = computed(() => this._client()?.version ?? null);

  public load(clientId: string): void {
    this._isLoading.set(true);
    this._notFound.set(false);
    this._fetch(clientId).subscribe();
  }

  /**
   * Recharge sans repasser par l'état « chargement » : un onglet qui vient d'écrire
   * veut rafraîchir l'en-tête, pas faire clignoter la fiche entière.
   */
  public reload(): Observable<ClientDetailDto> {
    const id = this.clientId();
    if (!id) return EMPTY;
    return this._fetch(id);
  }

  /** Mise à jour locale après une écriture dont on connaît déjà le résultat. */
  public patch(changes: Partial<ClientDetailDto>): void {
    this._client.update((c) => (c ? { ...c, ...changes } : c));
  }

  private _fetch(clientId: string): Observable<ClientDetailDto> {
    return this._clientsApi.getClient(clientId).pipe(
      tap((client) => this._client.set(client)),
      catchError((error: { status?: number }) => {
        if (error?.status === 404) this._notFound.set(true);
        return EMPTY;
      }),
      finalize(() => this._isLoading.set(false)),
    );
  }
}
