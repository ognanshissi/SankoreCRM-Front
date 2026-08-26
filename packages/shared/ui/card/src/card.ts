import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
} from '@angular/core';

@Component({
  selector: 'tas-card',
  template: `
    <ng-content select="card-header"></ng-content>
    <ng-content></ng-content>
    <ng-content select="card-action"></ng-content>
  `,
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: [
    `
      @reference "../../tailwind-ref.css";
      tas-card {
        @apply rounded-lg border border-gray-300 block bg-white;
      }
    `,
  ],
  imports: [],
})
export class TasCard {}
