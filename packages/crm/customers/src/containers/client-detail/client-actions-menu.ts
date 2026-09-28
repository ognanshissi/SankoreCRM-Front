import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Signal,
} from '@angular/core';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { PermissionsService } from '@sankore/crm/common';
import { ClientLifecycleStateDto } from '@sankore/crm-api';
import { ClientDetailStore } from '../../models/client-detail.store';
import { CLIENT_STATUS_ORDER } from '../../models/client-labels';
import {
  LIFECYCLE_ACTION_PERMISSIONS,
  LifecycleActionDrawer,
  LifecycleActionDrawerData,
  LifecycleActionKind,
} from './lifecycle-action-drawer';

interface LifecycleMenuEntry {
  action: LifecycleActionKind;
  label: string;
  icon: string;
  /** Classe de couleur de l'entrée, pour distinguer les actions lourdes. */
  tone: string;
}

/**
 * Les entrées du menu, dans l'ordre d'affichage. Le libellé est celui du bouton de
 * confirmation du drawer, qui est lui-même celui du message de succès : « Suspendre » puis
 * « Client suspendu ».
 */
const MENU_ENTRIES: LifecycleMenuEntry[] = [
  {
    action: 'assignAdvisor',
    label: 'Réaffecter à un conseiller',
    icon: 'feather:user-check',
    tone: 'text-slate-700',
  },
  {
    action: 'transfer',
    label: 'Transférer vers une agence',
    icon: 'feather:git-branch',
    tone: 'text-slate-700',
  },
  {
    action: 'suspend',
    label: 'Suspendre',
    icon: 'feather:pause-circle',
    tone: 'text-amber-700',
  },
  {
    action: 'reactivate',
    label: 'Réactiver',
    icon: 'feather:play-circle',
    tone: 'text-slate-700',
  },
  {
    action: 'archive',
    label: 'Archiver',
    icon: 'feather:archive',
    tone: 'text-red-600',
  },
];

/**
 * Machine à états du cycle de vie client, **déduite des US du module M01 et à confirmer
 * côté API**. Le contrat n'expose aucune table de transitions : il se contente de renvoyer
 * `INVALID_STATUS_TRANSITION` après coup. Cette table est donc la seule source côté front,
 * et elle est écrite explicitement plutôt que dispersée en conditions dans le template,
 * pour qu'une correction se fasse en un seul endroit.
 *
 * Deux écarts connus avec la documentation du contrat, à arbitrer avec l'API :
 *
 * 1. « Archivé → réactiver » vient de l'US. La description de `POST /clients/{id}/reactivate`
 *    dit l'inverse : `INVALID_STATUS_TRANSITION` hors d'un statut suspendu et
 *    `CLIENT_READ_ONLY` sur une fiche archivée. L'US fait foi ici — l'action est proposée —
 *    mais le refus serveur est traduit en message lisible par le drawer.
 * 2. `KycRejected` n'est nommé par aucune US pour ces actions : la ligne est une déduction
 *    du domaine, au même titre que le reste de la table. M01 ne détient qu'un instantané du
 *    KYC en lecture seule, alimenté par les évènements de M02 : un client au dossier refusé
 *    n'est donc pas une fiche cassée, c'est une identité déclarée à reprendre — la fiche
 *    reste modifiable (`isReadOnlyStatus` ne couvre volontairement que `Archived` et
 *    `Merged`). D'où les mêmes actions que `PendingKyc` : réaffecter, transférer, archiver.
 *    Ni réactivation — elle ne vise que `Suspended` — ni suspension, le client n'étant pas
 *    actif.
 */
const ALLOWED_ACTIONS: Record<string, LifecycleActionKind[]> = {
  PendingKyc: ['assignAdvisor', 'transfer', 'archive'],
  Active: ['suspend', 'archive', 'assignAdvisor', 'transfer'],
  Suspended: ['reactivate', 'archive'],
  KycRejected: ['assignAdvisor', 'transfer', 'archive'],
  Archived: ['reactivate'],
  Merged: [],
};

/**
 * `client-labels` ne publie pas son helper de canonicalisation : cette version locale
 * réutilise `CLIENT_STATUS_ORDER` pour accepter aussi bien `'Active'` que `'1'`, comme le
 * font les libellés partagés. Sans cette tolérance, un statut renvoyé sous forme d'index
 * viderait le menu sans que rien ne l'explique.
 */
function canonicalStatus(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value);
  if (CLIENT_STATUS_ORDER.includes(raw)) return raw;
  const asIndex = Number(raw);
  if (Number.isInteger(asIndex) && asIndex >= 0 && asIndex < CLIENT_STATUS_ORDER.length) {
    return CLIENT_STATUS_ORDER[asIndex] as string;
  }
  return null;
}

@Component({
  selector: 'client-actions-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, TasIcon, Menu, MenuItem, TasMenuTrigger],
  template: `
    @if (availableEntries().length > 0) {
      <button tas-outlined-button type="button" TasMenuTrigger [panel]="actionsMenu">
        <tas-icon iconName="feather:more-horizontal" style="font-size:14px"></tas-icon>
        Actions
        <tas-icon iconName="feather:chevron-down" style="font-size:10px"></tas-icon>
      </button>

      <ng-template #actionsMenu>
        <tas-menu>
          @for (entry of availableEntries(); track entry.action) {
            <tas-menu-item>
              <button
                type="button"
                class="w-full flex items-center gap-2"
                [class]="entry.tone"
                (click)="openAction(entry.action)"
              >
                <tas-icon
                  [iconName]="entry.icon"
                  class="text-slate-400"
                  style="font-size:13px"
                ></tas-icon>
                {{ entry.label }}
              </button>
            </tas-menu-item>
          }
        </tas-menu>
      </ng-template>
    } @else if (hasAnyLifecycleRight()) {
      <p class="text-xs text-slate-400">{{ noActionReason() }}</p>
    }
  `,
})
export class ClientActionsMenu {
  protected readonly store = inject(ClientDetailStore);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _permissions = inject(PermissionsService);

  public readonly canUpdate = this._permissions.can('customers:update');
  public readonly canUpdateSensitive = this._permissions.can('customers:update_sensitive');
  public readonly canArchive = this._permissions.can('customers:archive');

  /**
   * Un signal de droit par action, dérivé de `LIFECYCLE_ACTION_PERMISSIONS` pour qu'il n'y
   * ait qu'une table à corriger si le contrat déplace une permission.
   */
  private readonly _grant: Record<LifecycleActionKind, Signal<boolean>> = {
    suspend: this._permissions.can(LIFECYCLE_ACTION_PERMISSIONS.suspend),
    reactivate: this._permissions.can(LIFECYCLE_ACTION_PERMISSIONS.reactivate),
    archive: this._permissions.can(LIFECYCLE_ACTION_PERMISSIONS.archive),
    assignAdvisor: this._permissions.can(LIFECYCLE_ACTION_PERMISSIONS.assignAdvisor),
    transfer: this._permissions.can(LIFECYCLE_ACTION_PERMISSIONS.transfer),
  };

  protected readonly status = computed(() => canonicalStatus(this.store.client()?.status));

  /**
   * Croisement de la machine à états et des permissions : une action n'apparaît que si le
   * statut courant l'autorise **et** que l'utilisateur détient la permission propre à cette
   * action — pas un droit d'écriture global, qui ferait proposer des actions refusées en 403.
   */
  protected readonly availableEntries = computed<LifecycleMenuEntry[]>(() => {
    if (!this.store.client()) return [];
    const status = this.status();
    const allowed = status ? (ALLOWED_ACTIONS[status] ?? []) : [];
    return MENU_ENTRIES.filter(
      (entry) => allowed.includes(entry.action) && this._grant[entry.action](),
    );
  });

  /** Sans aucun droit de cycle de vie, le message d'absence d'action n'a rien à expliquer. */
  protected readonly hasAnyLifecycleRight = computed(
    () => this.canUpdate() || this.canUpdateSensitive() || this.canArchive(),
  );

  /**
   * Le menu vide a deux causes distinctes — le statut ou les droits — et les confondre
   * envoie l'utilisateur chercher la mauvaise explication.
   */
  protected readonly noActionReason = computed(() => {
    const status = this.status();
    if (status === 'Merged') return 'Fiche fusionnée : aucune action possible.';
    const allowedByStatus = status ? (ALLOWED_ACTIONS[status] ?? []) : [];
    if (allowedByStatus.length > 0) {
      return "Vos droits ne couvrent aucune action disponible pour ce statut.";
    }
    return 'Aucune action disponible pour ce statut.';
  });

  public openAction(action: LifecycleActionKind): void {
    const client = this.store.client();
    if (!client?.id) return;

    // `has` et non `can` : on est dans un gestionnaire d'évènement, hors contexte réactif.
    if (!this._permissions.has(LIFECYCLE_ACTION_PERMISSIONS[action])) return;

    const ref = this._sideDrawer.open<
      ClientLifecycleStateDto,
      LifecycleActionDrawerData,
      LifecycleActionDrawer
    >(LifecycleActionDrawer, {
      width: '520px',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { action, client },
    });

    ref.closed.subscribe((state) => {
      // Le store est l'unique propriétaire des données de la fiche : on le recharge au lieu
      // d'appliquer localement la réponse, pour que l'en-tête et tous les onglets suivent.
      if (state) this.store.reload().subscribe();
    });
  }
}
