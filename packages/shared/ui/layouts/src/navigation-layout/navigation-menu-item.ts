import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  input,
  OnInit,
  ViewEncapsulation,
} from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';
import {
  NavigationExtras,
  RouterLink,
  RouterLinkActive,
  UrlTree,
} from '@angular/router';

@Component({
  selector: 'NavigationMenuItem',
  template: `
    <a
      [routerLink]="path()"
      [routerLinkActive]="'navigation-menu-item__is-active'"
      [queryParams]="queryParams()"
      class="menu-item p-2 hover:bg-gray-200  flex space-x-2 text-sm items-center border-l-4 border-l-transparent"
    >
      <tas-icon [iconName]="iconName()" class="text-gray-500" />
      <span class="menu-item__text"><ng-content></ng-content></span>
    </a>
  `,
  standalone: true,
  imports: [TasIcon, RouterLink, RouterLinkActive],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: 'navigation-menu-item.scss',
})
export class TasNavigationMenuItem implements OnInit {
  public iconName = input<string>('');
  public path = input<string | any[] | UrlTree>();
  public exactMatch = input(false, { transform: booleanAttribute });
  public queryParams = input<NavigationExtras>({});

  public ngOnInit() {}
}
