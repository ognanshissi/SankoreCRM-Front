import { CdkMenuItem } from '@angular/cdk/menu';
import { CommonModule } from '@angular/common';
import { Component, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'tas-menu-item',
  standalone: true,
  imports: [CommonModule],
  template: ` <ng-content></ng-content>`,
  hostDirectives: [
    {
      directive: CdkMenuItem,
      inputs: ['cdkMenuItemDisabled: disabled'],
    },
  ],
  encapsulation: ViewEncapsulation.None,
  styles: [
    `
      @reference "../../tailwind-ref.css";
      .cdk-menu-item {
        @apply px-5 py-2 cursor-pointer;
        outline: none;

        &:hover {
          background-color: rgba(var(--tas-color-primary), 0.3);
        }
      }
    `,
  ],
})
export class MenuItem {}
