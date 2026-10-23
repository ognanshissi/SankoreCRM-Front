import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, EMPTY, finalize } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  ModuleSubscriptionListItem,
  ModuleSubscriptionsApiService,
  ModuleSubscriptionStatus,
} from '@sankore/crm-admin-api';
import { describeModuleError, formatPrice, MODULE_DELAY_NOTICE, statusStyle } from '../module-referential';
import { RejectModuleRequestData, RejectModuleRequestDrawer } from './reject-module-request-drawer';

const TABS: ReadonlyArray<{ value: ModuleSubscriptionStatus; label: string }> = [
  { value: ModuleSubscriptionStatus.Requested, label: 'En attente' },
  { value: ModuleSubscriptionStatus.Active, label: 'Actifs' },
  { value: ModuleSubscriptionStatus.Rejected, label: 'Refusées' },
  { value: ModuleSubscriptionStatus.Deactivated, label: 'Désactivés' },
  { value: ModuleSubscriptionStatus.Cancelled, label: 'Annulées' },
];

/**
 * La file des décisions de la plateforme : chaque module payant demandé par un tenant attend ici
 * d'être autorisé ou refusé. Les autres onglets sont l'historique — c'est là qu'on voit qu'un
 * tenant vient de désactiver un module, ce qui ne demande aucune décision.
 */
@Component({
  templateUrl: './module-requests.html',
  imports: [DatePipe, RouterLink, Button, TasIcon, TasTable],
})
export class ModuleRequests implements OnInit {
  private readonly _api = inject(ModuleSubscriptionsApiService);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);

  public readonly tabs = TABS;
  public status = signal<ModuleSubscriptionStatus>(ModuleSubscriptionStatus.Requested);
  public items = signal<ModuleSubscriptionListItem[]>([]);
  public isLoading = signal(false);
  public loadError = signal<string | null>(null);
  public approvingId = signal<string | null>(null);

  /** Pagination locale : le registre renvoie au plus 200 lignes, sans paramètres de page. */
  public readonly tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 50, pageSizeOptions: [20, 50, 100] },
  });

  public readonly rows = computed(() =>
    this.items().map((item) => {
      const s = item.subscription ?? {};
      return {
        id: s.id ?? '',
        tenantId: s.tenantId ?? '',
        tenantName: item.tenantName ?? '—',
        moduleLabel: item.moduleLabel ?? s.moduleCode ?? '—',
        requestedBy: s.requestedByEmail ?? null,
        requestedAt: s.requestedAt ?? s.createdAt ?? null,
        acceptedPrice: formatPrice(s.acceptedMonthlyPrice, s.acceptedCurrency),
        decidedAt: s.decidedAt ?? null,
        reason: s.decisionReason ?? null,
        activatedAt: s.activatedAt ?? null,
        deactivatedAt: s.deactivatedAt ?? null,
        deactivatedBy: s.deactivatedByEmail ?? null,
        cancelledAt: s.cancelledAt ?? null,
        isDirect: s.source !== 'Request',
        ...statusStyle(s.status),
      };
    }),
  );

  public ngOnInit(): void {
    const requested = this._route.snapshot.queryParams['statut'];
    if (TABS.some((t) => t.value === requested)) this.status.set(requested);
    this.load();
  }

  public pickTab(status: ModuleSubscriptionStatus): void {
    this.status.set(status);
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { statut: status === ModuleSubscriptionStatus.Requested ? null : status },
      replaceUrl: true,
    });
    this.load();
  }

  public load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this._api
      .listModuleSubscriptions(this.status())
      .pipe(
        catchError((err) => {
          this.loadError.set(describeModuleError(err, 'La file des demandes n’a pas pu être chargée.'));
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((items) => this.items.set(items ?? []));
  }

  public confirmApprove(row: { id: string; tenantName: string; moduleLabel: string; acceptedPrice: string }): void {
    this._confirm.confirm({
      title: 'Autoriser cette demande ?',
      message:
        `« ${row.moduleLabel} » sera activé pour ${row.tenantName}, au prix accepté de ${row.acceptedPrice} par mois. ` +
        MODULE_DELAY_NOTICE,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Autoriser', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._approve(row.id, row.moduleLabel, row.tenantName),
    });
  }

  public openReject(row: { id: string; tenantName: string; moduleLabel: string }): void {
    const ref = this._drawer.open<boolean, RejectModuleRequestData, RejectModuleRequestDrawer>(
      RejectModuleRequestDrawer,
      {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: { subscriptionId: row.id, tenantName: row.tenantName, moduleLabel: row.moduleLabel },
      },
    );
    ref.closed.subscribe((rejected) => {
      if (!rejected) return;
      this._snackbar.success('Demande refusée', `${row.tenantName} verra le motif sur sa page « Modules ».`);
      this.load();
    });
  }

  private _approve(id: string, moduleLabel: string, tenantName: string): void {
    this.approvingId.set(id);
    this._api
      .approveModuleRequest(id)
      .pipe(
        catchError((err) => {
          this._snackbar.error('Autorisation impossible', describeModuleError(err, 'La demande n’a pas été autorisée.'));
          this.load();
          return EMPTY;
        }),
        finalize(() => this.approvingId.set(null)),
      )
      .subscribe(() => {
        this._snackbar.success('Module autorisé', `« ${moduleLabel} » est actif pour ${tenantName}.`);
        this.load();
      });
  }
}

export default ModuleRequests;
