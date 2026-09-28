import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';

/** Fiche candidate affichée par le bandeau, quelle que soit sa provenance. */
export interface DuplicateCandidateView {
  clientId: string;
  clientNumber: string | null;
  displayName: string | null;
  detail: string | null;
}

/**
 * Bandeau de doublon des assistants de création.
 *
 * Deux usages : l'avertissement non bloquant déclenché à la sortie d'un champ
 * (téléphone, pièce d'identité) et le blocage renvoyé par l'API
 * (`BlockedDuplicateIdentityDocument`, `BlockedDuplicateRegistrationNumber`).
 * Les fiches candidates s'ouvrent dans un nouvel onglet : l'agent garde sa
 * saisie en cours.
 */
@Component({
  selector: 'duplicate-check-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon, TasSpinner, RouterLink],
  template: `
    @if (isChecking()) {
      <div class="flex items-center gap-2 text-xs text-slate-500">
        <tas-spinner size="4" class="text-primary"></tas-spinner>
        <span>Contrôle de doublon en cours…</span>
      </div>
    }

    @if (candidates().length > 0) {
      <div
        class="flex items-start gap-3 rounded-lg border p-3 text-sm"
        [class]="
          variant() === 'blocking'
            ? 'border-red-300 bg-red-50'
            : 'border-amber-300 bg-amber-50'
        "
      >
        <tas-icon
          [iconName]="
            variant() === 'blocking'
              ? 'feather:alert-octagon'
              : 'feather:alert-triangle'
          "
          class="shrink-0 mt-0.5"
          [class]="variant() === 'blocking' ? 'text-red-600' : 'text-amber-600'"
          style="font-size:14px"
        ></tas-icon>

        <div class="flex-1 min-w-0">
          <p
            class="font-medium"
            [class]="variant() === 'blocking' ? 'text-red-800' : 'text-amber-800'"
          >
            {{ title() }}
          </p>
          @if (message()) {
            <p
              class="mt-0.5 text-xs"
              [class]="
                variant() === 'blocking' ? 'text-red-700' : 'text-amber-700'
              "
            >
              {{ message() }}
            </p>
          }

          <ul class="mt-2 flex flex-col gap-2">
            @for (candidate of candidates(); track candidate.clientId) {
              <li
                class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-white/70 px-3 py-2"
              >
                <span class="text-sm font-medium text-slate-800">
                  {{ candidate.displayName ?? 'Client sans nom' }}
                </span>
                @if (candidate.clientNumber) {
                  <span class="text-xs text-slate-500 tabular-nums">
                    {{ candidate.clientNumber }}
                  </span>
                }
                @if (candidate.detail) {
                  <span class="text-xs text-slate-400">{{ candidate.detail }}</span>
                }
                <a
                  class="ml-auto text-xs font-medium text-primary underline"
                  [routerLink]="['/customers', candidate.clientId]"
                  target="_blank"
                  rel="noopener"
                >
                  Ouvrir la fiche
                </a>
              </li>
            }
          </ul>

          <div class="mt-2 empty:mt-0">
            <ng-content></ng-content>
          </div>
        </div>
      </div>
    }
  `,
})
export class DuplicateCheckBanner {
  public candidates = input<DuplicateCandidateView[]>([]);
  public variant = input<'warning' | 'blocking'>('warning');
  public title = input('Doublon potentiel détecté');
  public message = input<string | null>(null);
  public isChecking = input(false);
}
