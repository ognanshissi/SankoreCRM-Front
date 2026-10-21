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
import { ImpersonationBanner } from '../../impersonation-banner/impersonation-banner';
import { TenantProvider, AuthenticationService, PermissionsService } from '../../../services';
import { TenantContextResponse } from '@sankore/crm-api';
// La pastille est LOCALE à `common` et alimentée par le module Téléphonie via
// `TelephonyTopBarState` (TEL-F-11). Importer le composant depuis `@sankore/crm/telephony`
// fermait un cycle d'imports qui empêchait des modules de s'évaluer : voir l'en-tête de
// `telephony-top-bar-state.ts`.
import { TelephonyStatusPill } from './telephony-status-pill';
import { NotificationBell } from '../../notification-bell/notification-bell';

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
    ImpersonationBanner,
    Menu,
    MenuItem,
    TasMenuTrigger,
    TelephonyStatusPill,
    NotificationBell,
  ],
})
export class PortalLayoutComponent implements OnInit {

  public navigationItems: NavigationItem[] = [];
  private readonly _tenantProvider = inject(TenantProvider);
  private readonly _auth = inject(AuthenticationService);
  private readonly _permissions = inject(PermissionsService);

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
      {
        id: 'leads-analytics',
        icon: 'feather:bar-chart-2',
        title: 'Tableau de bord',
        type: 'basic',
        link: '/leads/analytics',
      },
      ...(this._permissions.has('lead:report:view')
        ? [
            {
              id: 'lead-reports',
              icon: 'feather:pie-chart',
              title: 'Rapports',
              type: 'basic' as const,
              link: '/leads/reports',
            },
          ]
        : []),
      {
        id: 'tasks',
        icon: 'feather:grid',
        title: 'Ma journée',
        type: 'basic',
        link: '/tasks/my-day',
      },
      {
        id: 'calendar',
        icon: 'feather:calendar',
        title: 'Calendrier',
        type: 'basic',
        link: '/tasks/calendar',
      },
      {
        id: 'contacts',
        icon: 'feather:phone',
        title: 'leads',
        type: 'basic',
        link: '/leads',
      },
      ...(this._permissions.has('WhatsApp.Send', 'WhatsApp.Reply', 'WhatsApp.Supervise')
        ? [
            {
              id: 'whatsapp',
              icon: 'feather:message-circle',
              title: 'WhatsApp',
              type: 'basic' as const,
              link: '/leads/whatsapp',
            },
          ]
        : []),
      ...(this._permissions.has('lead:dispatching-rule:read')
        ? [
            {
              id: 'lead-dispatching',
              icon: 'feather:shuffle',
              title: 'Dispatching',
              type: 'basic' as const,
              link: '/leads/dispatching',
            },
          ]
        : []),
      // `/portal/customers` ne correspondait à aucune route : l'entrée renvoyait vers
      // la redirection joker. Le module est monté sur `/customers`.
      ...(this._permissions.has('customers:read')
        ? [
            {
              id: 'customers',
              icon: 'feather:user',
              title: 'Clients',
              type: 'basic' as const,
              link: '/customers',
            },
          ]
        : []),

      ...(this._permissions.has('kyc:read')
        ? [
            {
              id: 'kyc',
              icon: 'feather:lock',
              title: 'KYC',
              type: 'basic' as const,
              link: '/kyc',
            },
          ]
        : []),
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
