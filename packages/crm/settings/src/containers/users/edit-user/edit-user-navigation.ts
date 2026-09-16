import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgClass } from '@angular/common';
import { Navigation } from '../../../components/navigation/navigation';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Anchor } from '@talisoft/ui/button';
import { UsersApiService, UserDto } from '@sankore/crm-api';
import { BreadcrumbService, MenuItem } from '@sankore/crm/common';

@Component({
  imports: [Navigation, RouterLink, NgClass, TasIcon, TasSpinner, Anchor],
  template: `
    <crm-navigation [menuItems]="menuItems()">
      <div tas-navigation-top>
        <div class="flex items-center gap-3 mb-2">
          <a [routerLink]="['/settings/users']" tas-button iconButton>
            <tas-icon iconName="feather:chevron-left"></tas-icon>
          </a>
          <div class="flex-1 min-w-0">
            @if (isLoading()) {
              <div class="h-5 w-40 bg-slate-200 rounded animate-pulse"></div>
            } @else {
              <h1 class="text-lg font-semibold text-slate-900 truncate">
                {{ user()?.fullName ?? user()?.email ?? 'Utilisateur' }}
              </h1>
            }
          </div>
          @if (!isLoading() && user()) {
            <span
              class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0"
              [ngClass]="{
                'bg-green-100 text-green-700': user()!.status === '1',
                'bg-yellow-100 text-yellow-700': user()!.status === '0',
                'bg-slate-100 text-slate-500': user()!.status === '2',
                'bg-red-100 text-red-700': user()!.status === '3'
              }"
            >
              {{ statusLabel(user()!.status) }}
            </span>
          }
        </div>
      </div>

      <div tas-navigation-info>
        @if (isLoading()) {
          <div class="p-4 flex justify-center">
            <tas-spinner size="5" class="text-primary"></tas-spinner>
          </div>
        } @else if (user()) {
          <div class="p-4 border-b border-gray-100">
            <p class="text-sm font-medium text-slate-800 truncate">
              {{ user()!.fullName ?? '—' }}
            </p>
            <p class="text-xs text-slate-500 mt-0.5 truncate">{{ user()!.email }}</p>
            @if (user()!.agencyName) {
              <p class="text-xs text-slate-400 mt-1">
                <tas-icon iconName="feather:home" class="inline-block w-3 h-3 mr-1"></tas-icon>
                {{ user()!.agencyName }}
              </p>
            }
          </div>
        }
      </div>
    </crm-navigation>
  `,
})
export class EditUserNavigation {
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public user = signal<UserDto | null>(null);

  public menuItems = signal<MenuItem[]>([
    { label: 'Informations', icon: 'feather:user', route: 'informations', active: true },
    { label: 'Rôles', icon: 'feather:shield', route: 'roles', active: true },
    { label: 'Paramétrage', icon: 'feather:settings', route: 'parametrage', active: true },
    { label: 'Zone de danger', icon: 'feather:alert-triangle', route: 'danger', active: true },
  ]);

  constructor() {
    effect(() => {
      this._usersApiService.getUser(this.id()).subscribe({
        next: (user) => {
          this.user.set(user);
          this.isLoading.set(false);
          this._breadcrumbService.set([
            { label: 'Paramétrage', link: ['/settings'] },
            { label: 'Utilisateurs', link: ['/settings/users'] },
            { label: user.fullName ?? user.email ?? 'Utilisateur' },
          ]);
        },
        error: () => this.isLoading.set(false),
      });
    });
  }

  public statusLabel(status: string | null | undefined): string {
    switch (status) {
      case '0': return 'En attente';
      case '1': return 'Actif';
      case '2': return 'Désactivé';
      case '3': return 'Suspendu';
      default: return '—';
    }
  }
}

export default EditUserNavigation;
