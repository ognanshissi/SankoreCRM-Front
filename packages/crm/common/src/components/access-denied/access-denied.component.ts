import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TasAlert } from '@talisoft/ui/alert';
import { TasIcon } from '@talisoft/ui/icon';
import { AccessDeniedService } from './access-denied.service';

/**
 * Bannière affichée quand une garde de route refuse l'accès à une page.
 *
 * Montée une seule fois dans la coquille de l'application, comme `<loader />` :
 * le refus est signalé par une garde, pas par l'écran d'arrivée, qui n'a aucune
 * raison de savoir d'où vient l'utilisateur.
 */
@Component({
  selector: 'access-denied-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasAlert, TasIcon],
  template: `
    @if (service.notice(); as denial) {
      <div
        class="fixed top-4 left-1/2 -translate-x-1/2 z-[1000] w-full max-w-2xl px-4"
        role="status"
        aria-live="polite"
      >
        <tas-alert type="info" class="bg-white">
          <div class="flex items-start gap-3 w-full">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium">Accès refusé</p>
              <p class="text-xs text-slate-600 mt-0.5">
                Vous n'avez pas la permission d'ouvrir
                <span class="font-mono">{{ denial.attemptedUrl }}</span>.
              </p>
              @if (denial.required.length > 0) {
                <p class="text-xs text-slate-500 mt-1">
                  Permission requise :
                  @for (code of denial.required; track code) {
                    <span
                      class="font-mono bg-slate-100 text-slate-600 rounded px-1 py-0.5 ml-1"
                      >{{ code }}</span
                    >
                  }
                </p>
              }
            </div>
            <button
              type="button"
              class="shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
              aria-label="Fermer"
              (click)="service.dismiss()"
            >
              <tas-icon iconName="feather:x" style="font-size:14px"></tas-icon>
            </button>
          </div>
        </tas-alert>
      </div>
    }
  `,
})
export class AccessDeniedBanner {
  public readonly service = inject(AccessDeniedService);
}
