import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostBinding,
  input,
  ViewEncapsulation,
} from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';

export type AlertType = 'success' | 'error' | 'info';

@Component({
  selector: 'tas-alert',
  standalone: true,
  template: `
    <tas-icon [iconName]="iconName()"></tas-icon>
    <div class="alert-content">
      <ng-content></ng-content>
    </div>
  `,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      @reference "../../tailwind-ref.css";
      tas-alert {
        @apply rounded-lg p-4 border border-gray-300 shadow-lg flex space-x-3;

        &.tas-alert__success {
          @apply text-functional-success border-functional-success;
        }

        &.tas-alert__info {
          @apply text-functional-info border-functional-info;
        }

        &.tas-alert__error {
          @apply border-functional-error text-functional-error;
        }
      }
    `,
  ],
  imports: [TasIcon, TasIcon],
})
export class TasAlert {
  public type = input<AlertType>('info');

  public iconName = computed(() => {
    switch (this.type()) {
      case 'success':
        return 'feather:check-circle';
      case 'error':
        return 'feather:alert-triangle';
      default:
        return 'feather:info';
    }
  });

  @HostBinding('class')
  public get classes() {
    return {
      'tas-alert__success': this.type() === 'success',
      'tas-alert__error': this.type() === 'error',
      'tas-alert__info': this.type() === 'info',
    };
  }
}
