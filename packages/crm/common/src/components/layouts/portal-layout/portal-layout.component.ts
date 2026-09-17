import { Component, inject, OnInit, signal } from '@angular/core';
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
import { BreadcrumbComponent } from '../../breadcrumb/breadcrumb.component';
import { TenantProvider } from '../../../services';
import { TenantContextResponse } from '@sankore/crm-api';

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
    BreadcrumbComponent,
  ],
})
export class PortalLayoutComponent implements OnInit {

  public navigationItems: NavigationItem[] = [];
  private readonly _tenantProvider = inject(TenantProvider);

  public tenantContext = this._tenantProvider.context();

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
        id: 'my-queue',
        icon: 'feather:inbox',
        title: 'Ma file',
        type: 'basic',
        link: '/settings/workflows/ma-file',
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
