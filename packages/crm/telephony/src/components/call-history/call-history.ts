import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { PageEvent } from '@angular/material/paginator';
import {
  TelephonyApiService,
  TelephonyCallListItemDto,
  UsersApiService,
} from '@sankore/crm-api';
import { AuthenticationService, PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { EMPTY, catchError } from 'rxjs';
import {
  TEL_EMPTY_LABEL,
  TelephonyEntityType,
  telCallDirectionLabel,
  telCallStatusLabel,
  telCallStatusSeverity,
  telRecordingStatusLabel,
  telRecordingStatusSeverity,
  telephonyErrorMessage,
} from '../../data-access/telephony-referential';
import { RecordingPlayer } from '../recording-player/recording-player';
import { callDurationLabel } from './call-presentation';

const PAGE_SIZE = 10;

/**
 * Historique téléphonique d'UNE fiche (TEL-F-07), inséré dans la fiche lead et dans la
 * fiche client.
 *
 * Il passe par `GET telephony/calls` avec `entityType` + `entityId` : c'est exactement ce
 * que le contrat désigne comme « les appels d'une fiche ». Il n'existe pas d'endpoint
 * « appels de ce lead » séparé, et la liste générale est déjà filtrée par périmètre côté
 * serveur — l'écran n'a donc aucun filtrage de sécurité à refaire.
 *
 * Trois choses que le contrat NE donne pas, et qui expliquent l'interface :
 *
 * 1. **Aucun numéro de téléphone, dans aucun champ.** La ligne se lit par la direction,
 *    l'agent, la date et l'issue.
 * 2. **`hasNote` dit qu'une note existe, jamais ce qu'elle dit** — les notes sont
 *    chiffrées et ne sortent pas du module. C'est donc une icône, et il n'y a rien à
 *    excuser dans l'interface.
 * 3. **`canListen` est calculé par le serveur**, périmètre et permission d'écoute
 *    compris. On le lit ; on ne le recalcule pas, et surtout on ne le découvre pas d'un
 *    404 par ligne.
 *
 * Le rendu « carte » sous 640 px et colonnes au-delà est obtenu dans UNE `tas-table`,
 * comme `household-members-list` : une cellule unique en `colspan` pour la carte, les
 * cellules de colonnes masquées en petit écran. C'est ce qui garde la pagination
 * serveur, l'état de chargement et l'état vide du composant du kit tout en tenant 360 px.
 */
@Component({
  selector: 'lib-call-history',
  imports: [
    TasCard,
    TasTable,
    TasIcon,
    TasTag,
    Button,
    TimeagoPipe,
    RecordingPlayer,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './call-history.html',
})
export class CallHistory {
  private readonly _telephonyApi = inject(TelephonyApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _auth = inject(AuthenticationService);

  public readonly entityType = input.required<TelephonyEntityType>();
  public readonly entityId = input.required<string>();

  public readonly title = input('Appels');

  /** Sans ce droit l'endpoint répond 403 : le bloc entier disparaît. */
  public readonly canView = this._permissions.can('Telephony.Call.View');

  public readonly rows = signal<TelephonyCallListItemDto[]>([]);
  public readonly totalCount = signal(0);
  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);

  /** Ligne dépliée pour écouter l'enregistrement. Un seul lecteur à la fois. */
  public readonly expandedId = signal<string | null>(null);

  public readonly directionLabel = telCallDirectionLabel;
  public readonly statusLabel = telCallStatusLabel;
  public readonly statusSeverity = telCallStatusSeverity;
  public readonly recordingLabel = telRecordingStatusLabel;
  public readonly recordingSeverity = telRecordingStatusSeverity;
  public readonly durationLabel = callDurationLabel;
  public readonly emptyLabel = TEL_EMPTY_LABEL;

  public readonly tableConfig = signal<TableConfig>({
    property: 'callId',
    pagination: {
      serverSide: true,
      pageIndex: 0,
      pageSize: PAGE_SIZE,
      pageSizeOptions: [10, 25, 50],
      totalElements: 0,
    },
  });

  /**
   * Nombre de colonnes réellement rendues, pour le `colspan` de la cellule carte. Un
   * `colspan` figé décalerait la carte le jour où une colonne apparaît ou disparaît.
   */
  public readonly columnCount = computed(() => 7);

  /** Noms d'agents déjà résolus. En mémoire, et seulement pour la durée de l'écran. */
  private readonly _agentNames = signal<Record<string, string>>({});
  private readonly _agentsAsked = new Set<string>();

  public constructor() {
    effect(() => {
      // Les deux entrées sont lues ici pour que l'historique reparte à la page 1 quand
      // l'hôte change de fiche sans détruire le composant.
      this.entityType();
      this.entityId();

      if (!this.canView()) {
        this.isLoading.set(false);

        return;
      }

      this._resetPage();
      this._load();
    });
  }

  /**
   * Nom de l'agent. Le journal ne renvoie qu'un uuid, et un uuid dans une colonne n'est
   * pas une information : les noms sont résolus une fois par identifiant distinct, et
   * l'agent connecté est reconnu sans aucune requête. Un échec laisse « — » plutôt que de
   * faire échouer la ligne — `GET users/{id}` n'est pas garanti à un agent ordinaire.
   */
  public agentName(crmUserId: string | null | undefined): string {
    if (!crmUserId) return 'Non attribué';
    if (crmUserId === this._auth.connectedUser()?.id) return 'Vous';

    return this._agentNames()[crmUserId] ?? TEL_EMPTY_LABEL;
  }

  public directionIcon(direction: string | null | undefined): string {
    switch (direction) {
      case 'Inbound':
        return 'feather:phone-incoming';
      case 'Outbound':
        return 'feather:phone-outgoing';
      case 'Internal':
        return 'feather:repeat';
      default:
        return 'feather:phone';
    }
  }

  public toggleRecording(row: TelephonyCallListItemDto): void {
    const id = row.callId ?? null;

    this.expandedId.update((current) => (current === id ? null : id));
  }

  public onPageChange(event: PageEvent): void {
    this.tableConfig.update((config) => ({
      ...config,
      pagination: {
        ...config.pagination,
        pageIndex: event.pageIndex,
        pageSize: event.pageSize,
      },
    }));

    this._load();
  }

  public reload(): void {
    this._load();
  }

  private _resetPage(): void {
    this.tableConfig.update((config) => ({
      ...config,
      pagination: { ...config.pagination, pageIndex: 0 },
    }));
  }

  private _load(): void {
    const pagination = this.tableConfig().pagination;

    this.isLoading.set(true);
    this.loadError.set(null);
    this.expandedId.set(null);

    this._telephonyApi
      .listTelephonyCalls(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        this.entityType(),
        this.entityId(),
        undefined,
        pagination.pageIndex + 1,
        pagination.pageSize,
      )
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.loadError.set(
            telephonyErrorMessage(
              error,
              "L'historique téléphonique n'a pas pu être chargé.",
            ),
          );
          this.rows.set([]);
          this.isLoading.set(false);

          return EMPTY;
        }),
      )
      .subscribe((page) => {
        const items = page.items ?? [];

        this.rows.set(items);
        this.totalCount.set(page.totalCount ?? items.length);
        this.tableConfig.update((config) => ({
          ...config,
          pagination: {
            ...config.pagination,
            totalElements: page.totalCount ?? items.length,
          },
        }));
        this.isLoading.set(false);
        this._resolveAgents(items);
      });
  }

  private _resolveAgents(items: TelephonyCallListItemDto[]): void {
    const own = this._auth.connectedUser()?.id;

    for (const item of items) {
      const id = item.crmUserId;

      if (!id || id === own || this._agentsAsked.has(id)) continue;

      this._agentsAsked.add(id);

      this._usersApi
        .getUser(id)
        .pipe(catchError(() => EMPTY))
        .subscribe((user) => {
          const name = user?.fullName || user?.email;

          if (!name) return;

          this._agentNames.update((names) => ({ ...names, [id]: name }));
        });
    }
  }
}
