import { Component, HostBinding, Input } from '@angular/core';

@Component({
  selector: 'tas-hint',
  template: `<ng-content></ng-content>`,
  standalone: true,
  styles: [
    `
    @reference "../../tailwind-ref.css";
    tas-hint {
        display: block;
        @apply text-[11px] font-sans text-gray-700;
    }`
  ]
})
export class TasHint {
  @Input() ariaLabel!: string

  @HostBinding('attr.aria-label')
  ariaLabelAttribute = this.ariaLabel
}
