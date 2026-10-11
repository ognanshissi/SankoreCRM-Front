import { Component, HostBinding, Input, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'tas-hint',
  template: `<ng-content></ng-content>`,
  standalone: true,
  encapsulation: ViewEncapsulation.None,

  styles: [
    `
    .tas-hint {
      display: block;
      font-size: 12px !important;
      color: var(--color-slate-400);
    }`
  ]
})
export class TasHint {
  @Input() ariaLabel!: string

  @HostBinding('attr.aria-label')
  ariaLabelAttribute = this.ariaLabel;

  @HostBinding("class")
  get classes() {
    return { 'tas-hint': true };
  }
}
