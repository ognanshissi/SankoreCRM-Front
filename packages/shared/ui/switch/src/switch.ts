import { Component, input, output } from '@angular/core';
import { TasSpinner } from '@talisoft/ui/spinner';

@Component({
  selector: 'tas-switch',
  standalone: true,
  imports: [TasSpinner],
  template: `
    <button
      type="button"
      role="switch"
      [attr.aria-checked]="checked()"
      [attr.aria-label]="ariaLabel()"
      class="relative flex-shrink-0 w-10 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed"
      [class.bg-primary]="checked()"
      [class.bg-slate-200]="!checked()"
      [disabled]="disabled() || isLoading()"
      (click)="toggle.emit(!checked())"
    >
      <span
        class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-150"
        [class.translate-x-4]="checked()"
      ></span>
      @if (isLoading()) {
        <span class="absolute inset-0 flex items-center justify-center">
          <tas-spinner size="3" class="text-white"></tas-spinner>
        </span>
      }
    </button>
  `,
})
export class TasSwitch {
  public checked = input<boolean>(false);
  public disabled = input<boolean>(false);
  public isLoading = input<boolean>(false);
  public ariaLabel = input<string>('');
  // `toggle` est bien un nom d'évènement DOM, mais seulement sur `<details>` et `<dialog>` :
  // ni l'un ni l'autre n'apparaît dans le template de `tas-switch`, donc aucune collision
  // n'est possible ici. Le renommer casserait les 23 liaisons `(toggle)` du CRM — ce qui
  // reste une option, mais à faire volontairement, pas au détour d'un correctif de lint.
  // eslint-disable-next-line @angular-eslint/no-output-native
  public toggle = output<boolean>();
}
