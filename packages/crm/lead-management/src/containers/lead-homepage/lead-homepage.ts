import { Component, computed, inject, signal, Signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { map } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasSelect } from '@talisoft/ui/select';
import { PageEvent } from '@angular/material/paginator';
import {
  AgenciesApiService,
  LeadDto,
  LeadsApiService,
  LeadStatsDto,
} from '@sankore/crm-api';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { CreateLeadComponent } from '../create-lead/create-lead';
import { ImportLeadsComponent } from '../import-leads/import-leads';
import { Severity, TasTag } from '@talisoft/ui/tag';

function leadStatusMeta(status: string | null | undefined): { label: string; severity: Severity } {
  switch (status) {
    case 'New':       return { label: 'Nouveau',  severity: 'info' };
    case 'Contacted': return { label: 'Contacté', severity: 'warning' };
    case 'Qualified': return { label: 'Qualifié', severity: 'warning' };
    case 'Converted': return { label: 'Converti', severity: 'success' };
    case 'Lost':      return { label: 'Perdu',    severity: 'error' };
    case 'Expired':   return { label: 'Expiré',   severity: 'neutral' };
    default:          return { label: status ?? '—', severity: 'neutral' };
  }
}

function intentMeta(level: string | number | null | undefined): { label: string; severity: Severity } {
  switch (String(level)) {
    case '0': return { label: 'Froid',      severity: 'neutral' };
    case '1': return { label: 'Tiède',      severity: 'info' };
    case '2': return { label: 'Chaud',      severity: 'warning' };
    case '3': return { label: 'Très chaud', severity: 'error' };
    default:  return { label: '—',          severity: 'neutral' };
  }
}

const SOURCE_LABELS: Record<string, string> = {
  Web: 'Web',
  MobileAgent: 'Agent mobile',
  Agency: 'Agence',
  CallCenter: "Centre d'appels",
  Sms: 'SMS',
  Ussd: 'USSD',
  WhatsApp: 'WhatsApp',
  Referral: 'Référencement',
  Partner: 'Partenaire',
  FileImport: 'Import',
  Campaign: 'Campagne',
};

const SOURCE_FILTER_OPTIONS = [
  { label: 'Toutes', value: '' },
  { label: 'Web',             value: '0' },
  { label: 'Agent mobile',    value: '1' },
  { label: 'Agence',          value: '2' },
  { label: "Centre d'appels", value: '3' },
  { label: 'SMS',             value: '4' },
  { label: 'USSD',            value: '5' },
  { label: 'WhatsApp',        value: '6' },
  { label: 'Référencement',   value: '7' },
  { label: 'Partenaire',      value: '8' },
  { label: 'Import fichier',  value: '9' },
  { label: 'Campagne',        value: '10' },
];

const INTENT_FILTER_OPTIONS = [
  { label: 'Toutes', value: '' },
  { label: 'Froid',      value: '0' },
  { label: 'Tiède',      value: '1' },
  { label: 'Chaud',      value: '2' },
  { label: 'Très chaud', value: '3' },
];

const KANBAN_COLUMNS = [
  { status: 'New',       statusValue: 'New',       label: 'Nouveau',  color: '#6366f1' },
  { status: 'Contacted', statusValue: 'Contacted', label: 'Contacté', color: '#f59e0b' },
  { status: 'Qualified', statusValue: 'Qualified', label: 'Qualifié', color: '#8b5cf6' },
  { status: 'Converted', statusValue: 'Converted', label: 'Converti', color: '#22c55e' },
  { status: 'Lost',      statusValue: 'Lost',      label: 'Perdu',    color: '#ef4444' },
  { status: 'Expired',   statusValue: 'Expired',   label: 'Expiré',   color: '#94a3b8' },
];

interface StatusTab {
  label: string;
  value: string;
  apiValue: number | undefined;
  count: Signal<number>;
}

@Component({
  templateUrl: './lead-homepage.html',
  imports: [FormsModule, Button, TasIcon, TasCard, TasTable, TasTag, TimeagoPipe, TasSelect],
})
export class LeadHomepage {
  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _router = inject(Router);

  public isLoading = signal(false);
  public leads = signal<LeadDto[]>([]);
  public searchQuery = signal('');
  public viewMode = signal<'list' | 'kanban'>('list');

  // Stats
  public stats = signal<LeadStatsDto>({});

  // Filters
  public filterStatus = signal('');
  public filterSource = signal('');
  public filterAgencyId = signal('');
  public filterIntent = signal('');
  public agencyOptions = signal<{ label: string; value: string }[]>([{ label: 'Toutes', value: '' }]);

  public readonly sourceFilterOptions = SOURCE_FILTER_OPTIONS;
  public readonly intentFilterOptions = INTENT_FILTER_OPTIONS;
  public readonly kanbanColumns = KANBAN_COLUMNS;

  public readonly leadStatusMeta = leadStatusMeta;
  public readonly intentMeta = intentMeta;

  // Status tabs with live counts from stats
  public readonly statusTabs: StatusTab[] = [
    { label: 'Tous',      value: '',  apiValue: undefined, count: computed(() => this.stats().total ?? 0) },
    { label: 'Nouveaux',  value: '0', apiValue: 0,         count: computed(() => this.statusCount('New')) },
    { label: 'Contactés', value: '1', apiValue: 1,         count: computed(() => this.statusCount('Contacted')) },
    { label: 'Qualifiés', value: '2', apiValue: 2,         count: computed(() => this.statusCount('Qualified')) },
    { label: 'Convertis', value: '3', apiValue: 3,         count: computed(() => this.statusCount('Converted')) },
    { label: 'Perdus',    value: '4', apiValue: 4,         count: computed(() => this.statusCount('Lost')) },
  ];

  public hasActiveSecondaryFilters = computed(() =>
    !!(this.filterSource() || this.filterAgencyId() || this.filterIntent()),
  );

  public tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: {
      serverSide: true,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [5, 10, 30, 50],
      totalElements: 0,
    },
  });

  ngOnInit(): void {
    this.loadLeads(0, 10);
    this._loadAgencies();
    this._loadStats();
  }

  public statusCount(status: string): number {
    return this.stats().byStatus?.find((s) => s.status === status)?.count ?? 0;
  }

  public sourceLabel(source: string | null | undefined): string {
    return SOURCE_LABELS[source ?? ''] ?? source ?? '—';
  }

  public intentDotClass(level: string | number | null | undefined): string {
    switch (String(level)) {
      case '0': return 'text-slate-500';
      case '1': return 'text-blue-600';
      case '2': return 'text-amber-600';
      case '3': return 'text-red-600';
      default:  return 'text-slate-400';
    }
  }

  public intentDotBg(level: string | number | null | undefined): string {
    switch (String(level)) {
      case '0': return 'bg-slate-400';
      case '1': return 'bg-blue-500';
      case '2': return 'bg-amber-500';
      case '3': return 'bg-red-500';
      default:  return 'bg-slate-300';
    }
  }

  public setViewMode(mode: 'list' | 'kanban'): void {
    this.viewMode.set(mode);
    if (mode === 'kanban') {
      this.loadLeads(0, 200);
    } else {
      this.loadLeads(0, this.tableConfig().pagination.pageSize);
    }
  }

  public kanbanLeadsByStatus(status: string): LeadDto[] {
    return this.leads().filter((l) => l.status === status);
  }

  public openCreateDrawer(): void {
    const ref = this._sideDrawerService.open(CreateLeadComponent, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });

    ref.closed.subscribe((leadId) => {
      if (leadId) {
        this.reloadCurrentPage();
        this._loadStats();
      }
    });
  }

  public openImportDrawer(): void {
    const ref = this._sideDrawerService.open(ImportLeadsComponent, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });

    ref.closed.subscribe((imported) => {
      if (imported) {
        this.reloadCurrentPage();
        this._loadStats();
      }
    });
  }

  public onPageChange(event: PageEvent): void {
    this.tableConfig.update((c) => ({
      ...c,
      pagination: { ...c.pagination, pageIndex: event.pageIndex, pageSize: event.pageSize },
    }));
    this.loadLeads(event.pageIndex, event.pageSize);
  }

  public onSearchChange(q: string): void {
    this.searchQuery.set(q);
    this.tableConfig.update((c) => ({
      ...c,
      pagination: { ...c.pagination, pageIndex: 0 },
    }));
    this.loadLeads(0, this.tableConfig().pagination.pageSize);
  }

  public onFilterChange(filter: 'status' | 'source' | 'agency' | 'intent', value: string): void {
    switch (filter) {
      case 'status':  this.filterStatus.set(value); break;
      case 'source':  this.filterSource.set(value); break;
      case 'agency':  this.filterAgencyId.set(value); break;
      case 'intent':  this.filterIntent.set(value); break;
    }
    this.tableConfig.update((c) => ({
      ...c,
      pagination: { ...c.pagination, pageIndex: 0 },
    }));
    const pageSize = this.viewMode() === 'kanban' ? 200 : this.tableConfig().pagination.pageSize;
    this.loadLeads(0, pageSize);
  }

  public clearSecondaryFilters(): void {
    this.filterSource.set('');
    this.filterAgencyId.set('');
    this.filterIntent.set('');
    this.tableConfig.update((c) => ({
      ...c,
      pagination: { ...c.pagination, pageIndex: 0 },
    }));
    const pageSize = this.viewMode() === 'kanban' ? 200 : this.tableConfig().pagination.pageSize;
    this.loadLeads(0, pageSize);
  }

  public reloadCurrentPage(): void {
    const pageSize = this.viewMode() === 'kanban' ? 200 : this.tableConfig().pagination.pageSize;
    const pageIndex = this.viewMode() === 'kanban' ? 0 : this.tableConfig().pagination.pageIndex;
    this.loadLeads(pageIndex, pageSize);
  }

  public loadLeads(page: number, pageSize: number): void {
    this.isLoading.set(true);

    const status = this.filterStatus() ? Number(this.filterStatus()) as any : undefined;
    const source = this.filterSource() ? Number(this.filterSource()) as any : undefined;
    const agencyId = this.filterAgencyId() || undefined;
    const intent = this.filterIntent() ? Number(this.filterIntent()) as any : undefined;
    const search = this.searchQuery() || undefined;

    this._leadsApiService
      .listLeads(page + 1, pageSize, status, undefined, source, undefined, agencyId, search, undefined, intent)
      .subscribe({
        next: (result) => {
          this.leads.set(result.items ?? []);
          this.tableConfig.update((c) => ({
            ...c,
            pagination: { ...c.pagination, totalElements: result.totalCount ?? 0 },
          }));
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
  }

  public displayName(lead: LeadDto): string {
    if (lead.fullName) return lead.fullName;
    const parts = [lead.firstName, lead.lastName].filter(Boolean);
    return parts.length ? parts.join(' ') : '—';
  }

  public initials(lead: LeadDto): string {
    const first = lead.firstName ?? lead.fullName ?? '';
    const last = lead.lastName ?? '';
    return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase() || '?';
  }

  public navigateToLead(lead: LeadDto): void {
    this._router.navigate(['/leads', lead.id]);
  }

  public prospectTypeLabel(type: number | null | undefined): string {
    switch (Number(type)) {
      case 0: return 'Individuel';
      case 1: return 'Entreprise';
      default: return '—';
    }
  }

  private _loadAgencies(): void {
    this._agenciesApiService
      .listAgencies(false, 1, 200)
      .pipe(
        map((res) => [
          { label: 'Toutes', value: '' },
          ...(res.items ?? []).map((a) => ({ label: a.name ?? '', value: a.id ?? '' })),
        ]),
      )
      .subscribe({
        next: (opts) => this.agencyOptions.set(opts),
      });
  }

  private _loadStats(): void {
    this._leadsApiService.getLeadStats().subscribe({
      next: (s) => this.stats.set(s),
    });
  }
}

export default LeadHomepage;
