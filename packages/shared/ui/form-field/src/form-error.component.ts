import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'tas-error',
  template: `<ng-content></ng-content>`,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      @reference "../../tailwind-ref.css";
      tas-error {
          @apply block text-red-400 text-xs;
      }
      
      tas-error:before {
          @apply text-red-400 bg-red-400 inline-block;
          color: red;
          content: " ";
          background-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" > <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /> </svg>');
          background-repeat: no-repeat;
          background-origin: initial;
          background-position: 0 100%;
          background-size: 100% 100%;
          font-size: 1rem;
      }
    `
  ],
  standalone: true,
})
export class TasError {}
