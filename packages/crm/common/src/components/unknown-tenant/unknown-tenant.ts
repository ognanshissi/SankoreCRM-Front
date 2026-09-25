import { Component, inject } from '@angular/core';
import { TenantProvider } from '../../services';

@Component({
  selector: 'unknown-tenant',
  standalone: true,
  template: `
    <div class="min-h-screen flex items-center justify-center bg-slate-50">
      <div class="max-w-md w-full text-center p-8">
        <div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-6">
          <svg class="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/>
          </svg>
        </div>
        <h1 class="text-xl font-semibold text-slate-800 mb-2">Organisation introuvable</h1>
        <p class="text-sm text-slate-500 mb-6">
          Impossible de charger la configuration de votre organisation.
          Vérifiez l'adresse ou contactez votre administrateur.
        </p>
        <p class="text-xs text-slate-400 mb-4 font-mono">{{ currentOrigin }}</p>
        <button class="px-4 py-2 bg-slate-800 text-white text-sm rounded-lg hover:bg-slate-700 transition-colors"
                (click)="retry()">
          Réessayer
        </button>
      </div>
    </div>
  `,
})
export class UnknownTenantComponent {
  private readonly _tenantProvider = inject(TenantProvider);

  public readonly currentOrigin = this._tenantProvider.getFqdn();

  public retry(): void {
    window.location.reload();
  }
}

export default UnknownTenantComponent;
