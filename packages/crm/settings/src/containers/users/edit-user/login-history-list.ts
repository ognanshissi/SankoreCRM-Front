import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, EMPTY, finalize } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Button } from '@talisoft/ui/button';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { LoginHistoryDto, UsersApiService } from '@sankore/crm-api';

/** Valeur par défaut de `pageSize` au contrat. */
const PAGE_SIZE = 20;

const ABSOLUTE_DATE = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'medium',
});

/**
 * Ligne prête à afficher. `occuredAt` garde l'orthographe du contrat
 * (`LoginHistoryDto.occuredAt`, un seul « r ») : la corriger ici ne ferait que
 * masquer la faute de frappe côté serveur, où elle doit être réparée.
 */
interface LoginHistoryRow {
  key: string;
  occuredAt: string | null;
  /** Date absolue, posée en info-bulle sous la date relative. */
  absoluteDate: string;
  /** Renseignés ensemble : une seule des deux coordonnées ne situe rien. */
  coordinates: string | null;
  mapUrl: string | null;
}

/**
 * Historique de connexion, partagé par l'onglet « Connexions » de la fiche
 * utilisateur et par l'écran de sécurité du compte.
 *
 * `userId` renseigné  -> `GET /users/{userId}/login-history` (version admin).
 * `userId` absent     -> `GET /users/me/login-history` (utilisateur connecté,
 * aucun droit particulier requis).
 *
 * Ce que le contrat **ne** donne pas : ni adresse IP, ni navigateur, ni
 * appareil, ni indicateur de succès ou d'échec. L'écran n'affiche donc qu'une
 * date et, quand elles existent, des coordonnées — inventer les autres colonnes
 * avec des « — » laisserait croire que l'information est manquante alors
 * qu'elle n'est simplement pas produite.
 */
@Component({
  selector: 'user-login-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasCard, TasIcon, TasSpinner, Button, TimeagoPipe],
  template: `
    <tas-card class="block">
      <div class="p-4 border-b border-slate-100 flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <tas-icon
              iconName="feather:log-in"
              class="text-slate-400"
              style="font-size:14px"
            ></tas-icon>
            Historique de connexion
          </p>
          <p class="text-xs text-slate-400 mt-0.5">
            De la connexion la plus récente à la plus ancienne.
          </p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          @if (!loadError() && !isLoading() && rows().length > 0) {
            <!--
              Le service répond un tableau nu, sans total : on ne peut annoncer
              que ce qui est chargé, pas « x sur y ».
            -->
            <span class="text-xs text-slate-400 tabular-nums">
              {{ rows().length }} connexion{{ rows().length > 1 ? 's' : '' }} chargée{{
                rows().length > 1 ? 's' : ''
              }}
            </span>
          }
          <button
            tas-outlined-button
            type="button"
            [disabled]="isLoading() || isLoadingMore()"
            (click)="refresh()"
          >
            <tas-icon iconName="feather:refresh-cw" style="font-size:12px"></tas-icon>
            Rafraîchir
          </button>
        </div>
      </div>

      @if (isLoading()) {
        <div class="flex justify-center py-12">
          <tas-spinner size="8" class="text-primary"></tas-spinner>
        </div>
      } @else if (loadError()) {
        <!-- Une panne ne doit pas se lire « Aucune connexion enregistrée. » -->
        <div class="flex flex-col items-center py-12 text-center">
          <tas-icon
            iconName="feather:alert-triangle"
            class="text-functional-error mb-2"
            style="font-size:24px"
          ></tas-icon>
          <p class="text-sm text-slate-600">{{ errorMessage() }}</p>
          <p class="text-xs text-slate-400 mt-0.5">
            L'historique n'a pas pu être lu : il n'est pas forcément vide.
          </p>
          <button tas-outlined-button type="button" class="mt-3" (click)="refresh()">
            Réessayer
          </button>
        </div>
      } @else if (rows().length === 0) {
        <div class="flex flex-col items-center py-12 text-center">
          <tas-icon
            iconName="feather:log-in"
            class="text-slate-300 mb-2"
            style="font-size:24px"
          ></tas-icon>
          <p class="text-sm text-slate-400">Aucune connexion enregistrée.</p>
        </div>
      } @else {
        <div class="divide-y divide-slate-100">
          @for (row of rows(); track row.key) {
            <div class="flex items-center gap-3 px-4 py-3">
              <div
                class="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0"
              >
                <tas-icon iconName="feather:log-in" style="font-size:12px"></tas-icon>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm text-slate-800" [title]="row.absoluteDate">
                  {{ row.occuredAt | dateTimeAgo }}
                </p>
                @if (row.mapUrl) {
                  <a
                    class="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-0.5 tabular-nums"
                    [href]="row.mapUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <tas-icon iconName="feather:map-pin" style="font-size:11px"></tas-icon>
                    {{ row.coordinates }}
                  </a>
                }
              </div>
            </div>
          }
        </div>

        @if (hasMore()) {
          <div class="p-4 border-t border-slate-100 flex justify-center">
            @if (isLoadingMore()) {
              <tas-spinner size="5" class="text-primary"></tas-spinner>
            } @else {
              <button tas-outlined-button type="button" (click)="loadMore()">
                Charger plus
              </button>
            }
          </div>
        }
      }
    </tas-card>
  `,
})
export class LoginHistoryList {
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _snackbarService = inject(SnackbarService);

  /** Absent (ou vide) : l'historique de l'utilisateur connecté. */
  public readonly userId = input<string | null>(null);

  public isLoading = signal(true);
  public isLoadingMore = signal(false);
  /** Distingue « aucune connexion » de « l'appel a échoué ». */
  public loadError = signal(false);
  public errorMessage = signal('Le chargement de l\'historique a échoué.');
  public hasMore = signal(false);

  private readonly _entries = signal<LoginHistoryDto[]>([]);
  private _page = 1;

  public readonly rows = computed<LoginHistoryRow[]>(() =>
    // Le contrat ne promet aucun ordre : « Returns a user's login history », sans
    // plus. Le tri décroissant est donc garanti ici, sinon l'ordre de la colonne
    // dépendrait de l'implémentation du serveur — et la concaténation des pages
    // pourrait le défaire même si le serveur triait.
    [...this._entries()]
      .sort((a, b) => this._timestamp(b.occuredAt) - this._timestamp(a.occuredAt))
      .map((entry, index) => {
        const at = this._timestamp(entry.occuredAt);
        const hasCoordinates =
          entry.latitude !== null &&
          entry.latitude !== undefined &&
          entry.longitude !== null &&
          entry.longitude !== undefined;

        return {
          key: entry.id ?? `${entry.occuredAt ?? ''}-${index}`,
          occuredAt: entry.occuredAt ?? null,
          absoluteDate: at === 0 ? 'Date inconnue' : ABSOLUTE_DATE.format(at),
          coordinates: hasCoordinates
            ? `${entry.latitude!.toFixed(5)}, ${entry.longitude!.toFixed(5)}`
            : null,
          // Aucune librairie de cartographie n'est installée dans ce dépôt : le
          // lien part vers une carte externe plutôt que d'embarquer un rendu.
          mapUrl: hasCoordinates
            ? `https://www.google.com/maps?q=${entry.latitude},${entry.longitude}`
            : null,
        };
      }),
  );

  constructor() {
    effect(() => {
      // Recharge quand la fiche affichée change d'utilisateur.
      this.userId();
      this.refresh();
    });
  }

  public refresh(): void {
    this._page = 1;
    this._load(true);
  }

  public loadMore(): void {
    if (this.isLoadingMore() || !this.hasMore()) return;
    this._page++;
    this._load(false);
  }

  private _load(reset: boolean): void {
    if (reset) {
      this.isLoading.set(true);
      this.loadError.set(false);
    } else {
      this.isLoadingMore.set(true);
    }

    const userId = this.userId();
    const request$ = userId
      ? this._usersApiService.getUserLoginHistory(userId, this._page, PAGE_SIZE)
      : this._usersApiService.getMyLoginHistory(this._page, PAGE_SIZE);

    request$
      .pipe(
        catchError((err: HttpErrorResponse) => {
          // Le 404 du contrat vise l'utilisateur, pas l'historique : le dire
          // évite de faire chercher une panne réseau.
          const message =
            err.status === 404 && userId
              ? "Cet utilisateur n'existe plus : son historique est introuvable."
              : (err.error?.detail ??
                "Le chargement de l'historique de connexion a échoué.");
          this._snackbarService.error('Erreur', message);

          if (reset) {
            this.errorMessage.set(message);
            this.loadError.set(true);
            this._entries.set([]);
            this.hasMore.set(false);
          } else {
            // Sans ce retour en arrière, le clic suivant sur « Charger plus »
            // sauterait silencieusement la page qui vient d'échouer.
            this._page = Math.max(1, this._page - 1);
          }
          return EMPTY;
        }),
        finalize(() => {
          this.isLoading.set(false);
          this.isLoadingMore.set(false);
        }),
      )
      .subscribe((items: LoginHistoryDto[]) => {
        const page = items ?? [];
        this._entries.update((previous) => (reset ? page : [...previous, ...page]));
        // Le service répond un tableau nu, sans `totalCount` ni `hasNextPage` :
        // une page pleine est le seul indice qu'il reste peut-être une suite.
        this.hasMore.set(page.length === PAGE_SIZE);
      });
  }

  private _timestamp(value: string | null | undefined): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}
