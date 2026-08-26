import {
  ChangeDetectionStrategy,
  Component,
  HostBinding,
  Input,
  input,
  ViewEncapsulation,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'tas-icon',
  template: `<mat-icon [svgIcon]="iconName" [class]="iconClass()"></mat-icon>`,
  standalone: true,
  imports: [MatIconModule],
  exportAs: 'tasIcon',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      @reference "../../tailwind-ref.css";
      tas-icon {
        @apply flex items-center;
      }

      .tas-icon-size__sm {
        transform: scale(0.7);
      }

      .tas-icon-size__md {
        transform: scale(0.9);
      }

      .tas-icon-size__xl {
        transform: scale(1.4);
      }

      .tas-icon-size__2xl {
        transform: scale(2.8);
      }
    `,
  ],
})
export class TasIcon {
  @Input({
    required: true,
  })
  iconName!: string;

  public iconSize = input<'sm' | 'md' | 'lg' | 'xl' | '2xl'>('sm');
  iconClass = input();

  ariaHidden = input({
    alias: 'aria-hidden',
  });

  @HostBinding('aria-hidden')
  get aria() {
    return this.ariaHidden;
  }

  @HostBinding('class')
  get classes() {
    return {
      'tas-icon-size__sm': this.iconSize() === 'sm',
      'tas-icon-size__md': this.iconSize() === 'md',
      'tas-icon-size__lg': this.iconSize() === 'lg',
      'tas-icon-size__xl': this.iconSize() === 'xl',
      'tas-icon-size__2xl': this.iconSize() === '2xl',
    };
  }
}
