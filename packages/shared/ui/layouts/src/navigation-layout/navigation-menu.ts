import { Component, contentChildren, HostBinding } from '@angular/core';
import { TasNavigationMenuItem } from './navigation-menu-item';

@Component({
  selector: 'NavigationMenu',
  template: ` <ng-content></ng-content> `,
  standalone: true,
})
export class TasNavigationMenu {
  static nextId = 0;

  @HostBinding()
  id = `navigation-menu-id-${TasNavigationMenu.nextId++}`;

  @HostBinding('attr.role')
  role = 'listbox';

  public navigationMenuItems = contentChildren<TasNavigationMenuItem>(
    TasNavigationMenuItem,
    { descendants: true }
  );
}
