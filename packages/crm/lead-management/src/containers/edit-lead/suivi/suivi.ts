import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TasIcon } from '@talisoft/ui/icon';
import { PermissionCode, PermissionsService } from '@sankore/crm/common';
import { LeadEditContext } from '../lead-edit-context';

interface SuiviTab {
  label: string;
  icon: string;
  route: string;
  /** Le droit qu'exige la route ; l'onglet est masqué sans lui plutôt que de mener à un refus. */
  permission?: PermissionCode;
}

const TABS: ReadonlyArray<SuiviTab> = [
  { label: 'Activités', icon: 'feather:activity', route: 'activites' },
  { label: 'Rappels', icon: 'feather:bell', route: 'rappels', permission: 'lead:reminder:manage' },
  { label: 'Tâches', icon: 'feather:check-square', route: 'taches', permission: 'lead:task:read' },
  { label: 'Chronologie', icon: 'feather:clock', route: 'timeline' },
  { label: 'WhatsApp', icon: 'feather:message-circle', route: 'whatsapp', permission: 'WhatsApp.Send' },
];

/** Page « Suivi » de la fiche lead : les activités, rappels, tâches et la chronologie, en onglets. */
@Component({
  selector: 'lead-suivi',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TasIcon],
  template: `
    <div class="flex flex-col gap-4">
      <div class="rounded-2xl bg-white border border-slate-100 shadow-sm px-2" role="tablist" aria-label="Suivi du lead">
        <div class="flex flex-wrap items-center gap-1">
          @for (tab of tabs(); track tab.route) {
            <a role="tab"
               [routerLink]="tab.route"
               routerLinkActive="is-suivi-tab-active"
               #rla="routerLinkActive"
               [class]="rla.isActive
                 ? 'flex items-center gap-2 px-4 py-3 text-sm whitespace-nowrap border-b-2 border-primary text-primary font-semibold'
                 : 'flex items-center gap-2 px-4 py-3 text-sm whitespace-nowrap border-b-2 border-transparent text-slate-600 hover:text-slate-900'"
               [attr.aria-selected]="rla.isActive">
              <tas-icon [iconName]="tab.icon" style="font-size:14px"></tas-icon>
              {{ tab.label }}
              @if (tab.route === 'activites' && hasNoActivity()) {
                <span class="min-w-5 h-5 px-1.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold flex items-center justify-center"
                      title="Aucun échange noté">0</span>
              }
            </a>
          }
        </div>
      </div>
      <router-outlet></router-outlet>
    </div>
  `,
})
export class LeadSuivi {
  private readonly _permissions = inject(PermissionsService);
  private readonly _context = inject(LeadEditContext);

  private readonly _canReminders = this._permissions.can('lead:reminder:manage');
  private readonly _canTasks = this._permissions.can('lead:task:read');
  private readonly _canWhatsApp = this._permissions.can('WhatsApp.Send', 'WhatsApp.Supervise');

  public readonly tabs = computed(() =>
    TABS.filter((tab) =>
      tab.permission === 'lead:reminder:manage' ? this._canReminders()
        : tab.permission === 'lead:task:read' ? this._canTasks()
        : tab.permission === 'WhatsApp.Send' ? this._canWhatsApp()
        : true,
    ),
  );

  /** Même règle que le badge du menu : aucun échange noté sur un lead encore en cours. */
  public readonly hasNoActivity = computed(() => {
    const lead = this._context.lead();
    return !!lead && !lead.lastActivityAt && !this._context.isReadOnly()
      && !['Lost', 'Disqualified', 'Archived'].includes(lead.status ?? '');
  });
}

export default LeadSuivi;
