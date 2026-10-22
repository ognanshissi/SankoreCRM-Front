import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { Overlay } from '@angular/cdk/overlay';
import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, HostListener, inject, PLATFORM_ID, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { catchError, filter, map, of } from 'rxjs';
import { UsersApiService } from '@sankore/crm-api';
import { TasIcon } from '@talisoft/ui/icon';
import { ImpersonationBanner } from '../../impersonation-banner/impersonation-banner';
import { NotificationBell } from '../../notification-bell/notification-bell';
import { AuthenticationService, BreadcrumbItem, BreadcrumbService, PermissionsService, TenantProvider } from '../../../services';
import { ENVIRONMENT_CONFIG } from '../../../utils/environment-config.token';
import { CommandPalette } from './command-palette';
import { NavBadges } from './nav-badges.service';
import { activeNavItem, groupOf, PORTAL_NAVIGATION, PortalNavGroup, SETTINGS_NAV_ITEM } from './portal-navigation';
import { PortalSidebar } from './portal-sidebar';
import { PortalUserMenu } from './portal-user-menu';
import { ShortcutsDialog, ShortcutsDialogData } from './shortcuts-dialog';

/**
 * La mise en page du portail : barre latérale sombre sur toute la hauteur, barre du haut blanche
 * avec le fil d'Ariane et le titre de la page, la recherche (Ctrl K), la cloche et le profil.
 *
 * Le titre est celui que la page pose dans `BreadcrumbService` (son dernier élément), précédé du
 * groupe de la navigation auquel elle appartient — « Pilotage › Suivi des workflows ». Une page
 * qui ne pose rien prend le nom de son entrée de menu.
 *
 * Elle n'utilise plus `tas-navigation-layout` du kit, dont la barre du haut couvre toute la
 * largeur : la maquette veut la barre latérale sur toute la hauteur, et ce composant générique
 * sert d'autres applications qui n'ont pas à changer avec celle-ci.
 */
@Component({
  selector: 'common-portal-layout',
  templateUrl: 'portal-layout.component.html',
  imports: [RouterOutlet, RouterLink, TasIcon, ImpersonationBanner, NotificationBell, PortalSidebar, PortalUserMenu],
})
export class PortalLayoutComponent {
  private readonly _tenantProvider = inject(TenantProvider);
  private readonly _auth = inject(AuthenticationService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _router = inject(Router);
  private readonly _dialog = inject(Dialog);
  private readonly _overlay = inject(Overlay);
  private readonly _users = inject(UsersApiService);
  private readonly _environment = inject(ENVIRONMENT_CONFIG, { optional: true });
  private readonly _isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  public readonly menuOpen = signal(false);

  /** « ⌘ » sur Mac, « Ctrl » ailleurs. */
  public readonly modifier = this._isBrowser && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

  private _palette: DialogRef<unknown, CommandPalette> | null = null;
  private _shortcuts: DialogRef<unknown, ShortcutsDialog> | null = null;

  private readonly _url = toSignal(
    this._router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this._router.url },
  );

  public readonly companyName = computed(() => this._tenantProvider.context()?.companyName ?? '');
  public readonly logoUrl = computed(() => this._tenantProvider.context()?.logoUrl ?? null);

  /** Lu une fois : le nom de l'agence n'est pas dans le contexte d'authentification. */
  private readonly _agencyName = this._isBrowser
    ? toSignal(this._users.getMyProfile().pipe(map((p) => p.agencyName ?? ''), catchError(() => of(''))), { initialValue: '' })
    : signal('');

  public readonly subtitle = computed(() =>
    [this._agencyName(), this._environment && !this._environment.production ? 'Dev' : '']
      .filter(Boolean)
      .join(' · '),
  );

  /** Les groupes, réduits aux entrées que l'utilisateur peut ouvrir ; un groupe vide disparaît. */
  public readonly groups = computed<PortalNavGroup[]>(() => {
    const granted = this._permissions.granted();
    return PORTAL_NAVIGATION.map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.anyOf || i.anyOf.some((p) => granted.has(p))),
    })).filter((g) => g.items.length > 0);
  });

  public readonly activeItem = computed(() =>
    activeNavItem(this._url(), [...this.groups().flatMap((g) => g.items), SETTINGS_NAV_ITEM]),
  );

  /**
   * Sur la page MÊME d'une entrée du menu, c'est le menu qui la nomme — « Suivi des workflows » et
   * non le fil interne de l'écran (« Paramétrage › Workflows › Santé ») ; plus loin (une fiche, un
   * sous-écran), c'est le fil que la page a posé.
   */
  private readonly _pageCrumbs = computed<BreadcrumbItem[]>(() => {
    const item = this.activeItem();
    const crumbs = this._breadcrumb.crumbs();
    const onItemPage = !!item && this._url().split(/[?#]/)[0] === item.link;
    if (crumbs.length && !onItemPage) return crumbs;
    return item ? [{ label: item.label }] : crumbs;
  });

  public readonly trail = computed<BreadcrumbItem[]>(() => {
    const group = groupOf(this.activeItem());
    return group ? [{ label: group.label }, ...this._pageCrumbs()] : this._pageCrumbs();
  });

  public readonly title = computed(() => {
    const crumbs = this._pageCrumbs();
    return crumbs[crumbs.length - 1]?.label ?? '';
  });

  constructor() {
    inject(NavBadges).start(inject(DestroyRef));

    // Une page choisie depuis le tiroir le referme, même par un lien hors de la barre.
    this._router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.menuOpen.set(false));
  }

  @HostListener('document:keydown', ['$event'])
  public onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.openPalette();
      return;
    }

    // « ? » ouvre l'aide, sauf quand on écrit : un point d'interrogation dans une note reste un caractère.
    if (event.key === '?' && !event.ctrlKey && !event.metaKey && !this._isTyping(event.target)) {
      event.preventDefault();
      this.openShortcuts();
    }
  }

  public openPalette(): void {
    if (this._palette) return;
    this._palette = this._dialog.open(CommandPalette, {
      width: '640px',
      maxWidth: 'calc(100vw - 32px)',
      positionStrategy: this._overlay.position().global().centerHorizontally().top('12vh'),
      backdropClass: ['bg-slate-900/40'],
      ariaLabel: 'Recherche',
    });
    this._palette.closed.subscribe(() => (this._palette = null));
  }

  public openShortcuts(): void {
    if (this._shortcuts) return;
    this._shortcuts = this._dialog.open<unknown, ShortcutsDialogData, ShortcutsDialog>(ShortcutsDialog, {
      data: { modifier: this.modifier },
      backdropClass: ['bg-slate-900/40'],
      ariaLabel: 'Aide et raccourcis',
    });
    this._shortcuts.closed.subscribe(() => (this._shortcuts = null));
  }

  private _isTyping(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
  }
}
