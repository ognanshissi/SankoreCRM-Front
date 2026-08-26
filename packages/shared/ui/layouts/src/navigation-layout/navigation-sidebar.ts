import {
  ChangeDetectionStrategy,
  Component,
  HostBinding,
  signal,
  ViewEncapsulation,
} from '@angular/core';

@Component({
  selector: 'tas-navigation-sidebar',
  template: ` <ng-content></ng-content> `,
  standalone: true,
  styles: [
    `
      @reference "tailwindcss";
      tas-navigation-sidebar {
        @apply border-r border-gray-300 overflow-y-auto bg-white flex flex-col justify-between;
        height: calc(100vh - 50px);
      }

      .menu-item__text {
        @apply text-[12px];
      }

      .navigation-size__large {
        @apply w-[270px];
      }
      .navigation-size__minimized {
        @apply w-[40px];

        .menu-item__text {
          display: none;
        }
      }
    `,
  ],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TasNavigationSidebar {
  public isMinimized = signal<boolean>(false);

  @HostBinding('class')
  get classes() {
    return {
      'navigation-size__large': !this.isMinimized(),
      'navigation-size__minimized': this.isMinimized(),
    };
  }
}
