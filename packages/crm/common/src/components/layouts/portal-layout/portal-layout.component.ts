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
      {
        id: 'dashboard',
        icon: 'feather:grid',
        title: 'Tableau de bord',
        type: 'basic',
        link: '/portal/dashboard',
      },
      {
        id: 'tasks',
        icon: 'feather:crosshair',
        title: 'Tâches',
        type: 'basic',
        link: '/portal/tasks',
      },
      {
        id: 'contacts',
        icon: 'feather:users',
        title: 'Contacts',
        type: 'basic',
        link: '/portal/contacts',
      },
      {
        id: 'leads',
        icon: 'feather:target',
        title: 'Leads',
        type: 'basic',
        link: '/portal/leads',
      },
      {
        id: 'events',
        icon: 'feather:calendar',
        title: 'Événements',
        type: 'basic',
        link: '/portal/events',
      },
      {
        id: 'clients',
        icon: 'feather:user',
        title: 'Clients',
        type: 'basic',
        link: '/portal/clients',
      },
      {
        id: 'loans',
        icon: 'feather:percent',
        title: 'Prêts et Remboursements',
        type: 'basic',
        link: '/portal/loans',
      },
      {
        id: 'reports',
        icon: 'feather:pie-chart',
        title: 'Rapports et Analyses',
        type: 'basic',
        link: '/portal/reports',
      },
      {
        id: 'products',
        icon: 'feather:shopping-bag',
        title: 'Produits et Services',
        type: 'basic',
        link: '/portal/products',
      },
      {
        id: 'pipelines',
        icon: 'feather:trello',
        title: 'Pipelines de vente',
        type: 'basic',
        link: '/portal/pipelines',
      },
      {
        id: 'workflows',
        icon: 'feather:sliders',
        title: 'Automatisation et workflows',
        type: 'basic',
        link: '/portal/automation-workflows',
      },
      {
        id: 'campaigns',
        icon: 'feather:send',
        title: 'Campagnes',
        type: 'basic',
        link: '/portal/campaigns',
      },
    ];
  }
}
