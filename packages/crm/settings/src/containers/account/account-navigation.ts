import { Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Navigation } from '../../components/navigation/navigation';
import { TasIcon } from '@talisoft/ui/icon';
import { Anchor } from '@talisoft/ui/button';
import { BreadcrumbService, MenuItem, AuthenticationService } from '@sankore/crm/common';

@Component({
  imports: [Navigation, RouterLink, TasIcon, Anchor],
  template: `
    <crm-navigation [menuItems]="menuItems">
      <div tas-navigation-top>
        <div class="flex items-center gap-3 mb-2">
          <a [routerLink]="['/settings']" tas-button iconButton>
            <tas-icon iconName="feather:chevron-left"></tas-icon>
          </a>
          <div class="flex-1 min-w-0">
            <h1 class="text-lg font-semibold text-slate-900">Mon compte</h1>
            <p class="text-xs text-slate-400 mt-0.5">Profil et sécurité.</p>
          </div>
        </div>
      </div>

      <div tas-navigation-info>
        <div class="p-4 border-b border-gray-100">
          <div class="flex items-center gap-3">
            <div
              class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0"
            >
              {{ userInitials }}
            </div>
            <div class="min-w-0">
              <p class="text-sm font-medium text-slate-800 truncate">
                {{ userName }}
              </p>
              <p class="text-xs text-slate-400 truncate">{{ userEmail }}</p>
            </div>
          </div>
        </div>
      </div>
    </crm-navigation>
  `,
})
export class AccountNavigation implements OnInit {
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _auth = inject(AuthenticationService);

  public readonly menuItems: MenuItem[] = [
    {
      label: 'Mon profil',
      icon: 'feather:user',
      route: 'profil',
      active: true,
    },
    {
      label: 'Sécurité',
      icon: 'feather:lock',
      route: 'securite',
      active: true,
    },
    {
      label: 'Paramétrage',
      icon: 'feather:settings',
      route: 'account-settings',
      active: true,
    },
  ];

  public userName = '';
  public userEmail = '';
  public userInitials = '?';

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Mon compte' },
    ]);
    const user = this._auth.connectedUser();
    this.userName = user?.fullName ?? user?.email ?? 'Utilisateur';
    this.userEmail = user?.email ?? '';
    const parts = this.userName.split(/\s+/);
    this.userInitials =
      ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
  }
}

export default AccountNavigation;
