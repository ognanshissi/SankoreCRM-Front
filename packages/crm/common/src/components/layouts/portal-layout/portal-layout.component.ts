import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
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
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import { BreadcrumbComponent } from '../../breadcrumb/breadcrumb.component';
import { TenantProvider, AuthenticationService } from '../../../services';
import { TenantContextResponse } from '@sankore/crm-api';

@Component({
  selector: 'common-portal-layout',
  standalone: true,
  templateUrl: 'portal-layout.component.html',
  imports: [
    RouterOutlet,
    RouterLink,
    ButtonModule,
    TasIcon,
    TasNavigationLayout,
    TasNavigationSidebar,
    TasNavigationNavbar,
    TasNavigationMenu,
    TasNavigationMenuItem,
    BreadcrumbComponent,
    Menu,
    MenuItem,
    TasMenuTrigger,
  ],
})
export class PortalLayoutComponent implements OnInit {

  public navigationItems: NavigationItem[] = [];
  private readonly _tenantProvider = inject(TenantProvider);
  private readonly _auth = inject(AuthenticationService);

  public companyName = computed(() => {
    return this._tenantProvider.context()?.companyName
  });
  public readonly userName = computed(() => this._auth.connectedUser()?.fullName ?? this._auth.connectedUser()?.email ?? 'Utilisateur');
  public readonly userEmail = computed(() => this._auth.connectedUser()?.email ?? 'Utilisateur');
  public readonly userRole = computed(() => {
    if (this._auth.connectedUser()?.roles?.length) {
      return (this._auth.connectedUser()?.roles || [])[0] ?? 'No Role';
    }
    return "No Role";
  });

  public logout(): void {
    this._auth.logout();
  }

  public ngOnInit() {
    console.log(this._auth.connectedUser());
    this.navigationItems = [
      // {
      //   id: 'dashboard',
      //   icon: 'feather:grid',
      //   title: 'Tableau de bord',
      //   type: 'basic',
      //   link: '/portal/dashboard',
      // },
      {
        id: 'leads-analytics',
        icon: 'feather:bar-chart-2',
        title: 'Tableau de bord',
        type: 'basic',
        link: '/leads/analytics',
      },
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
        title: 'leads',
        type: 'basic',
        link: '/leads',
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
      // {
      //   id: 'workflows',
      //   icon: 'feather:sliders',
      //   title: 'Automatisation et workflows',
      //   type: 'basic',
      //   link: '/portal/automation-workflows',
      // },
      {
        id: 'workflow-health',
        icon: 'feather:activity',
        title: 'Analytiques workflows',
        type: 'basic',
        link: '/settings/workflows/analytiques',
      },
    ];
  }
}
