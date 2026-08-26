import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
} from '@angular/core';

@Component({
  selector: 'tas-drawer-action',
  standalone: true,
  template: ` <ng-content></ng-content> `,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      @reference "../../tailwind-ref.css";
      tas-drawer-action {
        @apply block bg-white border-t border-gray-300 px-2 sticky bottom-0 flex justify-end space-x-4 mt-4 py-3 z-10 w-full;
      }
    `,
  ],
})
export class TasDrawerAction {}
