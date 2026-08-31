import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'tas-error',
  template: `<p class="block text-red-400 text-xs">
    <ng-content></ng-content>
  </p>`,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TasError {}
