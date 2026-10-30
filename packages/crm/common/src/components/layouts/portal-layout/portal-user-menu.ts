import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TasIcon } from '@talisoft/ui/icon';
import { AuthenticationService } from '../../../services/authentification.service';
import { TelephonyTopBarState } from './telephony-top-bar-state';
import { TestModeSwitcher } from '../../test-mode/test-mode';

const ROLE_LABELS: Record<string, string> = {
  System: 'Système',
  Administrator: 'Administrateur',
  Agent: 'Agent',
  CommercialAgent: 'Agent commercial',
  SalesManager: 'Responsable commercial',
  BranchManager: "Chef d'agence",
  Cashier: 'Caissier',
  RegulationManager: 'Responsable conformité',
};

const DOT_TONES: Record<string, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  neutral: 'bg-slate-400',
};

/**
 * Le profil en haut à droite : initiales, nom, rôle et état du téléphone, puis un menu qui
 * commence par ce qui empêche de travailler — un téléphone non lié — avant les liens habituels.
 *
 * L'état du téléphone vient de `TelephonyTopBarState`, posé par le module Téléphonie : rien ici
 * ne sait ce qu'est un poste. Un établissement sans téléphonie n'a ni pastille ni carte.
 */
@Component({
  selector: 'common-portal-user-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkMenuTrigger, CdkMenu, CdkMenuItem, RouterLink, TasIcon],
  template: `
    <button
      type="button"
      class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white py-1.5 pr-3 pl-1.5 text-left transition hover:bg-slate-50"
      [cdkMenuTriggerFor]="panel"
      [attr.aria-label]="'Menu de ' + name()"
    >
      <span class="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-primary">
        {{ initials() }}
        @if (dotTone()) {
          <span class="absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-white" [class]="dotTone()" aria-hidden="true"></span>
        }
      </span>
      <span class="hidden min-w-0 flex-col md:flex">
        <span class="truncate text-sm font-bold text-slate-900">{{ name() }}</span>
        <span class="truncate text-xs">
          <span class="text-slate-500">{{ role() }}</span>
          @if (phoneProblem()) {
            <span class="text-amber-700"> · {{ phoneProblem() }}</span>
          }
        </span>
      </span>
      <tas-icon iconName="feather:chevron-down" class="text-slate-500" style="font-size:16px"></tas-icon>
    </button>

    <ng-template #panel>
      <div cdkMenu class="mt-2 w-80 max-w-[calc(100vw-32px)] rounded-2xl border border-slate-100 bg-white p-2 shadow-xl">
        @if (warning(); as pill) {
          <div class="mb-1 rounded-xl bg-amber-50 p-3">
            <p class="flex items-center gap-2 text-sm font-bold text-amber-900">
              <tas-icon [iconName]="pill.icon" style="font-size:16px"></tas-icon>
              {{ pill.label }}
            </p>
            <p class="mt-1 text-xs text-amber-900">{{ pill.hint }}</p>
            @if (telephony.action(); as action) {
              <button
                cdkMenuItem
                type="button"
                class="mt-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                [disabled]="telephony.actionBusy()"
                (cdkMenuItemTriggered)="action.run()"
              >
                {{ telephony.actionBusy() ? 'Rattachement…' : action.label }}
              </button>
            }
          </div>
        }

        <a cdkMenuItem routerLink="/settings/account/profil" class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
          <tas-icon iconName="feather:user" class="text-slate-500" style="font-size:16px"></tas-icon>
          Mon profil
        </a>
        <!-- Sur petit écran l'interrupteur de l'en-tête est masqué : le menu le reprend. -->
        @if (switcher.available()) {
          <button cdkMenuItem type="button" class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-orange-800 hover:bg-orange-50 sm:hidden"
                  (cdkMenuItemTriggered)="switcher.switch(!switcher.on())">
            <tas-icon iconName="feather:tool" style="font-size:16px"></tas-icon>
            {{ switcher.on() ? 'Quitter le mode test' : 'Passer en mode test' }}
          </button>
        }
        <button cdkMenuItem type="button" class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50" (cdkMenuItemTriggered)="help.emit()">
          <tas-icon iconName="feather:help-circle" class="text-slate-500" style="font-size:16px"></tas-icon>
          Aide et raccourcis
        </button>
        <button cdkMenuItem type="button" class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-red-700 hover:bg-red-50" (cdkMenuItemTriggered)="logout()">
          <tas-icon iconName="feather:log-out" style="font-size:16px"></tas-icon>
          Se déconnecter
        </button>
      </div>
    </ng-template>
  `,
})
export class PortalUserMenu {
  private readonly _auth = inject(AuthenticationService);
  public readonly telephony = inject(TelephonyTopBarState);

  public readonly help = output<void>();

  public readonly switcher = inject(TestModeSwitcher);

  public readonly name = computed(() => {
    const user = this._auth.connectedUser();
    return user?.fullName?.trim() || user?.email || 'Utilisateur';
  });

  public readonly initials = computed(() => {
    const parts = this.name().split(/[\s@.]+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
  });

  public readonly role = computed(() => {
    const role = this._auth.connectedUser()?.roles?.[0];
    return role ? ROLE_LABELS[role] ?? role : '';
  });

  /** La pastille quand elle signale un problème — pas « Téléphonie active ». */
  public readonly warning = computed(() => {
    const pill = this.telephony.pill();
    return pill && pill.tone !== 'success' ? pill : null;
  });

  public readonly phoneProblem = computed(() => this.warning()?.label.toLowerCase() ?? '');

  public readonly dotTone = computed(() => {
    const pill = this.telephony.pill();
    return pill ? DOT_TONES[pill.tone] ?? '' : '';
  });

  public logout(): void {
    this._auth.logout();
  }
}
