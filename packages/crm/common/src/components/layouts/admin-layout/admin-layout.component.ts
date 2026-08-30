import { Component, OnInit } from '@angular/core';
import {
  NavigationItem,
  TasNavigationLayout,
  TasNavigationMenu,
  TasNavigationMenuItem,
  TasNavigationNavbar,
  TasNavigationSidebar,
} from '@talisoft/ui/layouts';
import { RouterOutlet } from '@angular/router';
import { TasIcon } from '@talisoft/ui/icon';
import { ButtonModule } from '@talisoft/ui/button';

@Component({
  selector: 'core-admin-layout',
  template: `
    <tas-navigation-layout>
      <tas-navigation-navbar>
        <div tasNavigationNavbarLeft>
          <p>
            <span class="text-primary text-xl font-bold">Lotchen </span>
            <span class="text-gray-500 text-[10px]">Microfinance</span>
          </p>
        </div>

        <div tasNavigationNavbarRight>
          <div class="flex space-x-4 items-center">
            <div>
              <button tas-raised-button color="primary">
                <tas-icon iconName="feather:plus" iconSize="md"></tas-icon>
              </button>
            </div>
          </div>
        </div>
      </tas-navigation-navbar>
      <tas-navigation-sidebar>
        <div class="flex flex-col justify-between h-full">
          <div>
            <NavigationMenu>
              @for (item of navigationItems; track item.id) {
              <NavigationMenuItem
                [iconName]="item.icon ?? ''"
                [path]="[item.link]"
                >{{ item.title }}
              </NavigationMenuItem>
              }
            </NavigationMenu>
          </div>

          <NavigationMenu>
            <NavigationMenuItem
              iconName="feather:settings"
              [path]="['/admin', 'general-settings']"
            >
              Paramétrage de l'organisation
            </NavigationMenuItem>
          </NavigationMenu>
        </div>
      </tas-navigation-sidebar>
      <router-outlet></router-outlet>
    </tas-navigation-layout>
  `,
  standalone: true,
  imports: [
    RouterOutlet,
    TasNavigationMenuItem,
    TasNavigationMenu,
    TasNavigationLayout,
    TasIcon,
    ButtonModule,
    TasNavigationNavbar,
    TasNavigationSidebar,
  ],
})
export class AdminLayoutComponent implements OnInit {
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
        id: 'containers',
        icon: 'feather:users',
        title: 'Leads & Prospects',
        type: 'basic',
        link: '/portal/prospects',
      },
      {
        id: 'prospects',
        icon: 'feather:users',
        title: 'Leads & Prospects',
        type: 'basic',
        link: '/portal/prospects',
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
        id: 'workflows',
        icon: 'feather:sliders',
        title: 'Automatisation et workflows',
        type: 'basic',
        link: '/portal/automation-workflows',
      },
    ];
  }
}
