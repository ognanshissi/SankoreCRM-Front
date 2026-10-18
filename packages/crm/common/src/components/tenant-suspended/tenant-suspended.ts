import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { TenantProvider } from '../../services';

/**
 * Affichée quand l'institution existe mais n'est pas accessible : désactivée depuis
 * l'administration, ou en maintenance (`?raison=maintenance`).
 *
 * Distincte de `unknown-tenant` : « organisation introuvable » dit à l'utilisateur de vérifier
 * l'adresse, alors que l'adresse est la bonne — c'est l'accès qui est suspendu, et seul son
 * administrateur peut le rétablir.
 */
@Component({
  selector: 'tenant-suspended',
  template: `
    <div class="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div class="w-full max-w-md p-8 text-center">
        <div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full"
             [class]="isMaintenance() ? 'bg-amber-100' : 'bg-slate-200'">
          <svg class="h-8 w-8" [class]="isMaintenance() ? 'text-amber-600' : 'text-slate-600'" fill="none"
               stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            @if (isMaintenance()) {
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            } @else {
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            }
          </svg>
        </div>
        <h1 class="mb-2 text-xl font-semibold text-slate-800">
          {{ isMaintenance() ? 'Maintenance en cours' : 'Accès suspendu' }}
        </h1>
        <p class="mb-6 text-sm text-slate-600">
          @if (isMaintenance()) {
            {{ name() }} est temporairement indisponible pendant une intervention. Réessayez dans quelques minutes.
          } @else {
            L'accès de {{ name() }} à SANKORE est suspendu. Vos données sont conservées : contactez votre
            administrateur ou le support SANKORE pour le rétablir.
          }
        </p>
        <button type="button"
                class="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white transition-colors hover:bg-slate-700"
                (click)="retry()">
          Réessayer
        </button>
      </div>
    </div>
  `,
})
export class TenantSuspendedComponent {
  private readonly _tenantProvider = inject(TenantProvider);

  public readonly isMaintenance = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((p) => p.get('raison') === 'maintenance')),
    { initialValue: false },
  );

  public readonly name = computed(() => {
    const ctx = this._tenantProvider.context();
    return ctx?.companyName || ctx?.name || 'votre organisation';
  });

  /** Un rechargement complet : le contexte du tenant n'est relu qu'au démarrage de l'application. */
  public retry(): void {
    window.location.assign('/auth/login');
  }
}

export default TenantSuspendedComponent;
