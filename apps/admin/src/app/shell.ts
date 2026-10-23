import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { AdminAuthService } from '@sankore/admin/auth';

/** Cadre commun des écrans connectés : en-tête, navigation, opérateur et déconnexion. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Button, TasIcon],
  template: `
    <div class="flex min-h-screen flex-col bg-surface">
      <header class="flex flex-wrap items-center justify-between gap-4 bg-white px-6 py-3 shadow-xs">
        <div class="flex items-center gap-6">
          <p class="text-sm font-bold text-slate-800">Sankore · Administration</p>
          <nav aria-label="Navigation principale" class="flex gap-1">
            <a
              routerLink="/tenants"
              routerLinkActive="bg-primary/10 text-primary"
              ariaCurrentWhenActive="page"
              class="rounded-full px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900"
              >Tenants</a
            >
            <a
              routerLink="/modules/demandes"
              routerLinkActive="bg-primary/10 text-primary"
              ariaCurrentWhenActive="page"
              class="rounded-full px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900"
              >Demandes de modules</a
            >
            <a
              routerLink="/modules/catalogue"
              routerLinkActive="bg-primary/10 text-primary"
              ariaCurrentWhenActive="page"
              class="rounded-full px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900"
              >Catalogue des modules</a
            >
          </nav>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-sm text-slate-600">{{ auth.currentAdmin()?.fullName }}</span>
          <button tas-outlined-button color="primary" type="button" (click)="auth.logout()">
            <tas-icon iconName="feather:log-out" style="font-size: 14px"></tas-icon>
            Se déconnecter
          </button>
        </div>
      </header>
      <main class="mx-auto w-full max-w-7xl px-6 py-8">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
})
export class AdminShell {
  protected readonly auth = inject(AdminAuthService);
}

export default AdminShell;
