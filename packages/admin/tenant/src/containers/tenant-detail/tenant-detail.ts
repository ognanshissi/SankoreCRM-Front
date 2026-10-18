import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY, finalize, forkJoin } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  TenantDomainResponse,
  TenantDomainsApiService,
  TenantResponse,
  TenantsApiService,
} from '@sankore/crm-admin-api';
import { AddDomainDrawer, AddDomainDrawerData } from './add-domain-drawer';

type DomainState = 'active' | 'scheduled' | 'expired' | 'inactive';

const DOMAIN_STYLE: Record<DomainState, { label: string; tone: string; dot: string }> = {
  active: { label: 'Actif', tone: 'text-green-800', dot: 'bg-green-700' },
  scheduled: { label: 'Programmé', tone: 'text-blue-800', dot: 'bg-blue-400' },
  expired: { label: 'Expiré', tone: 'text-orange-800', dot: 'bg-orange-300' },
  inactive: { label: 'Désactivé', tone: 'text-slate-600', dot: 'bg-slate-400' },
};

/**
 * Délais de prise en compte côté Sankore.Api, qui met le registre en cache. Le STATUT d'un tenant
 * est relu toutes les 30 s (`TenantStore:CacheTtl`) ; le lien entre une origine et son tenant est
 * gardé 24 h (`TenantStore:FqdnCacheTtl`), donc un domaine désactivé peut encore ouvrir le tenant
 * jusque-là. Dit dans chaque confirmation, sinon l'opérateur croit l'effet immédiat.
 */
const TENANT_DELAY_NOTICE = 'L’accès est coupé dans les 30 secondes, y compris pour les sessions déjà ouvertes.';
const DOMAIN_DELAY_NOTICE = 'Le CRM peut encore accepter cette origine jusqu’à 24 h, le temps que son cache expire.';

@Component({
  templateUrl: './tenant-detail.html',
  imports: [DatePipe, RouterLink, Button, TasIcon, TasTable],
})
export class TenantDetail implements OnInit {
  private readonly _tenantsApi = inject(TenantsApiService);
  private readonly _domainsApi = inject(TenantDomainsApiService);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  /** Paramètre de route, lié par `withComponentInputBinding`. */
  public readonly id = input.required<string>();

  public tenant = signal<TenantResponse | null>(null);
  public domains = signal<TenantDomainResponse[]>([]);
  public isLoading = signal(true);
  public loadError = signal<string | null>(null);
  public notFound = signal(false);
  public isTogglingTenant = signal(false);
  public deactivatingDomainId = signal<string | null>(null);

  public readonly tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 50, pageSizeOptions: [50] },
  });

  public readonly domainRows = computed(() => {
    const now = Date.now();
    const mainOrigin = this.tenant()?.fqdn ?? '';
    return this.domains().map((d) => {
      const state = this._domainState(d, now);
      return {
        ...d,
        state,
        ...DOMAIN_STYLE[state],
        // Le domaine principal reflète `tenants.fqdn` : le serveur refuse de le désactiver.
        isMain: d.isPrimary || d.fqdn === mainOrigin,
      };
    });
  });

  public readonly activeDomainCount = computed(() => this.domainRows().filter((d) => d.state === 'active').length);

  public ngOnInit(): void {
    this.load();
  }

  public load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this.notFound.set(false);
    forkJoin({
      tenant: this._tenantsApi.getTenant(this.id()),
      domains: this._domainsApi.listTenantDomainsByTenant(this.id()),
    })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          if (err.status === 404) this.notFound.set(true);
          else this.loadError.set(this._describe(err, 'Le tenant n’a pas pu être chargé.'));
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe(({ tenant, domains }) => {
        this.tenant.set(tenant);
        this.domains.set(domains ?? []);
      });
  }

  public openAddDomain(): void {
    const tenant = this.tenant();
    if (!tenant?.id) return;
    const ref = this._drawer.open<boolean, AddDomainDrawerData, AddDomainDrawer>(AddDomainDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { tenantId: tenant.id, tenantName: tenant.name ?? '' },
    });
    ref.closed.subscribe((added) => {
      if (added) {
        this._snackbar.success('Domaine ajouté', 'Le CRM reconnaît désormais cette origine.');
        this._reloadDomains();
      }
    });
  }

  public confirmDeactivateDomain(domain: TenantDomainResponse): void {
    if (!domain.id) return;
    this._confirm.confirm({
      title: 'Désactiver ce domaine ?',
      message:
        `${domain.fqdn} ne donnera plus accès à ${this.tenant()?.name ?? 'ce tenant'}. ` +
        `La désactivation est définitive : cette origine ne pourra pas être réattribuée. ${DOMAIN_DELAY_NOTICE}`,
      closable: true,
      showCancelButton: true,
      icon: 'feather:alert-triangle',
      acceptButtonProps: { label: 'Désactiver', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler', theme: 'primary' },
      accept: () => this._deactivateDomain(domain.id as string),
    });
  }

  public confirmToggleTenant(): void {
    const tenant = this.tenant();
    if (!tenant) return;
    const deactivating = tenant.isActive;
    this._confirm.confirm({
      title: deactivating ? 'Désactiver ce tenant ?' : 'Réactiver ce tenant ?',
      message: deactivating
        ? `Plus aucun utilisateur de ${tenant.name} ne pourra se connecter au CRM, sur aucun de ses domaines. Les données sont conservées. ${TENANT_DELAY_NOTICE}`
        : `Les utilisateurs de ${tenant.name} pourront de nouveau se connecter au CRM.`,
      closable: true,
      showCancelButton: true,
      icon: deactivating ? 'feather:alert-triangle' : undefined,
      acceptButtonProps: { label: deactivating ? 'Désactiver' : 'Réactiver', theme: deactivating ? 'warn' : 'primary' },
      rejectButtonProps: { label: 'Annuler', theme: 'primary' },
      accept: () => this._toggleTenant(!deactivating),
    });
  }

  public originHref(fqdn: string | null | undefined): string | null {
    return fqdn && /^https?:\/\//i.test(fqdn) ? fqdn : null;
  }

  private _toggleTenant(activate: boolean): void {
    const id = this.tenant()?.id;
    if (!id) return;
    this.isTogglingTenant.set(true);
    (activate ? this._tenantsApi.activateTenant(id) : this._tenantsApi.deactivateTenant(id))
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error('Action impossible', this._describe(err, 'Le statut du tenant n’a pas changé.'));
          return EMPTY;
        }),
        finalize(() => this.isTogglingTenant.set(false)),
      )
      .subscribe(() => {
        this._snackbar.success(activate ? 'Tenant réactivé' : 'Tenant désactivé', this.tenant()?.name ?? '');
        // Relu plutôt que basculé localement : `blockedAt` vient du serveur.
        this.load();
      });
  }

  private _deactivateDomain(id: string): void {
    this.deactivatingDomainId.set(id);
    this._domainsApi
      .deactivateTenantDomain(id)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error('Désactivation refusée', this._describe(err, 'Le domaine n’a pas été désactivé.'));
          return EMPTY;
        }),
        finalize(() => this.deactivatingDomainId.set(null)),
      )
      .subscribe(() => {
        this._snackbar.success('Domaine désactivé', DOMAIN_DELAY_NOTICE);
        this._reloadDomains();
      });
  }

  private _reloadDomains(): void {
    this._domainsApi
      .listTenantDomainsByTenant(this.id())
      .pipe(catchError(() => EMPTY))
      .subscribe((domains) => this.domains.set(domains ?? []));
  }

  private _domainState(d: TenantDomainResponse, now: number): DomainState {
    if (!d.isActive) return 'inactive';
    const from = d.validFrom ? Date.parse(d.validFrom) : NaN;
    const to = d.validTo ? Date.parse(d.validTo) : NaN;
    if (!Number.isNaN(from) && from > now) return 'scheduled';
    if (!Number.isNaN(to) && to <= now) return 'expired';
    return 'active';
  }

  private _describe(err: HttpErrorResponse, fallback: string): string {
    if (err.status === 0) return 'Le serveur d’administration est injoignable.';
    return err.error?.detail ?? err.error?.title ?? fallback;
  }
}

export default TenantDetail;
