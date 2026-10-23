import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PageEvent } from '@angular/material/paginator';
import { catchError, debounceTime, EMPTY, finalize, Subject } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import {
  PlatformSupportTicketListItem,
  SupportApiService,
  SupportQueueCounts,
  SupportTicketPriority,
  SupportTicketStatus,
} from '@sankore/crm-admin-api';
import {
  describeSupportError,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_PRIORITY_OPTIONS,
  SUPPORT_PRIORITY_TONE,
  supportStatusStyle,
} from '../support-referential';

type Tab = 'open' | 'mine' | SupportTicketStatus;

const TABS: ReadonlyArray<{ value: Tab; label: string; count: (c: SupportQueueCounts) => number | undefined }> = [
  { value: 'open', label: 'À traiter', count: (c) => (c.newCount ?? 0) + (c.inProgressCount ?? 0) + (c.waitingOnTenantCount ?? 0) },
  { value: 'mine', label: 'Assignés à moi', count: (c) => c.assignedToMeCount },
  { value: SupportTicketStatus.New, label: 'Nouveaux', count: (c) => c.newCount },
  { value: SupportTicketStatus.InProgress, label: 'En cours', count: (c) => c.inProgressCount },
  { value: SupportTicketStatus.WaitingOnTenant, label: 'En attente du client', count: (c) => c.waitingOnTenantCount },
  { value: SupportTicketStatus.Resolved, label: 'Résolus', count: (c) => c.resolvedCount },
  { value: SupportTicketStatus.Closed, label: 'Fermés', count: (c) => c.closedCount },
];

/**
 * La file des tickets de tous les tenants. « À traiter » sert la plus ancienne activité d'abord ;
 * les onglets Résolus et Fermés sont l'historique, du plus récent au plus ancien.
 */
@Component({
  templateUrl: './support-queue.html',
  imports: [DatePipe, FormsModule, RouterLink, Button, TasFormField, TasLabel, TasIcon, TasInput, TasSelect, TasTable],
})
export class SupportQueue implements OnInit {
  private readonly _api = inject(SupportApiService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly tabs = TABS;
  public readonly priorityOptions = [{ label: 'Toutes', value: '' }, ...SUPPORT_PRIORITY_OPTIONS];

  public tab = signal<Tab>('open');
  public search = signal('');
  public priority = signal('');
  public items = signal<PlatformSupportTicketListItem[]>([]);
  public counts = signal<SupportQueueCounts | null>(null);
  public isLoading = signal(false);
  public loadError = signal<string | null>(null);

  public readonly tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: true, pageIndex: 0, pageSize: 25, pageSizeOptions: [25, 50, 100], totalElements: 0 },
  });

  public readonly rows = computed(() =>
    this.items().map((item) => {
      const t = item.ticket ?? {};
      return {
        id: t.id ?? '',
        reference: t.reference ?? '',
        subject: t.subject ?? '',
        category: t.category ? SUPPORT_CATEGORY_LABELS[t.category] : '',
        tenantId: t.tenantId ?? '',
        tenantName: item.tenantName ?? '—',
        requester: t.requesterName ?? '',
        priority: t.priority ? SUPPORT_PRIORITY_LABELS[t.priority] : '',
        priorityTone: t.priority ? SUPPORT_PRIORITY_TONE[t.priority] : '',
        assignee: item.assignedAdminName ?? null,
        lastActivityAt: t.lastActivityAt ?? null,
        ...supportStatusStyle(t.status),
      };
    }),
  );

  private readonly _search$ = new Subject<void>();

  public ngOnInit(): void {
    this._search$.pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef)).subscribe(() => this._apply());

    const params = this._route.snapshot.queryParams;
    if (TABS.some((t) => t.value === params['onglet'])) this.tab.set(params['onglet']);
    if (params['q']) this.search.set(params['q']);
    if (params['priorite']) this.priority.set(params['priorite']);
    this.load();
  }

  public countOf(tab: (typeof TABS)[number]): number | null {
    const counts = this.counts();
    return counts ? (tab.count(counts) ?? 0) : null;
  }

  public pickTab(tab: Tab): void {
    this.tab.set(tab);
    this._apply();
  }

  public onSearchChange(value: string | null): void {
    this.search.set(value ?? '');
    this._search$.next();
  }

  public onPriorityChange(value: string | null): void {
    this.priority.set(value ?? '');
    this._apply();
  }

  public onPageChange(event: PageEvent): void {
    this.tableConfig.update((c) => ({ ...c, pagination: { ...c.pagination, pageIndex: event.pageIndex, pageSize: event.pageSize } }));
    this.load();
  }

  public open(id: string): void {
    this._router.navigate(['/support', id]);
  }

  public load(): void {
    const tab = this.tab();
    const { pageIndex, pageSize } = this.tableConfig().pagination;
    this.isLoading.set(true);
    this.loadError.set(null);

    this._api
      .countPlatformSupportTickets()
      .pipe(catchError(() => EMPTY))
      .subscribe((counts) => this.counts.set(counts));

    this._api
      .listPlatformSupportTickets(
        tab === 'open' || tab === 'mine' ? undefined : tab,
        tab === 'open' || tab === 'mine',
        undefined,
        undefined,
        tab === 'mine',
        (this.priority() || undefined) as SupportTicketPriority | undefined,
        this.search() || undefined,
        pageIndex + 1,
        pageSize,
      )
      .pipe(
        catchError((err) => {
          this.loadError.set(describeSupportError(err, 'La file des tickets n’a pas pu être chargée.'));
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((page) => {
        this.items.set(page.items ?? []);
        this.tableConfig.update((c) => ({ ...c, pagination: { ...c.pagination, totalElements: page.total ?? 0 } }));
      });
  }

  private _apply(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        onglet: this.tab() === 'open' ? null : this.tab(),
        q: this.search() || null,
        priorite: this.priority() || null,
      },
      replaceUrl: true,
    });
    this.tableConfig.update((c) => ({ ...c, pagination: { ...c.pagination, pageIndex: 0 } }));
    this.load();
  }
}

export default SupportQueue;
