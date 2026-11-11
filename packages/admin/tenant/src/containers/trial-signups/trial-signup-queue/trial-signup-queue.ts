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
import { TableConfig, TasTable } from '@talisoft/ui/table';
import {
  TenantSignupCounts,
  TenantSignupsApiService,
  TenantSignupSummary,
  TenantSignupView,
} from '@sankore/crm-admin-api';
import { countryLabel, describeTrialError, trialStatusStyle } from '../trial-signup-referential';

const TABS: ReadonlyArray<{ value: TenantSignupView; label: string; count: (c: TenantSignupCounts) => number | undefined }> = [
  { value: TenantSignupView.Confirmed, label: 'À valider', count: (c) => c.confirmedCount },
  { value: TenantSignupView.PendingEmail, label: 'E-mail à confirmer', count: (c) => c.pendingEmailCount },
  { value: TenantSignupView.Approved, label: 'Approuvées', count: (c) => c.approvedCount },
  { value: TenantSignupView.Rejected, label: 'Refusées', count: (c) => c.rejectedCount },
  { value: TenantSignupView.Expired, label: 'Expirées', count: (c) => c.expiredCount },
];

/**
 * La file des demandes d'essai gratuit venues du site (docs/essai-gratuit-socle.md, lot 3). La
 * plateforme valide chaque demande (choix du propriétaire, D3) : « À valider » sert les demandes
 * dont l'adresse e-mail est confirmée, la plus ancienne d'abord. Les autres onglets sont l'historique.
 */
@Component({
  templateUrl: './trial-signup-queue.html',
  imports: [DatePipe, FormsModule, RouterLink, Button, TasFormField, TasLabel, TasIcon, TasInput, TasTable],
})
export class TrialSignupQueue implements OnInit {
  private readonly _api = inject(TenantSignupsApiService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly tabs = TABS;

  public tab = signal<TenantSignupView>(TenantSignupView.Confirmed);
  public search = signal('');
  public items = signal<TenantSignupSummary[]>([]);
  public counts = signal<TenantSignupCounts | null>(null);
  public isLoading = signal(false);
  public loadError = signal<string | null>(null);

  public readonly tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: true, pageIndex: 0, pageSize: 25, pageSizeOptions: [25, 50, 100], totalElements: 0 },
  });

  public readonly rows = computed(() =>
    this.items().map((s) => ({
      id: s.id ?? '',
      institution: s.institutionName ?? '—',
      address: s.fqdn ?? s.slug ?? '',
      requester: `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() || '—',
      email: s.email ?? '',
      country: countryLabel(s.country),
      activity: s.activityType ?? '',
      createdAt: s.createdAt ?? null,
      confirmedAt: s.confirmedAt ?? null,
      decidedAt: s.decidedAt ?? null,
      reason: s.rejectionReason ?? null,
      tenantId: s.tenantId ?? null,
      ...trialStatusStyle(s.status),
    })),
  );

  private readonly _search$ = new Subject<void>();

  public ngOnInit(): void {
    this._search$.pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef)).subscribe(() => this._apply());

    const params = this._route.snapshot.queryParams;
    if (TABS.some((t) => t.value === params['onglet'])) this.tab.set(params['onglet']);
    if (params['q']) this.search.set(params['q']);
    this.load();
  }

  public countOf(tab: (typeof TABS)[number]): number | null {
    const counts = this.counts();
    return counts ? (tab.count(counts) ?? 0) : null;
  }

  public pickTab(tab: TenantSignupView): void {
    this.tab.set(tab);
    this._apply();
  }

  public onSearchChange(value: string | null): void {
    this.search.set(value ?? '');
    this._search$.next();
  }

  public onPageChange(event: PageEvent): void {
    this.tableConfig.update((c) => ({ ...c, pagination: { ...c.pagination, pageIndex: event.pageIndex, pageSize: event.pageSize } }));
    this.load();
  }

  public open(id: string): void {
    this._router.navigate(['/essais', id]);
  }

  public load(): void {
    const { pageIndex, pageSize } = this.tableConfig().pagination;
    this.isLoading.set(true);
    this.loadError.set(null);

    this._api
      .countTenantSignups()
      .pipe(catchError(() => EMPTY))
      .subscribe((counts) => this.counts.set(counts));

    this._api
      .listTenantSignups(this.tab(), this.search() || undefined, pageIndex + 1, pageSize)
      .pipe(
        catchError((err) => {
          this.loadError.set(describeTrialError(err, 'La file des demandes d’essai n’a pas pu être chargée.'));
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
        onglet: this.tab() === TenantSignupView.Confirmed ? null : this.tab(),
        q: this.search() || null,
      },
      replaceUrl: true,
    });
    this.tableConfig.update((c) => ({ ...c, pagination: { ...c.pagination, pageIndex: 0 } }));
    this.load();
  }
}

export default TrialSignupQueue;
