import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { PermissionsService } from '../../../services/permissions.service';
import { QUICK_CREATE_ACTIONS, QuickCreateAction, QuickCreateEvents } from './quick-create';

/**
 * « Créer » dans la barre du haut : un lead, une tâche ou un rendez-vous sans quitter la page.
 * Les tiroirs sont ceux des écrans métier, ouverts tels quels ; seules les entrées permises
 * apparaissent, et le bouton disparaît quand il n'en reste aucune.
 */
@Component({
  selector: 'common-portal-quick-create',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkMenuTrigger, CdkMenu, CdkMenuItem, TasIcon],
  template: `
    @if (actions().length) {
      <button
        type="button"
        class="flex h-10 items-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        [cdkMenuTriggerFor]="panel"
        [disabled]="loading()"
        aria-label="Créer"
      >
        <tas-icon iconName="feather:plus" style="font-size:16px"></tas-icon>
        <span class="hidden sm:inline">Créer</span>
        <tas-icon iconName="feather:chevron-down" class="hidden sm:inline" style="font-size:14px"></tas-icon>
      </button>
    }

    <ng-template #panel>
      <div cdkMenu class="mt-2 w-60 rounded-2xl border border-slate-100 bg-white p-2 shadow-xl">
        @for (action of actions(); track action.kind) {
          <button
            cdkMenuItem
            type="button"
            class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
            (cdkMenuItemTriggered)="open(action)"
          >
            <tas-icon [iconName]="action.icon" class="text-slate-500" style="font-size:16px"></tas-icon>
            {{ action.label }}
          </button>
        }
      </div>
    </ng-template>
  `,
})
export class PortalQuickCreate {
  private readonly _all = inject(QUICK_CREATE_ACTIONS, { optional: true }) ?? [];
  private readonly _permissions = inject(PermissionsService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _events = inject(QuickCreateEvents);

  /** Le temps de charger le tiroir : un second clic n'en ouvrirait pas un deuxième. */
  public readonly loading = signal(false);

  public readonly actions = computed(() => {
    const granted = this._permissions.granted();
    return this._all.filter((a) => !a.anyOf || a.anyOf.some((p) => granted.has(p)));
  });

  public async open(action: QuickCreateAction): Promise<void> {
    this.loading.set(true);
    try {
      const component = await action.load();
      const ref = this._sideDrawer.open<unknown, unknown, unknown>(component, {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
      });
      ref.closed.subscribe((id) => {
        if (typeof id === 'string' && id) this._events.notify({ kind: action.kind, id });
      });
    } catch {
      this._snackbar.error('Erreur', 'Impossible d’ouvrir le formulaire. Rechargez la page.');
    } finally {
      this.loading.set(false);
    }
  }
}
