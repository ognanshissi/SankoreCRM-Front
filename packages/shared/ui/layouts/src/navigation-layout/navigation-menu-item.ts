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
      [routerLinkActiveOptions]="{exact: true}"
      class="menu-item p-4 flex space-x-2 text-xl items-center rounded-xl cursor-pointer mt-2"
    >
      @if(iconName()) {
        <tas-icon [iconName]="iconName()" class="text-white" />
      }
      <span class="menu-item__text text-xl"><ng-content></ng-content></span>
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
  public path = input.required<string | any[] | UrlTree>();
  public exactMatch = input(false, { transform: booleanAttribute });
  public queryParams = input<NavigationExtras>({});

  public ngOnInit() {}
}
