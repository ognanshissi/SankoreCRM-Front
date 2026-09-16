import { Component, computed, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageEvent } from '@angular/material/paginator';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { AuditApiService, AuditEntryDto } from '@sankore/crm-api';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { BreadcrumbService } from '@sankore/crm/common';

interface ActiveFilter {
  key: string;
  label: string;
  value: string;
}

@Component({
  templateUrl: './audit-homepage.html',
  imports: [
    NgClass,
    FormsModule,
    Button,
    TasIcon,
    TasCard,
    TasTable,
    TasFormField,
    TasLabel,
    TasInput,
    TasSelect,
    TimeagoPipe,
  ],
})
export class AuditHomePage {
  private readonly _auditApiService = inject(AuditApiService);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  // Filters
  public userId = signal('');
  public action = signal('');
  public resourceType = signal('');
  public outcome = signal('');
  public dateFrom = signal('');
  public dateTo = signal('');
  public sortAscending = signal(false);

  // Table state
  public entries = signal<AuditEntryDto[]>([]);
  public isLoading = signal(false);
  public expandedId = signal<string | null>(null);

  public tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: {
      serverSide: true,
      pageIndex: 0,
      pageSize: 20,
      pageSizeOptions: [10, 20, 50],
      totalElements: 0,
    },
  });

  public readonly outcomeOptions = [
    { label: 'Tous', value: '' },
    { label: 'Succès', value: 'Success' },
    { label: 'Échec', value: 'Failure' },
  ];

  public readonly resourceTypeOptions = [
    { label: 'Tous', value: '' },
    { label: 'User', value: 'User' },
    { label: 'Role', value: 'Role' },
    { label: 'Agency', value: 'Agency' },
    { label: 'Territory', value: 'Territory' },
    { label: 'Product', value: 'Product' },
    { label: 'Permission', value: 'Permission' },
  ];

  public activeFilters = computed<ActiveFilter[]>(() => {
    const filters: ActiveFilter[] = [];
    if (this.userId()) filters.push({ key: 'userId', label: 'Utilisateur', value: this.userId() });
    if (this.action()) filters.push({ key: 'action', label: 'Action', value: this.action() });
    if (this.resourceType()) filters.push({ key: 'resourceType', label: 'Ressource', value: this.resourceType() });
    if (this.outcome()) filters.push({ key: 'outcome', label: 'Résultat', value: this.outcome() === 'Success' ? 'Succès' : 'Échec' });
    if (this.dateFrom()) filters.push({ key: 'dateFrom', label: 'Du', value: this.dateFrom() });
    if (this.dateTo()) filters.push({ key: 'dateTo', label: 'Au', value: this.dateTo() });
    return filters;
  });

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: "Journal d'audit" },
    ]);
    this.load(1, 20);
  }

  public applyFilters(): void {
    this.tableConfig.update((c) => ({
      ...c,
      pagination: { ...c.pagination, pageIndex: 0 },
    }));
    this.load(1, this.tableConfig().pagination.pageSize);
  }

  public resetFilters(): void {
    this.userId.set('');
    this.action.set('');
    this.resourceType.set('');
    this.outcome.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
    this.tableConfig.update((c) => ({
      ...c,
      pagination: { ...c.pagination, pageIndex: 0 },
    }));
    this.load(1, this.tableConfig().pagination.pageSize);
  }

  public removeFilter(key: string): void {
    switch (key) {
      case 'userId': this.userId.set(''); break;
      case 'action': this.action.set(''); break;
      case 'resourceType': this.resourceType.set(''); break;
      case 'outcome': this.outcome.set(''); break;
      case 'dateFrom': this.dateFrom.set(''); break;
      case 'dateTo': this.dateTo.set(''); break;
    }
    this.applyFilters();
  }

  public toggleExpand(id: string | undefined): void {
    if (!id) return;
    this.expandedId.update((current) => (current === id ? null : id));
  }

  public toggleSort(): void {
    this.sortAscending.update((v) => !v);
    this.applyFilters();
  }

  public onPageChange(event: PageEvent): void {
    this.tableConfig.update((c) => ({
      ...c,
      pagination: {
        ...c.pagination,
        pageIndex: event.pageIndex,
        pageSize: event.pageSize,
      },
    }));
    this.load(event.pageIndex + 1, event.pageSize);
  }

  public load(page: number, pageSize: number): void {
    this.isLoading.set(true);
    this._auditApiService
      .getAuditEntries(
        this.userId() || undefined,
        this.action() || undefined,
        this.resourceType() || undefined,
        undefined,
        this.outcome() || undefined,
        this.dateFrom() || undefined,
        this.dateTo() || undefined,
        page,
        pageSize,
        this.sortAscending(),
      )
      .subscribe({
        next: (result) => {
          this.entries.set(result.items ?? []);
          this.tableConfig.update((c) => ({
            ...c,
            pagination: {
              ...c.pagination,
              totalElements: result.totalCount ?? 0,
            },
          }));
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
  }

  public outcomeClass(outcome: string | null | undefined): Record<string, boolean> {
    return {
      'border-l-2 border-green-500 text-green-700': outcome === 'Success',
      'border-l-2 border-red-400 text-red-600': outcome === 'Failure',
      'border-l-2 border-slate-300 text-slate-500': !outcome || (outcome !== 'Success' && outcome !== 'Failure'),
    };
  }

  public outcomeLabel(outcome: string | null | undefined): string {
    switch (outcome) {
      case 'Success': return 'Succès';
      case 'Failure': return 'Échec';
      default: return outcome ?? '—';
    }
  }

  public formatPayload(json: string | null | undefined): string {
    if (!json) return '';
    try {
      return JSON.stringify(JSON.parse(json), null, 2);
    } catch {
      return json;
    }
  }
}

export default AuditHomePage;
