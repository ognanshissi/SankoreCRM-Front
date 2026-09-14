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
    <br/>
  `,
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: [
    `
      @reference "../../tailwind-ref.css";
      tas-card {
        @apply rounded-xl shadow block bg-white;
      }
    `,
  ],
  imports: [],
})
export class TasCard {}
