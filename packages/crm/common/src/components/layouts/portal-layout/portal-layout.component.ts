import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ButtonModule } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import {
  NavigationItem,
  TasNavigationLayout,
  TasNavigationMenu,
  TasNavigationMenuItem,
  TasNavigationNavbar,
  TasNavigationSidebar,
} from '@talisoft/ui/layouts';

@Component({
  selector: 'common-portal-layout',
  standalone: true,
  templateUrl: 'portal-layout.component.html',
  imports: [
    RouterOutlet,
    ButtonModule,
    TasIcon,
    TasNavigationLayout,
    TasNavigationSidebar,
    TasNavigationNavbar,
    TasNavigationMenu,
    TasNavigationMenuItem,
  ],
})
export class PortalLayoutComponent implements OnInit {

  public navigationItems: NavigationItem[] = [];

  public ngOnInit() {
    this.navigationItems = [
      // {
      //   id: 'dashboard',
      //   icon: 'feather:grid',
      //   title: 'Tableau de bord',
      //   type: 'basic',
      //   link: '/portal/dashboard',
      // },
      {
        id: 'tasks',
        icon: 'feather:grid',
        title: 'Ma journée',
        type: 'basic',
        link: '/tasks/my-day',
      },
      {
        id: 'contacts',
        icon: 'feather:phone',
        title: 'leads & contacts',
        type: 'basic',
        link: '/portal/contacts',
      },
      // {
      //   id: 'leads',
      //   icon: 'feather:target',
      //   title: 'Leads',
      //   type: 'basic',
      //   link: '/portal/leads',
      // },
      {
        id: 'customers',
        icon: 'feather:user',
        title: 'Clients 360',
        type: 'basic',
        link: '/portal/customers',
      },
      // {
      //   id: 'loans',
      //   icon: 'feather:percent',
      //   title: 'Prêts et Remboursements',
      //   type: 'basic',
      //   link: '/portal/loans',
      // },
      {
        id: 'workflows',
        icon: 'feather:sliders',
        title: 'Automatisation et workflows',
        type: 'basic',
        link: '/portal/automation-workflows',
      },
    ];
  }
}
