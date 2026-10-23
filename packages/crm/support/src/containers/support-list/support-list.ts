import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PageEvent } from '@angular/material/paginator';
import { catchError, debounceTime, EMPTY, Subject } from 'rxjs';
import { SupportApiService, SupportTicketSummaryDto } from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { NewTicketDrawer, NewTicketDrawerData } from '../new-ticket-drawer/new-ticket-drawer';
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATUS_FILTER_OPTIONS,
  STATUS_LABELS,
  STATUS_SEVERITIES,
  supportErrorMessage,
} from '../../support-meta';

type StatusFilter = Parameters<SupportApiService['listSupportTickets']>[0];

/**
 * Les tickets adressés à l'équipe Sankoré. Chacun voit les siens ; l'administrateur
 * (support:read:all) voit ceux de toute l'institution et peut revenir aux siens.
 */
@Component({
  templateUrl: './support-list.html',
  imports: [
    FormsModule, Button, TasCard, TasFormField, TasLabel, TasIcon, TasInput, TasSelect, TasTable, TasTag, TimeagoPipe,
  ],
})
export class SupportList implements OnInit {
  private readonly _supportApi = inject(SupportApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _permissions = inject(PermissionsService);

  public readonly canCreate = this._permissions.can('support:create');
  public readonly canReadAll = this._permissions.can('support:read:all');

  public readonly statusOptions = STATUS_FILTER_OPTIONS;
  public readonly scopeOptions = [
    { label: 'Toute l’institution', value: 'all' },
    { label: 'Mes tickets', value: 'mine' },
  ];
  public readonly statusLabels = STATUS_LABELS;
  public readonly statusSeverities = STATUS_SEVERITIES;
  public readonly priorityLabels = PRIORITY_LABELS;
  public readonly categoryLabels = CATEGORY_LABELS;

  public tickets = signal<SupportTicketSummaryDto[]>([]);
  public isLoading = signal(true);
  public filterQuery = signal('');
  public filterStatus = signal('open');
  public filterScope = signal('all');

  public tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: true, pageIndex: 0, pageSize: 25, pageSizeOptions: [10, 25, 50], totalElements: 0 },
  });

  /** Frappes de recherche, regroupées avant l'appel réseau. */
  private readonly _search$ = new Subject<void>();

  /** La page d'où l'utilisateur est venu, transmise au ticket pour que le support la reproduise. */
  private _from: string | null = null;

  ngOnInit(): void {
    this._breadcrumb.set([{ label: 'Support' }]);

    this._search$
      .pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this._applyFilters());

    const params = this._route.snapshot.queryParams;
    if (params['q']) this.filterQuery.set(params['q']);
    if (params['status'] !== undefined) this.filterStatus.set(params['status']);
    if (params['scope']) this.filterScope.set(params['scope']);
    this._from = params['from'] ?? null;

    this._load();
    if (params['new'] === '1' && this.canCreate()) this.openNewTicket();
  }

  public onSearchChange(value: string | null): void {
    this.filterQuery.set(value ?? '');
    this._search$.next();
  }

  public onStatusChange(value: string | null): void {
    this.filterStatus.set(value ?? '');
    this._applyFilters();
  }

  public onScopeChange(value: string | null): void {
    this.filterScope.set(value ?? 'all');
    this._applyFilters();
  }

  public onPageChange(event: PageEvent): void {
    this.tableConfig.update((c) => ({
      ...c,
      pagination: { ...c.pagination, pageIndex: event.pageIndex, pageSize: event.pageSize },
    }));
    this._load();
  }

  public refresh(): void {
    this._load();
  }

  public open(ticket: SupportTicketSummaryDto): void {
    this._router.navigate(['/support', ticket.id]);
  }

  public openNewTicket(): void {
    const ref = this._sideDrawer.open<string, NewTicketDrawerData, NewTicketDrawer>(NewTicketDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { pageUrl: this._from },
    });
    ref.closed.subscribe((id) => {
      if (id) this._router.navigate(['/support', id]);
    });
  }

  private _applyFilters(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        q: this.filterQuery() || null,
        status: this.filterStatus() === 'open' ? null : this.filterStatus(),
        scope: this.filterScope() === 'all' ? null : this.filterScope(),
        new: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.tableConfig.update((c) => ({ ...c, pagination: { ...c.pagination, pageIndex: 0 } }));
    this._load();
  }

  private _load(): void {
    const status = this.filterStatus();
    const { pageIndex, pageSize } = this.tableConfig().pagination;
    this.isLoading.set(true);
    this._supportApi
      .listSupportTickets(
        status && status !== 'open' ? (status as StatusFilter) : undefined,
        status === 'open',
        this.filterScope() === 'mine',
        this.filterQuery() || undefined,
        pageIndex + 1,
        pageSize,
      )
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.isLoading.set(false);
          this._snackbar.error('Support', supportErrorMessage(err.error?.error));
          return EMPTY;
        }),
      )
      .subscribe((page) => {
        this.tickets.set(page.items ?? []);
        this.tableConfig.update((c) => ({ ...c, pagination: { ...c.pagination, totalElements: page.total ?? 0 } }));
        this.isLoading.set(false);
      });
  }
}

export default SupportList;
