import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { catchError, EMPTY, of } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import {
  ClientLifecycleApiService,
  ClientStatusHistoryDto,
  UsersApiService,
} from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { ClientDetailStore } from '../../models/client-detail.store';
import {
  clientStatusLabel,
  clientStatusSeverity,
  kycStatusLabel,
  kycStatusSeverity,
  riskLevelLabel,
  riskLevelSeverity,
} from '../../models/client-labels';

/**
 * Acteur SYSTEM : le contrat le décrit comme « the SYSTEM actor (all-zero GUID) » pour les
 * transitions déclenchées par un évènement KYC entrant. On compare donc au GUID nul plutôt
 * qu'à la chaîne « SYSTEM », que le serveur n'envoie jamais dans ce champ `uuid`.
 */
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

const HISTORY_PAGE_SIZE = 20;

interface HistoryRow {
  id: string;
  oldStatusLabel: string;
  oldStatusSeverity: Severity;
  newStatusLabel: string;
  newStatusSeverity: Severity;
  reason: string | null;
  actorUserId: string | null;
  isSystem: boolean;
  occurredAt: string | null;
}

@Component({
  selector: 'client-kyc',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, TasCard, TasIcon, TasSpinner, TasTag, Button],
  template: `
    @if (client()) {
      <div class="flex flex-col gap-4">
        <!-- Dossier KYC -->
        <tas-card class="block">
          <div class="p-4">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h2 class="text-sm font-semibold text-slate-900">Dossier KYC</h2>
                <p class="text-xs text-slate-500 mt-0.5">
                  Conformité et niveau de risque du client.
                </p>
              </div>

              <!--
                Le dossier complet vit dans le module M02, qui n'est pas livré. Le bouton est
                présent mais désactivé : le retirer laisserait croire que le lien n'existe pas.
                L'info-bulle est portée par le conteneur, parce qu'un bouton désactivé ne reçoit
                pas d'évènement de souris dans plusieurs navigateurs.
              -->
              <span
                class="inline-block"
                title="Le module KYC (M02) n'est pas encore disponible : le dossier détaillé s'ouvrira depuis cette fiche dès sa livraison."
              >
                <button tas-outlined-button type="button" [disabled]="true">
                  <tas-icon iconName="feather:folder" style="font-size:14px"></tas-icon>
                  Ouvrir le dossier KYC
                </button>
              </span>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 mt-4 pt-4 border-t border-slate-100">
              <div>
                <p class="text-xs text-slate-400 mb-1">Statut KYC</p>
                <tas-tag [severity]="kycSeverity()">{{ kycLabel() }}</tas-tag>
              </div>
              <div>
                <p class="text-xs text-slate-400 mb-1">Niveau de risque</p>
                <tas-tag [severity]="riskSeverity()">{{ riskLabel() }}</tas-tag>
              </div>
              <div>
                <p class="text-xs text-slate-400 mb-1">Dernière mise à jour</p>
                <p class="text-sm font-medium text-slate-800">
                  {{ lastUpdatedAt() ? (lastUpdatedAt() | date: 'dd/MM/yyyy à HH:mm') : '—' }}
                </p>
                <p class="text-xs text-slate-400 mt-0.5">{{ lastUpdatedSource() }}</p>
              </div>
            </div>

            @if (rejectionReason()) {
              <div class="flex items-start gap-3 mt-4 p-3 rounded-lg border border-red-200 bg-red-50">
                <tas-icon
                  iconName="feather:x-circle"
                  class="text-functional-error mt-0.5"
                  style="font-size:16px"
                ></tas-icon>
                <div class="text-sm">
                  <p class="font-medium text-red-900">Motif du rejet</p>
                  <p class="text-red-800">{{ rejectionReason() }}</p>
                </div>
              </div>
            }
          </div>
        </tas-card>

        <!-- Historique des statuts -->
        <tas-card class="block">
          <div class="p-4">
            <div class="flex items-center justify-between gap-4">
              <div>
                <h2 class="text-sm font-semibold text-slate-900">Historique des statuts</h2>
                <p class="text-xs text-slate-500 mt-0.5">
                  Chaque transition, du plus récent au plus ancien.
                </p>
              </div>
              @if (isLoadingHistory() && rows().length > 0) {
                <tas-spinner size="4" class="text-primary"></tas-spinner>
              }
            </div>

            @if (!canRead()) {
              <p class="text-sm text-slate-500 mt-4">
                Vous n'avez pas le droit de consulter l'historique de ce client.
              </p>
            } @else if (isLoadingHistory() && rows().length === 0) {
              <div class="flex justify-center py-10">
                <tas-spinner size="8" class="text-primary"></tas-spinner>
              </div>
            } @else if (historyError()) {
              <div class="py-8 text-center">
                <p class="text-sm text-slate-600">{{ historyError() }}</p>
                <button tas-outlined-button type="button" class="mt-3" (click)="reloadHistory()">
                  <tas-icon iconName="feather:refresh-cw" style="font-size:14px"></tas-icon>
                  Réessayer
                </button>
              </div>
            } @else if (rows().length === 0) {
              <div class="py-10 text-center">
                <tas-icon
                  iconName="feather:clock"
                  class="text-slate-300 mb-2"
                  style="font-size:24px"
                ></tas-icon>
                <p class="text-sm text-slate-500">Aucune transition de statut enregistrée.</p>
              </div>
            } @else {
              <ul class="mt-4 divide-y divide-slate-100">
                @for (row of rows(); track row.id) {
                  <li class="py-3 flex flex-col gap-1.5">
                    <div class="flex items-center gap-2 flex-wrap">
                      <tas-tag [severity]="row.oldStatusSeverity">{{ row.oldStatusLabel }}</tas-tag>
                      <tas-icon
                        iconName="feather:arrow-right"
                        class="text-slate-400"
                        style="font-size:12px"
                      ></tas-icon>
                      <tas-tag [severity]="row.newStatusSeverity">{{ row.newStatusLabel }}</tas-tag>
                    </div>

                    @if (row.reason) {
                      <p class="text-sm text-slate-700">{{ row.reason }}</p>
                    } @else {
                      <p class="text-sm text-slate-400">Aucun motif enregistré</p>
                    }

                    <div class="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                      <span class="flex items-center gap-1">
                        <tas-icon
                          [iconName]="row.isSystem ? 'feather:cpu' : 'feather:user'"
                          class="text-slate-400"
                          style="font-size:11px"
                        ></tas-icon>
                        {{ actorLabel(row) }}
                      </span>
                      <span class="tabular-nums">
                        {{ row.occurredAt ? (row.occurredAt | date: 'dd/MM/yyyy à HH:mm') : '—' }}
                      </span>
                    </div>
                  </li>
                }
              </ul>

              @if (hasNextPage()) {
                <div class="flex justify-center mt-3">
                  <button
                    tas-outlined-button
                    type="button"
                    [disabled]="isLoadingHistory()"
                    (click)="loadMore()"
                  >
                    @if (isLoadingHistory()) {
                      <tas-spinner size="3" class="text-primary"></tas-spinner>
                    }
                    Afficher les transitions plus anciennes
                  </button>
                </div>
              }
            }
          </div>
        </tas-card>
      </div>
    }
  `,
})
export class ClientKycPage {
  protected readonly store = inject(ClientDetailStore);
  private readonly _lifecycleApi = inject(ClientLifecycleApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _permissions = inject(PermissionsService);

  public readonly canRead = this._permissions.can('customers:read');

  protected readonly client = this.store.client;

  protected readonly kycLabel = computed(() => kycStatusLabel(this.client()?.kycStatus));
  protected readonly kycSeverity = computed<Severity>(() =>
    kycStatusSeverity(this.client()?.kycStatus),
  );
  protected readonly riskLabel = computed(() => riskLevelLabel(this.client()?.riskLevel));
  protected readonly riskSeverity = computed<Severity>(() =>
    riskLevelSeverity(this.client()?.riskLevel),
  );
  protected readonly rejectionReason = computed(
    () => this.client()?.kycRejectionReason?.trim() || null,
  );

  protected readonly isLoadingHistory = signal(false);
  protected readonly historyError = signal<string | null>(null);
  protected readonly hasNextPage = signal(false);

  private readonly _history = signal<ClientStatusHistoryDto[]>([]);
  private readonly _page = signal(1);

  /** Noms des acteurs, résolus une fois par identifiant : l'historique répète les mêmes. */
  private readonly _actorNames = signal<Record<string, string>>({});
  private readonly _resolvingActors = new Set<string>();

  /**
   * Le contrat ne porte aucune date propre au KYC (`ClientDetailDto` n'a que `kycStatus` et
   * `kycRejectionReason`). La date affichée vient donc de la transition de statut la plus
   * récente quand il en existe une, et retombe sur `updatedAt` de la fiche sinon. La source
   * est indiquée à l'écran pour qu'on ne lise pas une date de fiche comme une date de KYC.
   */
  protected readonly lastUpdatedAt = computed(() => {
    const latest = this._history()[0]?.occurredAt;
    return latest ?? this.client()?.updatedAt ?? null;
  });

  protected readonly lastUpdatedSource = computed(() =>
    this._history()[0]?.occurredAt
      ? 'Dernière transition de statut'
      : 'Dernière modification de la fiche',
  );

  protected readonly rows = computed<HistoryRow[]>(() =>
    this._history().map((item, index) => ({
      id: item.id ?? `${item.occurredAt ?? ''}-${index}`,
      oldStatusLabel: clientStatusLabel(item.oldStatus),
      oldStatusSeverity: clientStatusSeverity(item.oldStatus),
      newStatusLabel: clientStatusLabel(item.newStatus),
      newStatusSeverity: clientStatusSeverity(item.newStatus),
      reason: item.reason?.trim() || null,
      actorUserId: item.actorUserId ?? null,
      isSystem: !item.actorUserId || item.actorUserId === SYSTEM_ACTOR_ID,
      occurredAt: item.occurredAt ?? null,
    })),
  );

  constructor() {
    effect(() => {
      const clientId = this.store.clientId();
      if (!clientId || !this.canRead()) return;
      this._reset();
      this._fetch(clientId, 1);
    });
  }

  protected actorLabel(row: HistoryRow): string {
    if (row.isSystem) return 'Système';
    const id = row.actorUserId as string;
    return this._actorNames()[id] ?? 'Utilisateur inconnu';
  }

  public reloadHistory(): void {
    const clientId = this.store.clientId();
    if (!clientId) return;
    this._reset();
    this._fetch(clientId, 1);
  }

  public loadMore(): void {
    const clientId = this.store.clientId();
    if (!clientId || this.isLoadingHistory()) return;
    this._fetch(clientId, this._page() + 1);
  }

  private _reset(): void {
    this._history.set([]);
    this._page.set(1);
    this.hasNextPage.set(false);
    this.historyError.set(null);
  }

  private _fetch(clientId: string, page: number): void {
    this.isLoadingHistory.set(true);
    this.historyError.set(null);

    this._lifecycleApi
      .getClientStatusHistory(clientId, page, HISTORY_PAGE_SIZE)
      .pipe(
        catchError(() => {
          this.historyError.set("L'historique des statuts n'a pas pu être chargé.");
          this.isLoadingHistory.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        const items = result.items ?? [];
        this._history.update((current) => (page === 1 ? items : [...current, ...items]));
        this._page.set(result.page ?? page);
        this.hasNextPage.set(result.hasNextPage ?? false);
        this.isLoadingHistory.set(false);
        this._resolveActors(items);
      });
  }

  private _resolveActors(items: ClientStatusHistoryDto[]): void {
    const known = this._actorNames();
    const pending = new Set(
      items
        .map((item) => item.actorUserId)
        .filter(
          (id): id is string =>
            !!id && id !== SYSTEM_ACTOR_ID && !known[id] && !this._resolvingActors.has(id),
        ),
    );

    for (const id of pending) {
      this._resolvingActors.add(id);
      this._usersApi
        .getUser(id)
        .pipe(catchError(() => of(null)))
        .subscribe((user) => {
          const name = user?.fullName || user?.email;
          if (name) {
            this._actorNames.update((current) => ({ ...current, [id]: name }));
          }
        });
    }
  }
}

export default ClientKycPage;
