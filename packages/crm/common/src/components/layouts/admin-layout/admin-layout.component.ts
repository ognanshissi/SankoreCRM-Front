import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {
  CommonNavigationItem,
  CommonNavigationUser,
  NavigationComponent,
} from '../../navigation/navigation';

@Component({
  selector: 'core-admin-layout',
  template: `
    <div class="flex h-screen">
      <common-navigation
        brandName="SankoreCRM"
        [items]="navigationItems"
        [user]="user"
      />
      <main class="flex-1 overflow-y-auto">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  standalone: true,
  imports: [RouterOutlet, NavigationComponent],
})
export class AdminLayoutComponent {
  public user: CommonNavigationUser = {
    name: 'Ambroise BAZIE',
    email: 'admin@sankore.com',
  };

  public navigationItems: CommonNavigationItem[] = [
    { label: 'Ma journée', icon: 'feather:grid', link: '/tasks/my-day' },
    { label: 'Leads & Prospects', icon: 'feather:users', link: '/portal/prospects' },
    { label: 'Clients', icon: 'feather:user', link: '/portal/clients' },
    {
      label: 'Prêts et Remboursements',
      icon: 'feather:percent',
      link: '/portal/loans',
    },
    {
      label: 'Rapports et Analyses',
      icon: 'feather:pie-chart',
      link: '/portal/reports',
    },
    {
      label: 'Produits et Services',
      icon: 'feather:shopping-bag',
      link: '/portal/products',
    },
    {
      label: 'Automatisation et workflows',
      icon: 'feather:sliders',
      link: '/portal/automation-workflows',
    },
    {
      label: "Paramétrage de l'organisation",
      icon: 'feather:settings',
      link: '/admin/general-settings',
    },
  ];
}
