import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, EMPTY, finalize, Subject } from 'rxjs';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TenantResponse, TenantsApiService } from '@sankore/crm-admin-api';

export type TenantStatusFilter = 'actifs' | 'maintenance' | 'inactifs';
type TenantState = 'active' | 'trial' | 'trial-expired' | 'maintenance' | 'inactive';

const STATE_STYLE: Record<TenantState, { label: string; tone: string; dot: string }> = {
  active: { label: 'Actif', tone: 'text-green-800', dot: 'bg-green-700' },
  trial: { label: 'Essai', tone: 'text-blue-800', dot: 'bg-blue-400' },
  'trial-expired': { label: 'Essai expiré', tone: 'text-orange-800', dot: 'bg-orange-300' },
  maintenance: { label: 'Maintenance', tone: 'text-amber-800', dot: 'bg-amber-400' },
  inactive: { label: 'Inactif', tone: 'text-slate-600', dot: 'bg-slate-400' },
};

const FILTERS: ReadonlyArray<{ value: TenantStatusFilter | null; label: string }> = [
  { value: null, label: 'Tous' },
  { value: 'actifs', label: 'Actifs' },
  { value: 'maintenance', label: 'En maintenance' },
  { value: 'inactifs', label: 'Inactifs' },
];

export interface TenantRow {
  id: string;
  name: string;
  initials: string;
  fqdn: string;
  rootUserEmail: string;
  state: TenantState;
  stateLabel: string;
  stateTone: string;
  stateDot: string;
  trialExpiresAt: string | null;
  blockedAt: string | null;
  createdAt: string | null;
}

@Component({
  templateUrl: './tenants-list.html',
  imports: [DatePipe, FormsModule, RouterLink, Anchor, Button, TasIcon, TasTable],
})
export class TenantsList implements OnInit {
  private readonly _tenantsApi = inject(TenantsApiService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _search$ = new Subject<void>();

  public isLoading = signal(false);
  public loadError = signal<string | null>(null);
  public tenants = signal<TenantResponse[]>([]);
  public searchQuery = signal('');
  public statusFilter = signal<TenantStatusFilter | null>(null);

  /**
   * Pagination LOCALE : `GET /tenants` renvoie tout le registre d'un coup (pas de paramètres de
   * page dans le contrat), et un registre compte quelques dizaines de lignes.
   */
  public readonly tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 50, pageSizeOptions: [20, 50, 100] },
  });

  private readonly _allRows = computed<TenantRow[]>(() => {
    const now = Date.now();
    return this.tenants().map((t) => {
      const state = this._stateOf(t, now);
      const style = STATE_STYLE[state];
      const name = t.name?.trim() || '—';
      return {
        id: t.id ?? '',
        name,
        initials: name
          .split(/\s+/)
          .map((w) => w[0] ?? '')
          .join('')
          .slice(0, 2)
          .toUpperCase(),
        fqdn: t.fqdn ?? '',
        rootUserEmail: t.rootUserEmail ?? '',
        state,
        stateLabel: style.label,
        stateTone: style.tone,
        stateDot: style.dot,
        trialExpiresAt: t.trialExpiresAt ?? null,
        blockedAt: t.blockedAt ?? null,
        createdAt: t.createdAt ?? null,
      };
    });
  });

  public readonly rows = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const filter = this.statusFilter();
    return this._allRows().filter(
      (r) =>
        this._matchesFilter(r, filter) &&
        (!q || `${r.name} ${r.fqdn} ${r.rootUserEmail}`.toLowerCase().includes(q)),
    );
  });

  public readonly filters = computed(() => {
    const all = this._allRows();
    const current = this.statusFilter();
    return FILTERS.map((f) => ({
      ...f,
      count: all.filter((r) => this._matchesFilter(r, f.value)).length,
      isSelected: current === f.value,
    }));
  });

  public readonly hasFilters = computed(() => !!this.statusFilter() || !!this.searchQuery().trim());

  public readonly summary = computed(() => {
    const total = this._allRows().length;
    const active = this._allRows().filter((r) => r.state !== 'inactive').length;
    return `${total} tenant${total > 1 ? 's' : ''} · ${active} actif${active > 1 ? 's' : ''}`;
  });

  public ngOnInit(): void {
    this._search$
      .pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this._persistFilters());

    const params = this._route.snapshot.queryParams;
    if (params['q']) this.searchQuery.set(params['q']);
    if (FILTERS.some((f) => f.value && f.value === params['statut'])) this.statusFilter.set(params['statut']);

    this.load();
  }

  public load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this._tenantsApi
      .listTenants()
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.loadError.set(
            err.status === 0
              ? 'Le serveur d’administration est injoignable.'
              : (err.error?.detail ?? err.error?.title ?? 'La liste des tenants n’a pas pu être chargée.'),
          );
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((tenants) => this.tenants.set(tenants ?? []));
  }

  /**
   * Le filtrage est local et donc instantané ; seule l'écriture dans l'URL est différée, pour ne
   * pas pousser une entrée d'historique par frappe.
   */
  public onSearchChange(query: string): void {
    this.searchQuery.set(query ?? '');
    this._search$.next();
  }

  public pickFilter(value: TenantStatusFilter | null): void {
    this.statusFilter.set(value);
    this._persistFilters();
  }

  public clearFilters(): void {
    this.searchQuery.set('');
    this.statusFilter.set(null);
    this._persistFilters();
  }

  public originHref(fqdn: string): string | null {
    return /^https?:\/\//i.test(fqdn) ? fqdn : null;
  }

  private _persistFilters(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { q: this.searchQuery().trim() || null, statut: this.statusFilter() },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private _matchesFilter(row: TenantRow, filter: TenantStatusFilter | null): boolean {
    switch (filter) {
      case 'actifs':
        return row.state !== 'inactive' && row.state !== 'maintenance';
      case 'maintenance':
        return row.state === 'maintenance';
      case 'inactifs':
        return row.state === 'inactive';
      default:
        return true;
    }
  }

  /** Un tenant désactivé est inactif quoi qu'en disent ses autres drapeaux : c'est lui qui coupe l'accès. */
  private _stateOf(t: TenantResponse, now: number): TenantState {
    if (!t.isActive) return 'inactive';
    if (t.isMaintenance) return 'maintenance';
    const trialEnd = t.trialExpiresAt ? Date.parse(t.trialExpiresAt) : NaN;
    if (!Number.isNaN(trialEnd)) return trialEnd > now ? 'trial' : 'trial-expired';
    return 'active';
  }
}

export default TenantsList;
