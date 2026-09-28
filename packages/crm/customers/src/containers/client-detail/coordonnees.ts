import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { PermissionsService } from '@sankore/crm/common';
import {
  AddContactPointRequestTypeEnum,
  AddContactPointResult,
  ClientContactPointsApiService,
  ContactPointDto,
  ContactPointDtoTypeEnum,
  RevealSensitiveFieldRequestFieldEnum,
} from '@sankore/crm-api';
import { catchError, EMPTY, finalize, tap } from 'rxjs';
import { ClientDetailStore } from '../../models/client-detail.store';
import { SensitiveField } from '../../components/sensitive-field';
import {
  AddContactPointDrawer,
  AddContactPointDrawerData,
} from './add-contact-point-drawer';

interface GroupDefinition {
  type: ContactPointDtoTypeEnum;
  addType: AddContactPointRequestTypeEnum;
  title: string;
  icon: string;
  revealField: RevealSensitiveFieldRequestFieldEnum;
  fieldLabel: string;
  emptyLabel: string;
  addLabel: string;
}

interface ContactPointGroup extends GroupDefinition {
  active: ContactPointDto[];
  closed: ContactPointDto[];
}

/**
 * Le contrat nomme le type postal `Address` en lecture et à l'écriture, mais
 * `PostalAddress` du côté de la révélation tracée : la correspondance est portée ici une
 * fois pour toutes plutôt que devinée à chaque appel.
 */
const GROUP_DEFINITIONS: GroupDefinition[] = [
  {
    type: ContactPointDtoTypeEnum.Phone,
    addType: AddContactPointRequestTypeEnum.Phone,
    title: 'Téléphones',
    icon: 'feather:phone',
    revealField: RevealSensitiveFieldRequestFieldEnum.Phone,
    fieldLabel: 'le téléphone',
    emptyLabel: 'Aucun téléphone actif',
    addLabel: 'Ajouter un téléphone',
  },
  {
    type: ContactPointDtoTypeEnum.Email,
    addType: AddContactPointRequestTypeEnum.Email,
    title: 'Adresses e-mail',
    icon: 'feather:mail',
    revealField: RevealSensitiveFieldRequestFieldEnum.Email,
    fieldLabel: "l'adresse e-mail",
    emptyLabel: 'Aucune adresse e-mail active',
    addLabel: 'Ajouter une adresse e-mail',
  },
  {
    type: ContactPointDtoTypeEnum.Address,
    addType: AddContactPointRequestTypeEnum.Address,
    title: 'Adresses postales',
    icon: 'feather:map-pin',
    revealField: RevealSensitiveFieldRequestFieldEnum.PostalAddress,
    fieldLabel: "l'adresse postale",
    emptyLabel: 'Aucune adresse postale active',
    addLabel: 'Ajouter une adresse postale',
  },
];

/** Info-bulle du bouton « Clôturer » désactivé sur le dernier téléphone actif (critère 4). */
const LAST_PHONE_TOOLTIP =
  'Un client doit garder au moins un téléphone actif. Ajoutez un autre numéro avant de clôturer celui-ci.';

/** `isActive` peut manquer sur une réponse partielle : `validTo` tranche alors. */
function isActiveContactPoint(contactPoint: ContactPointDto): boolean {
  return contactPoint.isActive ?? !contactPoint.validTo;
}

/** La principale d'abord, puis du plus ancien au plus récent : l'ordre de lecture attendu. */
function byPrimaryThenDate(a: ContactPointDto, b: ContactPointDto): number {
  if (!!a.isPrimary !== !!b.isPrimary) return a.isPrimary ? -1 : 1;
  return (a.validFrom ?? '').localeCompare(b.validFrom ?? '');
}

@Component({
  selector: 'client-coordonnees',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, TasCard, TasIcon, TasTag, TasSpinner, Button, SensitiveField],
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p class="text-sm font-medium text-slate-800">Coordonnées</p>
          <p class="text-xs text-slate-500">
            Téléphones, adresses e-mail et adresses postales du client.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            tas-outlined-button
            type="button"
            size="small"
            [attr.aria-pressed]="showHistory()"
            [title]="
              showHistory()
                ? 'Revenir aux coordonnées actives'
                : 'Afficher les coordonnées clôturées et leurs dates de validité'
            "
            (click)="toggleHistory()"
          >
            <tas-icon iconName="feather:clock" style="font-size:14px"></tas-icon>
            <span>{{ showHistory() ? "Masquer l'historique" : 'Historique' }}</span>
            @if (closedCount() > 0) {
              <span class="tabular-nums text-slate-500">({{ closedCount() }})</span>
            }
          </button>

          @if (canWrite()) {
            <button
              tas-raised-button
              color="primary"
              type="button"
              size="small"
              (click)="openAddDrawer()"
            >
              <tas-icon iconName="feather:plus" style="font-size:14px"></tas-icon>
              <span>Ajouter une coordonnée</span>
            </button>
          }
        </div>
      </div>

      @if (isLoading()) {
        <div class="flex justify-center py-16">
          <tas-spinner size="10" class="text-primary"></tas-spinner>
        </div>
      } @else {
        @if (showHistory() && closedCount() === 0) {
          <div class="p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600">
            Aucune coordonnée clôturée pour ce client.
          </div>
        }

        @for (group of groups(); track group.type) {
          <tas-card class="block">
            <div class="p-4 flex flex-col gap-3">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <tas-icon
                    [iconName]="group.icon"
                    class="text-slate-400"
                    style="font-size:15px"
                  ></tas-icon>
                  <p class="text-sm font-medium text-slate-800">{{ group.title }}</p>
                  <span class="text-xs text-slate-500 tabular-nums">
                    {{ group.active.length }}
                  </span>
                </div>

                @if (canWrite()) {
                  <button
                    tas-text-button
                    type="button"
                    size="small"
                    color="primary"
                    [title]="group.addLabel"
                    (click)="openAddDrawer(group.addType)"
                  >
                    <tas-icon iconName="feather:plus" style="font-size:13px"></tas-icon>
                    <span>Ajouter</span>
                  </button>
                }
              </div>

              @if (group.active.length === 0) {
                <p class="text-xs text-slate-500">{{ group.emptyLabel }}</p>
              } @else {
                <ul class="divide-y divide-slate-100 border-t border-slate-100">
                  @for (point of group.active; track point.id) {
                    <li class="py-3 flex items-start justify-between gap-3">
                      <div class="flex flex-col gap-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <sensitive-field
                            [clientId]="clientId()!"
                            [field]="group.revealField"
                            [maskedValue]="point.maskedValue"
                            [contactPointId]="point.id"
                            [fieldLabel]="group.fieldLabel"
                          ></sensitive-field>

                          @if (point.isPrimary) {
                            <tas-tag severity="success">Principale</tas-tag>
                          }
                          @if (point.label) {
                            <span class="text-xs text-slate-500">{{ point.label }}</span>
                          }
                        </div>
                        <p class="text-xs text-slate-400">
                          Active depuis le {{ point.validFrom | date: 'dd/MM/yyyy' }}
                        </p>
                      </div>

                      @if (canWrite()) {
                        <div class="flex items-center gap-1 shrink-0">
                          @if (!point.isPrimary) {
                            <button
                              tas-text-button
                              type="button"
                              size="small"
                              color="primary"
                              title="Faire de cette coordonnée la principale de son type"
                              [disabled]="isBusy(point.id)"
                              (click)="promote(point)"
                            >
                              <span>Définir comme principale</span>
                            </button>
                          }

                          <!-- Le title est posé aussi sur l'enveloppe : Chrome n'affiche pas
                               l'info-bulle d'un bouton désactivé, qui ne reçoit plus d'évènement
                               de survol. Sans ce span, le critère 4 serait vrai dans le DOM et
                               faux à l'écran. -->
                          <span
                            [title]="
                              canClose(group, point)
                                ? 'Clôturer cette coordonnée'
                                : lastPhoneTooltip
                            "
                          >
                            <button
                              tas-text-button
                              type="button"
                              size="small"
                              [color]="canClose(group, point) ? 'warn' : 'neutral'"
                              [disabled]="!canClose(group, point) || isBusy(point.id)"
                              [title]="
                                canClose(group, point)
                                  ? 'Clôturer cette coordonnée'
                                  : lastPhoneTooltip
                              "
                              (click)="confirmClose(group, point)"
                            >
                              <span>Clôturer</span>
                            </button>
                          </span>
                        </div>
                      }
                    </li>
                  }
                </ul>
              }

              @if (showHistory() && group.closed.length > 0) {
                <div class="mt-1 pt-3 border-t border-dashed border-slate-200">
                  <p class="text-xs font-medium text-slate-500 mb-2">
                    Historique ({{ group.closed.length }})
                  </p>
                  <ul class="divide-y divide-slate-100">
                    @for (point of group.closed; track point.id) {
                      <li class="py-2 flex items-start justify-between gap-3">
                        <div class="flex flex-col gap-0.5 min-w-0">
                          <span class="text-sm text-slate-500 line-through">
                            {{ point.maskedValue ?? '—' }}
                          </span>
                          @if (point.label) {
                            <span class="text-xs text-slate-400">{{ point.label }}</span>
                          }
                        </div>
                        <span class="text-xs text-slate-400 shrink-0 tabular-nums">
                          Du {{ point.validFrom | date: 'dd/MM/yyyy' }} au
                          {{ point.validTo | date: 'dd/MM/yyyy' }}
                        </span>
                      </li>
                    }
                  </ul>
                </div>
              }
            </div>
          </tas-card>
        }
      }
    </div>
  `,
})
export class ClientContactPointsPage {
  protected readonly store = inject(ClientDetailStore);
  private readonly _contactPointsApi = inject(ClientContactPointsApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _confirmDialog = inject(ConfirmDialogService);

  public readonly lastPhoneTooltip = LAST_PHONE_TOOLTIP;

  private readonly _canUpdate = this._permissions.can('customers:update');
  /** Une fiche fusionnée ou archivée reste consultable, jamais modifiable. */
  public readonly canWrite = computed(() => this._canUpdate() && !this.store.isReadOnly());

  public readonly clientId = computed(() => this.store.clientId());

  public readonly isLoading = signal(true);
  public readonly showHistory = signal(false);
  public readonly contactPoints = signal<ContactPointDto[]>([]);
  /** Coordonnée dont une écriture est en cours : ses deux actions se désactivent. */
  public readonly busyId = signal<string | null>(null);

  public readonly groups = computed<ContactPointGroup[]>(() => {
    const points = this.contactPoints();
    return GROUP_DEFINITIONS.map((definition) => {
      const ofType = points.filter((p) => String(p.type) === String(definition.type));
      return {
        ...definition,
        active: ofType.filter(isActiveContactPoint).sort(byPrimaryThenDate),
        closed: ofType
          .filter((p) => !isActiveContactPoint(p))
          .sort((a, b) => (b.validTo ?? '').localeCompare(a.validTo ?? '')),
      };
    });
  });

  public readonly closedCount = computed(() =>
    this.contactPoints().filter((p) => !isActiveContactPoint(p)).length,
  );

  private _loadedFor: string | null = null;

  constructor() {
    // La coquille de fiche fournit le client : l'onglet attend son identifiant sans le
    // recharger lui-même, et se contente de charger ses propres coordonnées.
    effect(() => {
      const id = this.clientId();
      if (!id || id === this._loadedFor) return;
      this._loadedFor = id;
      this._load(id);
    });
  }

  public toggleHistory(): void {
    this.showHistory.update((v) => !v);
  }

  public isBusy(contactPointId: string | undefined): boolean {
    return !!contactPointId && this.busyId() === contactPointId;
  }

  /** Critère 4 : le dernier téléphone actif ne peut pas être clôturé. */
  public canClose(group: ContactPointGroup, point: ContactPointDto): boolean {
    if (String(group.type) !== String(ContactPointDtoTypeEnum.Phone)) return true;
    return group.active.length > 1;
  }

  public openAddDrawer(initialType?: AddContactPointRequestTypeEnum): void {
    const clientId = this.clientId();
    if (!clientId || !this.canWrite()) return;

    const activeTypes = this.groups()
      .filter((g) => g.active.length > 0)
      .map((g) => String(g.type));

    const ref = this._sideDrawer.open<
      AddContactPointResult,
      AddContactPointDrawerData,
      AddContactPointDrawer
    >(AddContactPointDrawer, {
      width: '520px',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { clientId, initialType, activeTypes },
    });

    ref.closed.subscribe((result) => {
      if (!result) return;
      // L'en-tête de la fiche affiche la coordonnée principale : il faut le rafraîchir
      // dès que l'ajout en a désigné une nouvelle.
      this._reload(clientId, !!result.isPrimary);
    });
  }

  public promote(point: ContactPointDto): void {
    const clientId = this.clientId();
    if (!clientId || !point.id || !this.canWrite()) return;

    this.busyId.set(point.id);
    this._contactPointsApi
      .promoteClientContactPointToPrimary(clientId, point.id)
      .pipe(
        catchError(() => {
          this._snackbar.error(
            'Erreur',
            "Impossible de définir cette coordonnée comme principale.",
          );
          return EMPTY;
        }),
        finalize(() => this.busyId.set(null)),
      )
      .subscribe(() => {
        this._snackbar.success(
          'Coordonnée principale mise à jour',
          'Cette coordonnée est désormais la principale de son type.',
        );
        this._reload(clientId, true);
      });
  }

  public confirmClose(group: ContactPointGroup, point: ContactPointDto): void {
    if (!this.canClose(group, point) || !point.id || !this.canWrite()) return;

    this._confirmDialog.confirm({
      title: 'Clôturer cette coordonnée ?',
      message: `« ${point.maskedValue ?? 'Cette coordonnée'} » quittera la liste des coordonnées actives et restera consultable dans l'historique.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Clôturer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._close(point),
    });
  }

  private _close(point: ContactPointDto): void {
    const clientId = this.clientId();
    if (!clientId || !point.id) return;

    this.busyId.set(point.id);
    this._contactPointsApi
      .closeClientContactPoint(clientId, point.id)
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible de clôturer cette coordonnée.');
          return EMPTY;
        }),
        finalize(() => this.busyId.set(null)),
      )
      .subscribe(() => {
        this._snackbar.success(
          'Coordonnée clôturée',
          "Elle reste consultable depuis l'historique.",
        );
        // Le serveur promeut la plus ancienne coordonnée active restante quand la
        // principale est clôturée : l'en-tête doit donc être rafraîchi dans ce cas.
        this._reload(clientId, !!point.isPrimary);
      });
  }

  private _load(clientId: string): void {
    this.isLoading.set(true);
    this._fetch(clientId).subscribe();
  }

  /** Rechargement après écriture : pas d'état « chargement », pour ne pas faire clignoter la liste. */
  private _reload(clientId: string, primaryChanged: boolean): void {
    this._fetch(clientId).subscribe();
    if (primaryChanged) this.store.reload().subscribe();
  }

  private _fetch(clientId: string) {
    // `includeClosed = true` en permanence : une seule requête sert la liste active et
    // l'historique, si bien que le bouton « Historique » répond sans aller-retour serveur
    // et que son compteur est juste dès le premier affichage.
    return this._contactPointsApi.listClientContactPoints(clientId, true).pipe(
      tap((points) => this.contactPoints.set(points ?? [])),
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de charger les coordonnées du client.');
        return EMPTY;
      }),
      finalize(() => this.isLoading.set(false)),
    );
  }
}

export default ClientContactPointsPage;
