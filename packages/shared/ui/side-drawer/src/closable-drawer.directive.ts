import {
  booleanAttribute,
  Directive,
  HostListener,
  inject,
  Input,
} from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';

@Directive({
  selector: '[closable-drawer]',
  standalone: true,
})
export class TasClosableDrawer {
  private readonly _dialogRef = inject(DialogRef);
  @Input({ transform: booleanAttribute, alias: 'closable-drawer' }) closable =
    false;

  @HostListener('click')
  public handleClick() {
    if (this.closable) {
      this._dialogRef.close();
    }
  }
}
