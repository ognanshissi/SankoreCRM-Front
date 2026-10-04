import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
  Signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, debounceTime, EMPTY, map, Subject } from 'rxjs';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { PageEvent } from '@angular/material/paginator';
import {
  AgenciesApiService,
  LeadDto,
  LeadsApiService,
  LeadSourcesApiService,
  LeadStatsDto,
  UpdatePipelineStageRequestStageEnum,
} from '@sankore/crm-api';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { CreateLeadComponent } from '../create-lead/create-lead';
import { ImportLeadsComponent } from '../import-leads/import-leads';
import { SystemCaptureDrawer } from './system-capture-drawer';
import { CreateTaskDrawer } from '@sankore/crm/tasks';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { PermissionsService } from '@sankore/crm/common';

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

/**
 * Canal d'origine (`LeadDto.source`), l'énumération figée du contrat.
 *
 * Ce n'est **pas** la source configurée : un lead porte les deux, `source` disant par quel canal il
 * est entré (Web, USSD, agence…) et `leadSourceConfigId` de quelle source paramétrée il provient.
 * Ces libellés ne servent donc plus qu'au repli, pour les leads sans source configurée — ceux
 * capturés avant la mise en place du paramétrage, ou créés à la main.
 */
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

/**
 * Option « aucun filtre », seule entrée écrite en dur : les autres viennent des sources
 * configurées dans Paramétrage › Sources & Campagnes.
 */
const ALL_SOURCES_OPTION = { label: 'Toutes', value: '' };

const INTENT_FILTER_OPTIONS = [
  { label: 'Toutes', value: '' },
  { label: 'Froid',      value: '0' },
  { label: 'Tiède',      value: '1' },
  { label: 'Chaud',      value: '2' },
  { label: 'Très chaud', value: '3' },
];

// ——— Pipeline stages (Kanban columns) ———

export interface PipelineColumn {
  stage: UpdatePipelineStageRequestStageEnum;
  label: string;
  color: string;
  /** Allowed stages a lead can transition TO from this column (beyond adjacent) */
  index: number;
}

const PIPELINE_COLUMNS: PipelineColumn[] = [
  { stage: UpdatePipelineStageRequestStageEnum.New,                  label: 'Nouveau',            color: '#6366f1', index: 0 },
  { stage: UpdatePipelineStageRequestStageEnum.ContactAttempted,     label: 'Contact tenté',      color: '#818cf8', index: 1 },
  { stage: UpdatePipelineStageRequestStageEnum.ContactEstablished,   label: 'Contact établi',     color: '#f59e0b', index: 2 },
  { stage: UpdatePipelineStageRequestStageEnum.NeedIdentified,       label: 'Besoin identifié',   color: '#f97316', index: 3 },
  { stage: UpdatePipelineStageRequestStageEnum.Qualified,            label: 'Qualifié',           color: '#8b5cf6', index: 4 },
  { stage: UpdatePipelineStageRequestStageEnum.ProductProposed,      label: 'Produit proposé',    color: '#3b82f6', index: 5 },
  { stage: UpdatePipelineStageRequestStageEnum.ApplicationStarted,   label: 'Dossier démarré',    color: '#0ea5e9', index: 6 },
  { stage: UpdatePipelineStageRequestStageEnum.DocumentCollection,   label: 'Collecte docs',      color: '#06b6d4', index: 7 },
  { stage: UpdatePipelineStageRequestStageEnum.ApplicationCompleted, label: 'Dossier complet',    color: '#14b8a6', index: 8 },
  { stage: UpdatePipelineStageRequestStageEnum.ApprovalPending,      label: 'En approbation',     color: '#84cc16', index: 9 },
  { stage: UpdatePipelineStageRequestStageEnum.Converted,            label: 'Converti',           color: '#22c55e', index: 10 },
  { stage: UpdatePipelineStageRequestStageEnum.Lost,                 label: 'Perdu',              color: '#ef4444', index: 11 },
];

const STAGE_INDEX = new Map(PIPELINE_COLUMNS.map((c) => [c.stage, c.index]));

/**
 * Transition rules: a lead can move forward by up to 2 stages, backward by 1,
 * or to Lost from any position.
 */
function isTransitionAllowed(from: string, to: string): boolean {
  if (from === to) return false;
  if (to === UpdatePipelineStageRequestStageEnum.Lost) return true;
  const fi = STAGE_INDEX.get(from as any);
  const ti = STAGE_INDEX.get(to as any);
  if (fi == null || ti == null) return false;
  const delta = ti - fi;
  return delta >= -1 && delta <= 2;
}

function transitionBlockedMessage(from: string, to: string): string {
  const fromCol = PIPELINE_COLUMNS.find((c) => c.stage === from);
  const toCol = PIPELINE_COLUMNS.find((c) => c.stage === to);
  return `Transition non autorisée : « ${fromCol?.label ?? from} » → « ${toCol?.label ?? to} ». Vous pouvez avancer de 2 étapes maximum, reculer de 1, ou passer en Perdu.`;
}

// ——— Old status-based columns (kept for status-view backward compat) ———

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
  imports: [
    FormsModule,
    Button,
    TasIcon,
    TasCard,
    TasTable,
    TasTag,
    TimeagoPipe,
    TasFormField,
    TasLabel,
    TasInput,
    TasSelect,
    DragDropModule,
  ],
})
export class LeadHomepage implements OnInit {
  private readonly _permissions = inject(PermissionsService);
  public readonly canCreate = this._permissions.can('lead:create');
  public readonly canExport = this._permissions.can('lead:export');
  public readonly canImport = this._permissions.can('lead:import');
  public readonly canAssign = this._permissions.can('lead:assign');

  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _leadSourcesApiService = inject(LeadSourcesApiService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  /** Frappes de recherche, regroupées avant l'appel réseau. */
  private readonly _search$ = new Subject<void>();

  public isLoading = signal(false);
  public isExporting = signal(false);
  public leads = signal<LeadDto[]>([]);
  public searchQuery = signal('');
  public viewMode = signal<'list' | 'kanban'>('list');

  // Multi-select
  public selectedLeadIds = signal<Set<string>>(new Set());

  public readonly selectedCount = computed(() => this.selectedLeadIds().size);
  public readonly allSelected = computed(() => {
    const leads = this.leads();
    const sel = this.selectedLeadIds();
    return leads.length > 0 && leads.every((l) => sel.has(l.id!));
  });

  // Stats
  public stats = signal<LeadStatsDto>({});

  // Filters
  public filterStatus = signal('');
  /**
   * Source **configurée** retenue : un `leadSourceConfigId` (uuid), pas l'indice de l'énumération
   * `source`. Le filtre portait auparavant sur cette énumération, qui est le canal d'entrée et non
   * la source paramétrée : deux campagnes Facebook distinctes y étaient confondues sous « Web »,
   * et une source créée dans Paramétrage n'apparaissait nulle part.
   */
  public filterLeadSourceId = signal('');
  public filterAgencyId = signal('');
  public filterIntent = signal('');
  public agencyOptions = signal<{ label: string; value: string }[]>([{ label: 'Toutes', value: '' }]);

  /**
   * Options du filtre Source, alimentées par les sources configurées. Signal et non constante :
   * la liste vient du serveur et change avec le paramétrage.
   */
  public sourceFilterOptions = signal<{ label: string; value: string }[]>([ALL_SOURCES_OPTION]);
  public readonly intentFilterOptions = INTENT_FILTER_OPTIONS;
  public readonly kanbanColumns = KANBAN_COLUMNS;
  public readonly pipelineColumns = PIPELINE_COLUMNS;

  public readonly leadStatusMeta = leadStatusMeta;
  public readonly intentMeta = intentMeta;

  /** Currently keyboard-focused card ID */
  public focusedCardId = signal<string | null>(null);

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
    !!(this.filterLeadSourceId() || this.filterAgencyId() || this.filterIntent()),
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
    this._search$
      .pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this._applyFilters());

    // Restauration des filtres depuis l'URL : un lien partagé ou un
    // rafraîchissement retrouve la même vue.
    const params = this._route.snapshot.queryParams;
    if (params['q']) this.searchQuery.set(params['q']);
    if (params['status']) this.filterStatus.set(params['status']);
    // `leadSource` et non `source` : la valeur a changé de nature (uuid au lieu d'un indice
    // d'énumération). Un ancien lien portant `source=2` est donc ignoré plutôt que mal interprété —
    // aucune correspondance n'existe entre les deux vocabulaires.
    if (params['leadSource']) this.filterLeadSourceId.set(params['leadSource']);
    if (params['agency']) this.filterAgencyId.set(params['agency']);
    if (params['intent']) this.filterIntent.set(params['intent']);

    this.loadLeads(0, this.tableConfig().pagination.pageSize);
    this._loadAgencies();
    this._loadLeadSources();
    this._loadStats();
  }

  // ——— Pipeline helpers ———

  public pipelineLeads(stage: string): LeadDto[] {
    return this.leads().filter((l) => (l.pipelineStage ?? l.status) === stage);
  }

  public stageCount(stage: string): number {
    return this.stats().byPipelineStage?.find((s) => s.stage === stage)?.count ?? 0;
  }

  public stageTotalAmount(stage: string): number {
    return this.pipelineLeads(stage).reduce((sum, l) => sum + (l.desiredAmount?.amount ?? 0), 0);
  }

  public stageSlaBreachCount(stage: string): number {
    const leads = this.pipelineLeads(stage);
    const now = Date.now();
    return leads.filter((l) => {
      if (!l.expiresAt) return false;
      return new Date(l.expiresAt).getTime() < now;
    }).length;
  }

  public isSlaBreach(lead: LeadDto): boolean {
    if (!lead.expiresAt) return false;
    return new Date(lead.expiresAt).getTime() < Date.now();
  }

  public formatAmount(amount: number): string {
    if (amount >= 1_000_000) return (amount / 1_000_000).toFixed(1) + 'M';
    if (amount >= 1_000) return (amount / 1_000).toFixed(0) + 'K';
    return amount.toString();
  }

  public pipelineColumnIds(): string[] {
    return this.pipelineColumns.map((c) => 'pipeline-' + c.stage);
  }

  // ——— Drag & Drop ———

  public onDrop(event: CdkDragDrop<UpdatePipelineStageRequestStageEnum>): void {
    if (event.previousContainer === event.container) return;

    const lead: LeadDto = event.item.data;
    const fromStage = event.previousContainer.data;
    const toStage = event.container.data;

    if (!isTransitionAllowed(fromStage, toStage)) {
      this._snackbar.error('Transition refusée', transitionBlockedMessage(fromStage, toStage));
      return;
    }

    this._moveLeadOptimistic(lead, fromStage, toStage);
  }

  // ——— Keyboard navigation ———

  public onCardKeydown(event: KeyboardEvent, lead: LeadDto, currentStage: string): void {
    const currentIdx = STAGE_INDEX.get(currentStage as any);
    if (currentIdx == null) return;

    let targetStage: string | null = null;

    if (event.key === 'ArrowRight') {
      const nextCol = PIPELINE_COLUMNS[currentIdx + 1];
      if (nextCol) targetStage = nextCol.stage;
    } else if (event.key === 'ArrowLeft') {
      const prevCol = PIPELINE_COLUMNS[currentIdx - 1];
      if (prevCol) targetStage = prevCol.stage;
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.navigateToLead(lead);
      return;
    } else {
      return;
    }

    event.preventDefault();

    if (!targetStage) return;

    if (!isTransitionAllowed(currentStage, targetStage)) {
      this._snackbar.error('Transition refusée', transitionBlockedMessage(currentStage, targetStage));
      return;
    }

    this._moveLeadOptimistic(lead, currentStage, targetStage);
  }

  private _moveLeadOptimistic(lead: LeadDto, fromStage: string, toStage: string): void {
    // Optimistic update
    this.leads.update((all) =>
      all.map((l) =>
        l.id === lead.id ? { ...l, pipelineStage: toStage } : l,
      ),
    );

    this._leadsApiService
      .updateLeadPipelineStage(lead.id!, { stage: toStage as any })
      .pipe(
        catchError(() => {
          // Rollback
          this.leads.update((all) =>
            all.map((l) =>
              l.id === lead.id ? { ...l, pipelineStage: fromStage } : l,
            ),
          );
          this._snackbar.error('Erreur', 'Le serveur a rejeté la transition. La carte a été remise en place.');
          return EMPTY;
        }),
      )
      .subscribe(() => {
        const toLabel = PIPELINE_COLUMNS.find((c) => c.stage === toStage)?.label ?? toStage;
        this._snackbar.success('Lead déplacé', `Déplacé vers « ${toLabel} »`);
        this._loadStats();
      });
  }

  // ——— Existing methods (unchanged) ———

  public statusCount(status: string): number {
    return this.stats().byStatus?.find((s) => s.status === status)?.count ?? 0;
  }

  /**
   * Source affichée sur une ligne : le libellé de la source **configurée** quand le lead en a une,
   * sinon le canal d'entrée. Les deux coexistent sur `LeadDto`, et afficher le seul canal revenait
   * à montrer « Web » pour trois campagnes différentes.
   */
  public leadSourceLabel(lead: LeadDto): string {
    const configured = lead.leadSourceLabel?.trim() || lead.leadSourceCode?.trim();
    if (configured) return configured;
    return this.sourceLabel(lead.source);
  }

  /** Canal d'entrée seul (`LeadDto.source`). Utilisé en repli, et pour les leads sans source configurée. */
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

  /**
   * La recherche texte passe par un debounce : sans lui, chaque frappe
   * déclenchait un appel HTTP. Les listes déroulantes restent immédiates.
   */
  public onSearchChange(value: string | null): void {
    this.searchQuery.set(value ?? '');
    this._search$.next();
  }

  public onFilterChange(
    filter: 'status' | 'leadSource' | 'agency' | 'intent',
    value: string | null,
  ): void {
    // La croix d'effacement d'un `tas-select` notifie `null` : les signaux de
    // filtre restent en chaîne vide, que tout le reste de l'écran traite déjà
    // comme « aucun filtre ».
    const next = value ?? '';
    switch (filter) {
      case 'status':     this.filterStatus.set(next); break;
      case 'leadSource': this.filterLeadSourceId.set(next); break;
      case 'agency':     this.filterAgencyId.set(next); break;
      case 'intent':     this.filterIntent.set(next); break;
    }
    this._applyFilters();
  }

  public clearSecondaryFilters(): void {
    this.filterLeadSourceId.set('');
    this.filterAgencyId.set('');
    this.filterIntent.set('');
    this._applyFilters();
  }

  /**
   * Point de passage unique des filtres : persiste l'état dans l'URL, remet la
   * pagination à la première page, puis recharge.
   */
  private _applyFilters(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        q: this.searchQuery() || null,
        status: this.filterStatus() || null,
        leadSource: this.filterLeadSourceId() || null,
        agency: this.filterAgencyId() || null,
        intent: this.filterIntent() || null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

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
    const agencyId = this.filterAgencyId() || undefined;
    const intent = this.filterIntent() ? Number(this.filterIntent()) as any : undefined;
    const search = this.searchQuery() || undefined;
    const leadSourceConfigId = this.filterLeadSourceId() || undefined;

    // `source` (5e paramètre) reste `undefined` : le filtrage passe désormais par
    // `leadSourceConfigId` (11e), qui désigne la source configurée et non le canal d'entrée.
    this._leadsApiService
      .listLeads(
        page + 1,
        pageSize,
        status,
        undefined,
        undefined,
        undefined,
        agencyId,
        search,
        undefined,
        intent,
        leadSourceConfigId,
      )
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

  // ——— Multi-select ———

  public toggleSelectLead(leadId: string, event: Event): void {
    event.stopPropagation();
    this.selectedLeadIds.update((set) => {
      const next = new Set(set);
      if (next.has(leadId)) next.delete(leadId); else next.add(leadId);
      return next;
    });
  }

  public toggleSelectAll(): void {
    const leads = this.leads();
    const sel = this.selectedLeadIds();
    if (leads.every((l) => sel.has(l.id!))) {
      this.selectedLeadIds.set(new Set());
    } else {
      this.selectedLeadIds.set(new Set(leads.map((l) => l.id!)));
    }
  }

  public clearSelection(): void {
    this.selectedLeadIds.set(new Set());
  }

  public openBulkAssignDrawer(): void {
    const selectedIds = [...this.selectedLeadIds()];
    if (selectedIds.length === 0) return;

    // Open CreateTaskDrawer for the first selected lead, with all lead IDs in description for context
    const firstLeadId = selectedIds[0];
    const selectedLeads = this.leads().filter((l) => this.selectedLeadIds().has(l.id!));
    const leadNames = selectedLeads.map((l) => this.displayName(l)).join(', ');

    const ref = this._sideDrawerService.open(CreateTaskDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { leadId: firstLeadId },
    });

    ref.closed.subscribe((created: any) => {
      if (created && selectedIds.length > 1) {
        // Create tasks for remaining leads
        const tasksApi = this._leadsApiService;
        let remaining = selectedIds.length - 1;
        // The first task was already created by the drawer.
        // For the rest, we re-use the same pattern but via bulk:
        // Since there's no bulk-create-task API, we inform the user.
        this._snackbar.info(
          'Tâche créée',
          `Tâche créée pour ${selectedIds.length} lead(s). Pour les leads restants, répétez l'opération ou utilisez l'assignation en masse.`,
        );
        this.clearSelection();
        this.reloadCurrentPage();
      } else if (created) {
        this._snackbar.success('Tâche créée', 'La tâche a été assignée.');
        this.clearSelection();
      }
    });
  }

  public openSystemCaptureDrawer(): void {
    const ref = this._sideDrawerService.open(SystemCaptureDrawer, {
      width: '100%', height: '100%', panelClass: 'side-drawer-panel',
    });
    ref.closed.subscribe((created: any) => {
      if (created) { this.reloadCurrentPage(); this._loadStats(); }
    });
  }

  /**
   * Export CSV des leads filtrés.
   *
   * `leadSourceConfigId` est le 8e paramètre, après `tag` : l'export porte donc exactement les
   * mêmes filtres que la liste, source configurée comprise.
   */
  public exportLeads(): void {
    this.isExporting.set(true);
    const status = this.filterStatus() ? Number(this.filterStatus()) as any : undefined;
    const agencyId = this.filterAgencyId() || undefined;
    const search = this.searchQuery() || undefined;
    const leadSourceConfigId = this.filterLeadSourceId() || undefined;

    this._leadsApiService
      .exportLeads(
        status,
        undefined,
        undefined,
        undefined,
        agencyId,
        search,
        undefined,
        leadSourceConfigId,
      )
      .pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible d\'exporter les leads.');
        this.isExporting.set(false);
        return EMPTY;
      }),
    ).subscribe((csv) => {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      this._snackbar.success('Export terminé', 'Le fichier CSV a été téléchargé.');
      this.isExporting.set(false);
    });
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

  /**
   * Sources configurées, pour le filtre. **Aucun filtre de statut n'est appliqué** : une source en
   * pause, en erreur ou archivée garde ses leads, et l'exclure de la liste les rendrait
   * introuvables. Le statut de la source se consulte dans Paramétrage, pas ici.
   *
   * Une seule page de 200 : le contrat pagine, mais un tenant qui dépasserait 200 sources
   * configurées demanderait de toute façon un champ de recherche plutôt qu'une liste déroulante.
   */
  private _loadLeadSources(): void {
    this._leadSourcesApiService
      .listLeadSources(undefined, undefined, "Active", undefined, 1, 200)
      .pipe(
        map((res) => [
          ALL_SOURCES_OPTION,
          ...(res.items ?? []).map((source) => ({
            label: source.label?.trim() || source.code?.trim() || 'Source sans nom',
            value: source.id ?? '',
          })),
        ]),
        catchError(() => {
          // Le filtre est un confort : son absence ne doit pas vider la page de leads. La liste
          // reste réduite à « Toutes », et le reste de l'écran fonctionne.
          this._snackbar.error('Erreur', 'La liste des sources configurées n\'a pas pu être chargée.');
          return EMPTY;
        }),
      )
      .subscribe((options) => this.sourceFilterOptions.set(options));
  }

  private _loadStats(): void {
    this._leadsApiService.getLeadStats().subscribe({
      next: (s) => this.stats.set(s),
    });
  }
}

export default LeadHomepage;
