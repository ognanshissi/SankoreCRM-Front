import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { catchError, EMPTY } from 'rxjs';
import { Navigation } from '../../components/navigation/navigation';
import { TasIcon } from '@talisoft/ui/icon';
import { Anchor } from '@talisoft/ui/button';
import { NotificationSettingsApiService, NotificationSettingsDto } from '@sankore/crm-api';
import { BreadcrumbService, MenuItem } from '@sankore/crm/common';

@Component({
  imports: [Navigation, RouterLink, DecimalPipe, TasIcon, Anchor],
  template: `
    <crm-navigation [menuItems]="menuItems">
      <div tas-navigation-top>
        <div class="flex items-center gap-3 mb-2">
          <a [routerLink]="['/settings']" tas-button iconButton>
            <tas-icon iconName="feather:chevron-left"></tas-icon>
          </a>
          <div class="flex-1 min-w-0">
            <h1 class="text-lg font-semibold text-slate-900">Notifications</h1>
            <p class="text-xs text-slate-400 mt-0.5">
              Fournisseurs, expéditeur et suivi des envois.
            </p>
          </div>
        </div>
      </div>

      <div tas-navigation-info>
        <div class="p-4 border-b border-gray-100">
          <div class="flex items-center gap-2">
            <div
              class="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center shrink-0"
            >
              <tas-icon
                iconName="feather:bell"
                class="text-indigo-500"
                style="font-size:14px"
              ></tas-icon>
            </div>
            <div>
              <p class="text-sm font-medium text-slate-800">Canaux d'envoi</p>
              <p class="text-xs text-slate-400">E-mail & SMS</p>
            </div>
          </div>
        </div>
        <!-- Quota widget -->
        @if (quotaLimit()) {
          <div class="p-4 border-b border-gray-100">
            <p
              class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2"
            >
              Quota mensuel
            </p>
            <div class="flex items-center gap-2 mb-1.5">
              <span
                class="text-lg font-bold tabular-nums"
                [class]="
                  quotaPercent() >= 90
                    ? 'text-red-600'
                    : quotaPercent() >= 70
                      ? 'text-amber-600'
                      : 'text-slate-800'
                "
              >
                {{ quotaPercent().toFixed(0) }}%
              </span>
              <span class="text-[10px] text-slate-400">utilisé</span>
            </div>
            <div class="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-1.5">
              <div
                class="h-full rounded-full transition-all"
                [class]="
                  quotaPercent() >= 90
                    ? 'bg-red-500'
                    : quotaPercent() >= 70
                      ? 'bg-amber-500'
                      : 'bg-green-500'
                "
                [style.width.%]="quotaPercent()"
              ></div>
            </div>
            <p class="text-[10px] text-slate-400 tabular-nums">
              {{ currentUsage() | number: '1.0-0' }} /
              {{ quotaLimit() | number: '1.0-0' }} e-mails
            </p>
          </div>
        }
      </div>
    </crm-navigation>
  `,
})
export class NotificationNavigation implements OnInit {
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _settingsApi = inject(NotificationSettingsApiService);

  public readonly menuItems: MenuItem[] = [
    {
      label: 'Journal de livraison',
      icon: 'feather:send',
      route: 'journal',
      active: true,
    },
    {
      label: 'Paramétrage',
      icon: 'feather:settings',
      route: 'parametrage',
      active: true,
    },
  ];

  public quotaLimit = signal<number | null>(null);
  public currentUsage = signal(0);
  public readonly quotaPercent = computed(() => {
    const limit = this.quotaLimit();
    if (!limit || limit === 0) return 0;
    return (this.currentUsage() / limit) * 100;
  });

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Notifications' },
    ]);
    this._settingsApi
      .getNotificationSettings()
      .pipe(catchError(() => EMPTY))
      .subscribe((s: NotificationSettingsDto) => {
        this.quotaLimit.set(s.monthlyQuotaLimit ?? null);
        this.currentUsage.set(s.currentMonthUsageCount ?? 0);
      });
  }
}

export default NotificationNavigation;
