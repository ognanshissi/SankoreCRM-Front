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
      font-size: 10px;
      color: var(--color-neutral);
    }`
  ]
})
export class TasHint {
  @Input() ariaLabel!: string

  @HostBinding('attr.aria-label')
  ariaLabelAttribute = this.ariaLabel
}
