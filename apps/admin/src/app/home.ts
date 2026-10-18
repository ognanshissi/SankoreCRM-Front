import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { AdminAuthService } from '@sankore/admin/auth';

/** Page d'accueil provisoire : prouve la session de bout en bout en attendant les écrans tenants. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, TasIcon],
  template: `
    <main class="flex min-h-screen flex-col bg-surface">
      <header class="flex items-center justify-between gap-4 bg-white px-6 py-4 shadow-xs">
        <p class="text-sm font-bold text-slate-800">Sankore · Administration</p>
        <div class="flex items-center gap-3">
          <span class="text-sm text-slate-600">{{ auth.currentAdmin()?.fullName }}</span>
          <button tas-outlined-button color="primary" type="button" (click)="auth.logout()">
            <tas-icon iconName="feather:log-out" style="font-size: 14px"></tas-icon>
            Se déconnecter
          </button>
        </div>
      </header>
      <section class="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 py-10">
        <h1 class="text-xl font-bold text-slate-800">Bienvenue, {{ auth.currentAdmin()?.fullName }}</h1>
        <p class="text-sm text-slate-500">Connecté en tant que {{ auth.currentAdmin()?.email }}.</p>
      </section>
    </main>
  `,
})
export class AdminHome {
  protected readonly auth = inject(AdminAuthService);
}

export default AdminHome;
