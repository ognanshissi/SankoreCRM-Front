import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';
import { DuplicateMatchResult } from '@sankore/crm-api';

@Component({
  selector: 'duplicate-warning-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon],
  template: `
    @if (duplicates().length > 0) {
      <div class="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
        <tas-icon iconName="feather:alert-triangle" class="text-amber-600 shrink-0 mt-0.5"></tas-icon>
        <div class="flex-1">
          <p class="font-medium text-amber-800">Doublon potentiel détecté</p>
          <p class="text-amber-700 mt-1">
            {{ duplicates()[0].fullName }} — {{ duplicates()[0].phoneNumber }}
          </p>
          <button
            type="button"
            class="text-amber-800 underline font-medium mt-1 cursor-pointer"
            (click)="viewDuplicate.emit(duplicates()[0].leadId!)"
          >
            Voir le lead existant
          </button>
          @if (duplicates().length > 1) {
            <p class="text-amber-600 mt-1">
              + {{ duplicates().length - 1 }} autre(s) correspondance(s)
            </p>
          }
        </div>
      </div>
    }
  `,
})
export class DuplicateWarningBanner {
  public duplicates = input<DuplicateMatchResult[]>([]);
  public viewDuplicate = output<string>();
}
