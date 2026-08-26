import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  ViewEncapsulation,
} from '@angular/core';
import { ButtonModule } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';

@Component({
  selector: 'tas-navigation-navbar',
  standalone: true,
  template: ` <div class="flex space-x-2">
      <button (click)="toggleCollapseMenu.emit()">
        <tas-icon iconName="feather:menu" class="text-gray-500"></tas-icon>
      </button>
      <ng-content select="[tasNavigationNavbarLeft]"></ng-content>
    </div>
    <ng-content select="[tasNavigationNavbarRight]"></ng-content>`,
  styles: [
    `
      @reference "tailwindcss";
      tas-navigation-navbar {
        @apply flex justify-between border-b items-center py-1 px-2 border-gray-300 bg-white sticky top-0;
      }
    `,
  ],
  imports: [ButtonModule, TasIcon],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TasNavigationNavbar {
  public toggleCollapseMenu: EventEmitter<void> = new EventEmitter<void>();
}
