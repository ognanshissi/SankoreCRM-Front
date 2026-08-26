import {
  AfterViewInit,
  booleanAttribute,
  Component,
  contentChild,
  input,
} from '@angular/core';
import { TasDrawerTitle } from './drawer-title';
import { TasDrawerContent } from './drawer-content';
import { TasDrawerAction } from './drawer-action';

const DEFAULT_SIDE_DRAWER_WIDTH = '600px';

@Component({
  selector: 'tas-side-drawer',
  standalone: true,
  template: `
    <div
      class="absolute top-0 left-0 right-0 flex justify-end w-full h-full overflow-y-hidden items-center"
    >
      <div
        class="bg-white  relative flex justify-between flex-col h-full overflow-hidden"
        [style.width]="width()"
      >
        <div>
          <ng-content select="tas-drawer-title"></ng-content>
          <div
            class="overflow-y-auto p-4"
            style="height: calc(100vh - 58px); padding-bottom: 100px"
          >
            <ng-content select="tas-drawer-content"></ng-content>
          </div>
        </div>
        <ng-content select="tas-drawer-action"></ng-content>
      </div>
    </div>
  `,
})
export class TasSideDrawer implements AfterViewInit {
  public width = input<string>(DEFAULT_SIDE_DRAWER_WIDTH);

  public titleDrawer = contentChild<TasDrawerTitle>(TasDrawerTitle, {
    descendants: true,
  });
  public contentDrawer = contentChild<TasDrawerContent>(TasDrawerContent, {
    descendants: true,
  });

  public actionsDrawer = contentChild<TasDrawerAction>(TasDrawerAction, {
    descendants: true,
  });

  public closable = input(true, { transform: booleanAttribute });

  public ngAfterViewInit() {
    if (this.titleDrawer) {
      this.titleDrawer()?.closable.set(this.closable());
    }
  }
}
