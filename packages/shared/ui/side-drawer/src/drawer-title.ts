import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';
import { TasClosableDrawer } from './closable-drawer.directive';
import { ButtonModule } from '@talisoft/ui/button';

@Component({
  selector: 'tas-drawer-title',
  standalone: true,
  template: `
    <div class="mr-4 block">
      <ng-content></ng-content>
    </div>
    @if (closable()) {
    <button
      closable-drawer
      iconButton
      tas-button
      type="button"
      title="close side drawer"
    >
      <tas-icon iconName="close" aria-label="Close side drawer Icon"></tas-icon>
    </button>
    }
  `,
  styles: [
    `
      @reference "../../tailwind-ref.css";
      tas-drawer-title {
        @apply px-4 py-3 border-b border-b-gray-200 sticky top-0 bg-white z-10 flex justify-between items-center rounded-t-xl;
      }
    `,
  ],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon, TasClosableDrawer, ButtonModule],
})
export class TasDrawerTitle {
  public closable = signal<boolean>(false);
}
