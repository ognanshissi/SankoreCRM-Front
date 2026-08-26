import { inject, Injectable } from '@angular/core';
import { Dialog, DialogConfig, DialogRef } from '@angular/cdk/dialog';
import { ComponentType } from '@angular/cdk/overlay';
import { TasSideDrawer } from './side-drawer';

@Injectable({
  providedIn: 'root',
})
export class SideDrawerService {
  private readonly _dialog = inject(Dialog);

  public open<R = unknown, D = unknown, C = TasSideDrawer>(
    component: ComponentType<C>,
    config?: DialogConfig<D, DialogRef<R, C>>
  ): DialogRef<R, C> {
    return this._dialog.open(component, config);
  }
}
