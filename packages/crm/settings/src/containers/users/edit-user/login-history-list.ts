import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { PageEvent } from '@angular/material/paginator';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { LoginHistoryDto, UsersApiService } from '@sankore/crm-api';

/** Valeur par défaut de `pageSize` au contrat. */
const PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [10, 20, 50];

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
  /** « Chrome 141 · Windows », assemblé avec les seuls champs renseignés. */
  device: string | null;
  /** `userAgent` brut, réservé à l'info-bulle : trop long pour la ligne. */
  userAgent: string | null;
  clientKind: string | null;
  ipAddress: string | null;
  icon: string;
}

/**
 * Historique de connexion, partagé par l'onglet « Connexions » de la fiche
 * utilisateur et par l'écran de sécurité du compte.
 *
 * `userId` renseigné  -> `GET /users/{userId}/login-history` (version admin).
 * `userId` absent     -> `GET /users/me/login-history` (utilisateur connecté,
 * aucun droit particulier requis).
 *
 * Outre la date et les coordonnées, le contrat donne l'origine technique de la
 * connexion : `ipAddress`, `userAgent`, `browser`, `browserVersion`, `platform`
 * et `clientKind`. Tous sont `nullable`, et `clientKind` est une chaîne libre —
 * aucune énumération n'est déclarée. Chaque ligne n'affiche donc que ce que le
 * serveur a réellement renseigné : un « — » de remplissage ferait passer pour
 * manquante une information qui n'est simplement pas produite.
 *
 * Ce que le contrat **ne** donne toujours pas : un indicateur de succès ou
 * d'échec. L'écran ne préjuge donc pas de l'issue des connexions listées.
 *
 * Le rendu passe par `tas-table` bien qu'il ressemble à une pile de cartes :
 * c'est la règle du projet pour toute liste. Le `ng-template #body` produit une
 * ligne d'une seule cellule, et l'absence de `#header` supprime l'en-tête —
 * `tas-table` n'impose aucune apparence, il apporte la pagination, l'état de
 * chargement et l'état vide.
 *
 * Pagination : les pages serveur sont **accumulées**, et `[data]` reçoit tout ce
 * qui est chargé. C'est imposé par `TableDataSource.getPagedData()`, qui découpe
 * toujours `data` par `pageIndex * pageSize` — y compris quand la configuration
 * annonce `serverSide: true`. Ne lui passer que la page courante afficherait une
 * page 2 vide (elle irait chercher les lignes 20 à 40 d'un tableau qui n'en
 * compte que 20). `serverSide: true` est conservé pour deux raisons : c'est la
 * seule façon de recevoir `pageEventChange`, et la longueur annoncée au
 * paginateur vient alors de `totalElements`, que ce composant maîtrise.
 */
@Component({
  selector: 'user-login-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasCard, TasIcon, Button, TasTable, TimeagoPipe],
  template: `
    <div class="flex flex-col gap-3">
      <div class="flex items-start justify-between gap-3">
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
        <button
          tas-outlined-button
          type="button"
          class="shrink-0"
          [disabled]="isLoading()"
          (click)="reload()"
        >
          <tas-icon iconName="feather:refresh-cw" style="font-size:12px"></tas-icon>
          Rafraîchir
        </button>
      </div>

      @if (loadError()) {
        <!--
          La table affiche « Aucun élément trouvé » sur une liste vide : elle ne
          distingue pas une panne d'un historique vide. L'erreur prend donc sa
          place au lieu de s'afficher au-dessus d'une table trompeuse.
        -->
        <tas-card class="block">
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
            <button tas-outlined-button type="button" class="mt-3" (click)="reload()">
              Réessayer
            </button>
          </div>
        </tas-card>
      } @else {
        <tas-table
          [data]="rows()"
          identifierField="key"
          [config]="tableConfig()"
          [isLoading]="isLoading()"
          (pageEventChange)="onPageChange($event)"
        >
          <ng-template #body let-row>
            <tr>
              <td class="whitespace-normal">
                <div class="flex items-start gap-3">
                  <div
                    class="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0"
                  >
                    <tas-icon [iconName]="row.icon" style="font-size:12px"></tas-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <p class="text-sm text-slate-800" [title]="row.absoluteDate">
                        {{ row.occuredAt | dateTimeAgo }}
                      </p>
                      @if (row.clientKind) {
                        <span
                          class="text-[10px] font-medium uppercase tracking-wide text-slate-500 bg-slate-100 rounded px-1.5 py-0.5"
                        >
                          {{ row.clientKind }}
                        </span>
                      }
                    </div>

                    @if (row.device) {
                      <!--
                        Le user-agent brut part en info-bulle : illisible sur une
                        ligne, mais c'est lui qu'on demande au support quand la
                        version analysée par le serveur est douteuse.
                      -->
                      <p
                        class="text-xs text-slate-500 mt-0.5 truncate"
                        [title]="row.userAgent ?? row.device"
                      >
                        {{ row.device }}
                      </p>
                    }

                    @if (row.ipAddress || row.mapUrl) {
                      <div class="flex items-center gap-3 flex-wrap mt-0.5">
                        @if (row.ipAddress) {
                          <span
                            class="text-xs text-slate-400 tabular-nums inline-flex items-center gap-1"
                          >
                            <tas-icon
                              iconName="feather:wifi"
                              style="font-size:11px"
                            ></tas-icon>
                            {{ row.ipAddress }}
                          </span>
                        }
                        @if (row.mapUrl) {
                          <a
                            class="text-xs text-primary hover:underline inline-flex items-center gap-1 tabular-nums"
                            [href]="row.mapUrl"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <tas-icon
                              iconName="feather:map-pin"
                              style="font-size:11px"
                            ></tas-icon>
                            {{ row.coordinates }}
                          </a>
                        }
                      </div>
                    }
                  </div>
                </div>
              </td>
            </tr>
          </ng-template>
        </tas-table>
      }
    </div>
  `,
})
export class LoginHistoryList {
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _snackbarService = inject(SnackbarService);

  /** Absent (ou vide) : l'historique de l'utilisateur connecté. */
  public readonly userId = input<string | null>(null);

  public isLoading = signal(true);
  /** Distingue « aucune connexion » de « l'appel a échoué ». */
  public loadError = signal(false);
  public errorMessage = signal('Le chargement de l\'historique a échoué.');

  public tableConfig = signal<TableConfig>(
    LoginHistoryList.paginationConfig(0, PAGE_SIZE, 0),
  );

  /**
   * Page affichée, doublée en champs ordinaires : `reload()` part d'un `effect`,
   * où toute lecture de `tableConfig` rouvrirait une dépendance sur un signal
   * que la même fonction écrit.
   */
  private _pageIndex = 0;
  private _pageSize = PAGE_SIZE;

  private readonly _entries = signal<LoginHistoryDto[]>([]);
  /** Nombre de pages serveur déjà accumulées dans `_entries`. */
  private _loadedPages = 0;
  /** Faux dès qu'une page serveur revient incomplète : il n'y a plus rien après. */
  private _hasMore = true;
  /**
   * Garde de ré-entrance, en champ ordinaire et non en signal : il est lu dans
   * le `next` d'une requête pour décider d'enchaîner, avant que le flux soit
   * terminé. Un signal `isLoading` y serait encore à `true` et couperait la
   * chaîne au premier appel.
   */
  private _isFetching = false;

  public readonly rows = computed<LoginHistoryRow[]>(() =>
    // Le contrat ne promet aucun ordre : « Returns a user's login history », sans
    // plus. Le tri décroissant est donc garanti ici, sinon l'ordre de la liste
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
          device: this._deviceLabel(entry),
          userAgent: entry.userAgent?.trim() || null,
          clientKind: entry.clientKind?.trim() || null,
          ipAddress: entry.ipAddress?.trim() || null,
          icon: this._icon(entry),
        };
      }),
  );

  constructor() {
    effect(() => {
      // Recharge quand la fiche affichée change d'utilisateur — et seulement
      // là. `reload()` lit et écrit `tableConfig` et `_entries` : sans
      // `untracked`, l'effet se déclencherait sur ses propres écritures et
      // boucherait indéfiniment.
      this.userId();
      untracked(() => this.reload());
    });
  }

  /** Repart de zéro : vide l'accumulation et recharge la première page. */
  public reload(): void {
    this._entries.set([]);
    this._loadedPages = 0;
    this._hasMore = true;
    this._pageIndex = 0;
    this.loadError.set(false);
    this._setPagination(0, this._pageSize, 0);
    this._ensureLoaded(this._pageSize);
  }

  public onPageChange(event: PageEvent): void {
    this._pageIndex = event.pageIndex;
    this._pageSize = event.pageSize;
    this._setPagination(event.pageIndex, event.pageSize, this._boundedTotal());
    // Le paginateur peut viser plus loin que ce qui est chargé : la longueur
    // qu'on lui annonce est volontairement optimiste d'une ligne (cf.
    // `_boundedTotal`). On complète alors l'accumulation.
    this._ensureLoaded((event.pageIndex + 1) * event.pageSize);
  }

  /**
   * Charge des pages serveur jusqu'à couvrir `targetCount` lignes, ou jusqu'à
   * épuisement de l'historique. Les pages du serveur (`PAGE_SIZE`) et celles du
   * paginateur (`pageSize`, réglable) n'ont pas la même taille : il faut donc
   * parfois plusieurs appels pour remplir une page affichée.
   */
  private _ensureLoaded(targetCount: number): void {
    if (!this._hasMore || this._isFetching) return;
    if (this._entries().length >= targetCount) return;
    this._loadPage(this._loadedPages + 1, targetCount);
  }

  private _loadPage(page: number, targetCount: number): void {
    this._isFetching = true;
    this.isLoading.set(true);

    const userId = this.userId();
    const request$ = userId
      ? this._usersApiService.getUserLoginHistory(userId, page, PAGE_SIZE)
      : this._usersApiService.getMyLoginHistory(page, PAGE_SIZE);

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

          // Une page suivante qui échoue ne doit pas effacer ce qui est déjà
          // lisible : l'écran d'erreur ne remplace la table que si l'historique
          // n'a jamais pu être chargé.
          if (this._loadedPages === 0) {
            this.errorMessage.set(message);
            this.loadError.set(true);
            this._entries.set([]);
          }
          // Sans ce garde-fou, chaque changement de page relancerait la requête
          // qui vient d'échouer.
          this._hasMore = false;
          this._isFetching = false;
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((items: LoginHistoryDto[]) => {
        const received = items ?? [];
        this._loadedPages = page;
        // Une page incomplète est la fin de l'historique : le service répond un
        // tableau nu, sans `totalCount` ni `hasNextPage`, c'est le seul indice
        // disponible.
        this._hasMore = received.length === PAGE_SIZE;
        this._entries.update((previous) => [...previous, ...received]);

        // La longueur annoncée est optimiste d'une ligne : le paginateur a donc
        // pu emmener sur une page qui n'existe pas. On revient alors à la
        // dernière page réelle, plutôt que d'afficher « Aucun élément trouvé »
        // sur un historique qui n'est pas vide.
        const total = this._boundedTotal();
        if (this._pageIndex > 0 && this._pageIndex * this._pageSize >= total) {
          this._pageIndex = Math.max(0, Math.ceil(total / this._pageSize) - 1);
        }
        this._setPagination(this._pageIndex, this._pageSize, total);

        // L'indicateur ne retombe qu'à la fin de la chaîne : une page affichée
        // peut demander plusieurs pages serveur, et faire clignoter le spinner
        // entre deux donnerait à croire que le chargement est terminé.
        this._isFetching = false;
        this._ensureLoaded(targetCount);
        if (!this._isFetching) this.isLoading.set(false);
      });
  }

  /**
   * Longueur annoncée au paginateur. Le service ne donne aucun total : on lui
   * passe donc une borne **basse** — ce qui est chargé, plus une ligne tant que
   * la dernière page reçue était pleine, faute de quoi le bouton « suivant »
   * serait désactivé et la suite de l'historique inatteignable. Le compte
   * affiché est un minimum, pas un total ; c'est tout ce que le contrat permet
   * d'affirmer.
   */
  private _boundedTotal(): number {
    return this._entries().length + (this._hasMore ? 1 : 0);
  }

  private _setPagination(
    pageIndex: number,
    pageSize: number,
    totalElements: number,
  ): void {
    // `set` et non `update` : appelé depuis un `effect`, une lecture du signal
    // qu'on écrit rouvrirait une dépendance sur lui-même.
    this.tableConfig.set(
      LoginHistoryList.paginationConfig(pageIndex, pageSize, totalElements),
    );
  }

  private static paginationConfig(
    pageIndex: number,
    pageSize: number,
    totalElements: number,
  ): TableConfig {
    return {
      property: 'key',
      pagination: {
        serverSide: true,
        pageIndex,
        pageSize,
        pageSizeOptions: PAGE_SIZE_OPTIONS,
        totalElements,
      },
    };
  }

  /**
   * « Chrome 141 · Windows », assemblé avec les seuls champs renseignés. Quand
   * le serveur n'a rien su analyser, on retombe sur le `userAgent` brut plutôt
   * que de laisser la ligne muette : tronqué à l'affichage, il reste lisible en
   * info-bulle et suffit à identifier l'appareil.
   */
  private _deviceLabel(entry: LoginHistoryDto): string | null {
    const browser = entry.browser?.trim();
    const browserVersion = entry.browserVersion?.trim();
    const platform = entry.platform?.trim();

    const parts: string[] = [];
    if (browser) parts.push(browserVersion ? `${browser} ${browserVersion}` : browser);
    if (platform) parts.push(platform);

    if (parts.length > 0) return parts.join(' · ');
    return entry.userAgent?.trim() || null;
  }

  /**
   * `clientKind` et `platform` sont des chaînes libres au contrat : aucune
   * énumération n'est déclarée. L'icône est donc choisie sur des indices, avec
   * repli sur l'icône de connexion — une valeur inattendue ne doit pas laisser
   * la ligne sans repère visuel.
   */
  private _icon(entry: LoginHistoryDto): string {
    const hints = `${entry.clientKind ?? ''} ${entry.platform ?? ''}`.toLowerCase();
    if (/ipad|tablet/.test(hints)) return 'feather:tablet';
    if (/android|ios|iphone|mobile|phone/.test(hints)) return 'feather:smartphone';
    if (/api|server|service|bot/.test(hints)) return 'feather:terminal';
    if (/windows|mac|linux|desktop/.test(hints)) return 'feather:monitor';
    if (/web|browser/.test(hints)) return 'feather:globe';
    return 'feather:log-in';
  }

  private _timestamp(value: string | null | undefined): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}
