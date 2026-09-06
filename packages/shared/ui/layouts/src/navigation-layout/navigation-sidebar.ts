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
        @apply  overflow-y-auto flex flex-col justify-between h-full;
        background-color: var(--color-primary);
        color: var(--tas-color-white);
      }

      .menu-item__text {
        @apply text-[12px];
      }

      .navigation-size__large {
        @apply w-[270px];

         .menu-item {
         @apply mx-4;
        }
      }
      .navigation-size__minimized {
        @apply w-[50px];

        .menu-item__text {
          display: none;
        }

        .menu-item {
         @apply rounded-none p-3;
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
