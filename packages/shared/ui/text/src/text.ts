import {
  ChangeDetectionStrategy,
  Component,
  HostBinding,
  ViewEncapsulation,
} from '@angular/core';

@Component({
  selector: 'Text, [Text], tas-text',
  template: ` <ng-content></ng-content>`,
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      @reference "../../tailwind-ref.css";
      Text {
        @apply text-gray-700 block text-sm;
      }
    `,
  ],
})
export class TasText {
  @HostBinding('attr.role')
  role = 'paragraph';
}
