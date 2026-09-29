import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TasIcon } from '@talisoft/ui/icon';
import { LeadEditContext } from './lead-edit-context';

/**
 * Bandeau posé en tête des onglets dont les actions sont désactivées par la
 * conversion. Il ne s'affiche que sur un lead converti : un bouton grisé sans
 * explication se lit comme une panne ou comme un droit manquant.
 */
@Component({
  selector: 'converted-lead-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon, RouterLink, DatePipe],
  template: `
    @if (context.isConverted()) {
      <div class="flex gap-3 p-3 rounded-lg bg-green-50 border border-green-200 mb-4">
        <tas-icon
          iconName="feather:user-check"
          class="text-green-700 shrink-0 mt-0.5"
          style="font-size:14px"
        ></tas-icon>
        <div class="text-sm text-slate-700">
          <p>
            Ce lead a été converti en client@if (context.convertedAt(); as at) {
              le {{ at | date: 'longDate' }}
            } : il n'est plus modifiable.
          </p>
          @if (context.customerId(); as customerId) {
            <a
              class="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-1"
              [routerLink]="['/customers', customerId]"
            >
              <tas-icon iconName="feather:external-link" style="font-size:11px"></tas-icon>
              Ouvrir la fiche client
            </a>
          } @else {
            <p class="text-xs text-slate-500 mt-1">
              Les modifications se font désormais sur la fiche client.
            </p>
          }
        </div>
      </div>
    }
  `,
})
export class ConvertedLeadNotice {
  public readonly context = inject(LeadEditContext);
}
