import { Component, input } from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MenuItem } from '@sankore/crm/common';

@Component({
  selector: 'crm-navigation',
  imports: [TasIcon, TasCard, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: 'navigation.html',
  styles: [
    `
      .is-link-active {
        background-color: rgba(var(--tas-color-primary), 0.2);
        color: var(--tas-color-primary);
      }
    `,
  ],
})
export class Navigation {
  public menuItems = input<MenuItem[]>([]);
}
