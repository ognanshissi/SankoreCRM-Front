import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TasIcon } from '@talisoft/ui/icon';
import { PERMISSIONS } from '../../../models/permissions';
import { PermissionsService } from '../../../services/permissions.service';
import { NavBadges } from './nav-badges.service';
import { NavBadgeKey, PortalNavGroup, PortalNavItem, SETTINGS_NAV_ITEM } from './portal-navigation';

/** Les teintes des compteurs, comme la maquette : chacun dit de quel genre de travail il s'agit. */
const BADGE_TONES: Record<NavBadgeKey, string> = {
  whatsapp: 'bg-[#9fe3bf] text-primary',
  leads: 'bg-white/15 text-white',
  kyc: 'bg-amber-400 text-amber-950',
  workflows: 'bg-red-400 text-white',
};

/**
 * La barre latérale du portail : l'établissement, « Nouveau lead », les trois groupes de la
 * navigation avec leurs compteurs, et le paramétrage en pied. L'entrée active est décidée par la
 * mise en page (`activeId`), pas par un `routerLinkActive` par lien — voir `activeNavItem`.
 */
@Component({
  selector: 'common-portal-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink, TasIcon],
  host: { class: 'h-full w-60 shrink-0 flex-col bg-primary text-white' },
  template: `
    <div class="flex items-center gap-3 px-5 pt-5 pb-4">
      @if (logoUrl()) {
        <img [src]="logoUrl()" alt="" class="size-10 shrink-0 rounded-xl bg-white object-contain p-1" />
      } @else {
        <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#9fe3bf] text-lg font-bold text-primary" aria-hidden="true">
          {{ initial() }}
        </span>
      }
      <div class="min-w-0">
        <p class="truncate text-base font-bold leading-tight">{{ companyName() }}</p>
        @if (subtitle()) {
          <p class="truncate text-xs text-white/70">{{ subtitle() }}</p>
        }
      </div>
    </div>

    @if (canCreateLead()) {
      <div class="px-3 pb-3">
        <a
          routerLink="/leads"
          [queryParams]="{ nouveau: 1 }"
          class="flex w-full items-center justify-center gap-2 rounded-xl bg-[#9fe3bf] px-4 py-2.5 text-sm font-semibold text-primary transition hover:brightness-95"
          (click)="navigated.emit()"
        >
          <tas-icon iconName="feather:plus" style="font-size:16px"></tas-icon>
          Nouveau lead
        </a>
      </div>
    }

    <nav class="flex-1 overflow-y-auto px-3 pb-3" aria-label="Navigation principale">
      @for (group of groups(); track group.label; let last = $last) {
        <ul class="flex flex-col gap-1" [attr.aria-label]="group.label">
          @for (item of group.items; track item.id) {
            <li>
              <ng-container [ngTemplateOutlet]="entry" [ngTemplateOutletContext]="{ $implicit: item }" />
            </li>
          }
        </ul>
        @if (!last) {
          <div class="mx-3 my-3 border-t border-white/15" role="separator"></div>
        }
      }
    </nav>

    <div class="px-3 pb-4">
      <ng-container [ngTemplateOutlet]="entry" [ngTemplateOutletContext]="{ $implicit: settings }" />
    </div>

    <ng-template #entry let-item>
      @let active = item.id === activeId();
      @let count = badge(item);
      <a
        [routerLink]="item.link"
        class="relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition"
        [class]="active ? 'bg-white/10 font-semibold text-white' : 'font-medium text-white/85 hover:bg-white/5 hover:text-white'"
        [attr.aria-current]="active ? 'page' : null"
        (click)="navigated.emit()"
      >
        @if (active) {
          <span class="absolute -left-3 top-1.5 bottom-1.5 w-1 rounded-r-full bg-[#9fe3bf]" aria-hidden="true"></span>
        }
        <tas-icon [iconName]="item.icon" class="shrink-0" style="font-size:18px"></tas-icon>
        <span class="min-w-0 flex-1 leading-tight">{{ item.label }}</span>
        @if (count) {
          <span
            class="min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold leading-none tabular-nums"
            [class]="tone(item)"
            [attr.aria-label]="count + ' en attente'"
          >{{ count > 99 ? '99+' : count }}</span>
        }
      </a>
    </ng-template>
  `,
})
export class PortalSidebar {
  private readonly _permissions = inject(PermissionsService);
  private readonly _badges = inject(NavBadges);

  public readonly groups = input.required<PortalNavGroup[]>();
  public readonly activeId = input<string | null>(null);
  public readonly companyName = input<string>('');
  public readonly logoUrl = input<string | null>(null);
  public readonly subtitle = input<string>('');

  /** Sur petit écran, la barre est un tiroir : elle se referme quand on choisit une page. */
  public readonly navigated = output<void>();

  public readonly settings = SETTINGS_NAV_ITEM;
  public readonly canCreateLead = this._permissions.can(PERMISSIONS.LEAD_CREATE);
  public readonly initial = computed(() => (this.companyName().trim().charAt(0) || 'S').toUpperCase());

  public badge(item: PortalNavItem): number {
    return item.badge ? this._badges.counts()[item.badge] ?? 0 : 0;
  }

  public tone(item: PortalNavItem): string {
    return item.badge ? BADGE_TONES[item.badge] : '';
  }
}
