import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgClass } from '@angular/common';
import { Navigation } from '../../../components/navigation/navigation';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { RolesApiService, RoleDetailDto } from '@sankore/crm-api';
import { Anchor } from '@talisoft/ui/button';
import { BreadcrumbService, MenuItem } from '@sankore/crm/common';

@Component({
  imports: [Navigation, RouterLink, NgClass, TasIcon, TasSpinner, Anchor],
  template: `
    <crm-navigation [menuItems]="menuItems()">
      <div tas-navigation-top>
        <div class="flex items-center gap-3 mb-2">
          <a [routerLink]="['/settings/roles']" tas-button iconButton>
            <tas-icon iconName="feather:chevron-left"></tas-icon>
          </a>
          <div class="flex-1 min-w-0">
            @if (isLoading()) {
              <div class="h-5 w-40 bg-slate-200 rounded animate-pulse"></div>
            } @else {
              <h1 class="text-lg font-semibold text-slate-900 truncate">
                {{ role()?.label ?? role()?.name ?? 'Rôle' }}
              </h1>
            }
          </div>
          @if (!isLoading() && role()) {
            <span
              class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0"
              [ngClass]="{
                'bg-slate-100 text-slate-600': role()!.isSystem,
                'bg-blue-100 text-blue-700': !role()!.isSystem,
              }"
            >
              {{ role()!.isSystem ? 'Système' : 'Personnalisé' }}
            </span>
          }
        </div>
      </div>

      <div tas-navigation-info>
        @if (isLoading()) {
          <div class="p-4 flex justify-center">
            <tas-spinner size="5" class="text-primary"></tas-spinner>
          </div>
        } @else if (role()) {
          <div class="p-4 border-b border-gray-100">
            <p class="font-mono text-xs text-slate-500 mb-1">
              {{ role()!.name }}
            </p>
            <p class="text-sm font-medium text-slate-800 truncate">
              {{ role()!.label ?? role()!.name }}
            </p>
            <div class="flex items-center gap-2 mt-2">
              <span
                class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                [ngClass]="{
                  'bg-slate-100 text-slate-600': role()!.isSystem,
                  'bg-blue-100 text-blue-700': !role()!.isSystem,
                }"
              >
                {{ role()!.isSystem ? 'Système' : 'Personnalisé' }}
              </span>
              @if (role()!.isAssignable) {
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700"
                >
                  Assignable
                </span>
              }
            </div>
          </div>
        }
      </div>
    </crm-navigation>
  `,
})
export class EditRoleNavigation {
  private readonly _rolesApiService = inject(RolesApiService);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public role = signal<RoleDetailDto | null>(null);

  public menuItems = signal<MenuItem[]>([
    { label: 'Informations', icon: 'feather:info', route: 'informations', active: true },
    { label: 'Permissions', icon: 'feather:shield', route: 'permissions', active: true },
    { label: 'Utilisateurs', icon: 'feather:users', route: 'users', active: true },
    { label: 'Zone de danger', icon: 'feather:alert-triangle', route: 'danger', active: true },
  ]);

  constructor() {
    effect(() => {
      this._rolesApiService.getRole(this.id()).subscribe({
        next: (role) => {
          this.role.set(role);
          this.isLoading.set(false);
          this._breadcrumbService.set([
            { label: 'Paramétrage', link: ['/settings'] },
            { label: 'Rôles', link: ['/settings/roles'] },
            { label: role.label ?? role.name ?? 'Rôle' },
          ]);
        },
        error: () => {
          this.isLoading.set(false);
        },
      });
    });
  }
}

export default EditRoleNavigation;
