import { Component, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'card-action',
  template: ` <ng-content></ng-content>`,
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  styles: [
    `
      @reference "../../tailwind-ref.css";
      card-action {
        @apply border-t border-gray-300 p-3 block rounded-b-lg bg-gray-50 flex justify-end space-x-4;
      }
    `,
  ],
})
export class TasCardAction {}
