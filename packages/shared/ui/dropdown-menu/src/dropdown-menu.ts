import { ViewEncapsulation, Component, ChangeDetectionStrategy } from "@angular/core";

@Component({
  selector: 'tas-dropdown-menu',
  templateUrl: './dropdown-menu.html',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      @reference "../../tailwind-ref.css";
      tas-dropdown-menu {
        @apply relative;
      }
    `,
  ],
})  
export class DropdownMenu {

 }