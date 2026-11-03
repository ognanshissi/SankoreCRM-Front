import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, debounceTime, EMPTY, filter, map, Subject } from 'rxjs';
import { CdkDragDrop, CdkDragStart, DragDropModule } from '@angular/cdk/drag-drop';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { PageEvent } from '@angular/material/paginator';
import {
  AgenciesApiService,
  CloseLeadRequestReasonEnum,
  LogActivityRequestTypeEnum,
  LeadDto,
  LeadsApiService,
  LeadSourcesApiService,
  UpdatePipelineStageRequestStageEnum,
  UserDto,
  UsersApiService,
} from '@sankore/crm-api';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { CreateLeadComponent } from '../create-lead/create-lead';
import { ImportLeadsComponent } from '../import-leads/import-leads';
import { SystemCaptureDrawer } from './system-capture-drawer';
import { LeadQuickViewData, LeadQuickViewDrawer } from './lead-quick-view-drawer';
import { interestedProductLabel } from '../../components/interested-product';
import { LeadNextStep } from '../../components/lead-next-step';
import { NewTaskDrawer, NewTaskDrawerData } from '@sankore/crm/tasks';
import { Severity } from '@talisoft/ui/tag';
import { AuthenticationService, PermissionsService, ProductNamesStore, QuickCreateEvents } from '@sankore/crm/common';
import { CallButton } from '@sankore/crm/telephony';
import { LogActivityDrawer, LogActivityDrawerData } from '../edit-lead/log-activity-drawer';
import { formatAmount, formatDay, originLabel, statusStepIndex, statusStepLabel } from '../edit-lead/lead-view.models';
import { LeadFilters, LeadFiltersDrawer, LeadFiltersDrawerData } from './lead-filters-drawer';

function leadStatusMeta(status: string | null | undefined): { label: string; severity: Severity } {
  switch (status) {
    case 'New':       return { label: 'Nouveau',  severity: 'info' };
    // `Open` est le statut serveur d'un lead joint ; il n'existe pas de statut `Contacted`, que cet
    // écran attendait — la pastille « Contacté » n'apparaissait donc jamais.
    case 'Open':         return { label: 'Contacté',         severity: 'warning' };
    case 'Qualifying':   return { label: 'En qualification', severity: 'warning' };
    case 'Qualified':    return { label: 'Qualifié',         severity: 'warning' };
    case 'Nurturing':    return { label: 'En maturation',    severity: 'neutral' };
    case 'Recycled':     return { label: 'Recyclé',          severity: 'neutral' };
    case 'Converted':    return { label: 'Converti',         severity: 'success' };
    case 'Lost':         return { label: 'Perdu',            severity: 'error' };
    case 'Disqualified': return { label: 'Disqualifié',      severity: 'error' };
    case 'Archived':     return { label: 'Archivé',          severity: 'neutral' };
    default:             return { label: status ?? '—', severity: 'neutral' };
  }
}

// L'API envoie le NOM du niveau (`Unknown`, `Cold`, `Warm`, `Hot`). Ces trois fonctions comparaient
// à « 0 »…« 3 » : rien ne correspondait et la colonne affichait « — » sur tous les leads.
function intentMeta(level: string | number | null | undefined): { label: string; severity: Severity } {
  switch (String(level)) {
    case 'Cold': return { label: 'Froid', severity: 'info' };
    case 'Warm': return { label: 'Tiède', severity: 'warning' };
    case 'Hot':  return { label: 'Chaud', severity: 'error' };
    default:     return { label: '—',     severity: 'neutral' };
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

// Les noms du contrat (`LeadIntentLevel`). Les anciennes valeurs « 0 »…« 3 » partaient en nombre et
// le serveur les lisait décalées d'un cran : « Froid » filtrait les leads non évalués, « Chaud » les
// tièdes. Une ancienne URL est relue par INTENT_LEGACY_PARAM, selon l'énumération du serveur.
const INTENT_FILTER_OPTIONS = [
  { label: 'Toutes', value: '' },
  { label: 'Froid', value: 'Cold' },
  { label: 'Tiède', value: 'Warm' },
  { label: 'Chaud', value: 'Hot' },
];
/** Le filtre « Statut » du tiroir : les noms du statut serveur, libellés comme la fiche les dit. */
const STATUS_FILTER_OPTIONS = [
  { label: 'Nouveau', value: 'New' },
  { label: 'Contacté', value: 'Open' },
  { label: 'En qualification', value: 'Qualifying' },
  { label: 'Qualifié', value: 'Qualified' },
  { label: 'En maturation', value: 'Nurturing' },
  { label: 'Recyclé', value: 'Recycled' },
  { label: 'Converti', value: 'Converted' },
  { label: 'Perdu', value: 'Lost' },
  { label: 'Disqualifié', value: 'Disqualified' },
  { label: 'Archivé', value: 'Archived' },
];
const INTENT_LEGACY_PARAM: Record<string, string> = { '1': 'Cold', '2': 'Warm', '3': 'Hot' };

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
  // La suite — qualification, proposition, dossier, pièces, approbation — est l'affaire du projet
  // (tableau Projets) ; le serveur refuse d'y déplacer un lead. La conversion se fait depuis la fiche.
  { stage: UpdatePipelineStageRequestStageEnum.Converted,            label: 'Converti',           color: '#22c55e', index: 4 },
  { stage: UpdatePipelineStageRequestStageEnum.Lost,                 label: 'Perdu',              color: '#ef4444', index: 5 },
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

// ——— Phases du pipeline (colonnes de la vue Pipeline) ———

/**
 * Les étapes de contact du lead regroupées en cinq phases, celles que l'agence pilote. Depuis les
 * projets (lot 4), un lead s'arrête au besoin identifié : ce qui suivait — enrichissement, dossier,
 * KYC — se suit sur ses projets. Les anciennes étapes restent rangées sous « Besoin identifié »
 * pour un lead que la migration n'aurait pas encore déplacé. Chaque colonne
 * dit sa condition de sortie : c'est elle qui fait avancer un lead, pas le glisser-déposer.
 *
 * `dropStage` est l'étape posée quand on dépose une carte dans la colonne — la première de la
 * phase. « Dispatché » n'en a pas depuis « Nouveau » : un lead y entre par l'affectation à un agent,
 * pas par un changement d'étape (voir `onDrop`).
 */
export interface PipelinePhase {
  key: 'new' | 'dispatched' | 'contacted' | 'need' | 'converted' | 'interested' | 'qualified' | 'lost';
  label: string;
  /** La condition de sortie de la colonne ; null pour une issue (Converti, Perdu). */
  exit: string | null;
  stages: string[];
  dropStage: UpdatePipelineStageRequestStageEnum;
}

const S = UpdatePipelineStageRequestStageEnum;

const PIPELINE_PHASES: PipelinePhase[] = [
  { key: 'new',        label: 'Nouveau',        exit: 'doublon écarté',              stages: [S.New],                                                   dropStage: S.New },
  { key: 'dispatched', label: 'Dispatché',      exit: 'premier contact',             stages: [S.ContactAttempted],                                      dropStage: S.ContactAttempted },
  { key: 'contacted',  label: 'En contact',       exit: 'besoin identifié',          stages: [S.ContactEstablished],                                    dropStage: S.ContactEstablished },
  { key: 'need',       label: 'Besoin identifié', exit: 'projet approuvé',
    stages: [S.NeedIdentified, S.Qualified, S.ProductProposed, S.ApplicationStarted, S.DocumentCollection, S.ApplicationCompleted, S.ApprovalPending],
    dropStage: S.NeedIdentified },
  { key: 'converted',  label: 'Converti',       exit: 'projet approuvé',             stages: [S.Converted],                                             dropStage: S.Converted },
];

/** Les étapes que le lead ne pose plus lui-même : celles de ses projets (lot 4). */
const PROJECT_STAGES = [S.Qualified, S.ProductProposed, S.ApplicationStarted, S.DocumentCollection, S.ApplicationCompleted, S.ApprovalPending];

/**
 * Le pipeline vu par un agent (propriétaire, 2026-11-02) : ses leads sont déjà à lui, « Dispatché »
 * ne lui dit rien. Il suit le parcours de la fiche lead — Nouveau, Contacté, Intéressé, Qualifié —
 * et ses deux issues, Converti et Perdu.
 */
const AGENT_PHASES: PipelinePhase[] = [
  { key: 'new',        label: 'Nouveau',   exit: 'premier contact',              stages: [S.New],                                  dropStage: S.New },
  { key: 'contacted',  label: 'Contacté',  exit: 'besoin identifié',             stages: [S.ContactAttempted, S.ContactEstablished], dropStage: S.ContactEstablished },
  { key: 'interested', label: 'Intéressé', exit: 'qualification dans un projet', stages: [S.NeedIdentified],                       dropStage: S.NeedIdentified },
  { key: 'qualified',  label: 'Qualifié',  exit: 'projet approuvé',              stages: PROJECT_STAGES,                           dropStage: S.Qualified },
  { key: 'converted',  label: 'Converti',  exit: null,                           stages: [S.Converted],                            dropStage: S.Converted },
  { key: 'lost',       label: 'Perdu',     exit: null,                           stages: [S.Lost],                                 dropStage: S.Lost },
];

/** Colonne d'un lead dans le pipeline de l'agent ; null pour un lead archivé. */
function agentPhaseOf(lead: LeadDto): PipelinePhase['key'] | null {
  const status = lead.status;
  const stage = lead.pipelineStage ?? S.New;
  if (status === 'Converted') return 'converted';
  if (status === 'Lost' || status === 'Disqualified' || stage === S.Lost) return 'lost';
  if (status === 'Archived') return null;
  // Une étape « Converti » posée à la main, sans client, reste un lead qualifié (voir `phaseOf`).
  if (status === 'Qualified' || PROJECT_STAGES.includes(stage as typeof S.Qualified) || stage === S.Converted) return 'qualified';
  if (stage === S.NeedIdentified) return 'interested';
  if (stage === S.ContactAttempted || stage === S.ContactEstablished || status === 'Open') return 'contacted';
  return 'new';
}

/** Les rôles de terrain, et ceux qui encadrent : la même règle que « Ma journée ». */
const AGENT_ROLES = ['Agent', 'CommercialAgent'];
const SUPERVISOR_ROLES = ['System', 'Administrator', 'SalesManager', 'BranchManager'];

function assigneeId(lead: LeadDto): string | null {
  return lead.currentAssignedId ?? lead.ownerId ?? null;
}

/** Phase d'un lead, ou `null` pour un lead perdu (hors pipeline actif). */
function phaseOf(lead: LeadDto): PipelinePhase['key'] | null {
  // Converti = un projet approuvé, et le statut le dit. Une étape « Converti » posée à la main par
  // l'ancien Kanban, sans client, ne suffit pas : ce lead reste dans « Besoin identifié ».
  if (lead.status === 'Converted') return 'converted';
  // Un lead clos garde l'étape où il était : archivé par une fusion, il restait dans « Dispatché ».
  if (lead.status === 'Archived' || lead.status === 'Lost' || lead.status === 'Disqualified') return null;
  const stage = lead.pipelineStage ?? S.New;
  if (stage === S.Converted) return 'need';
  // Une étape `New` couvre deux réalités : le lead attend un agent, ou il en a un et attend son
  // premier contact. Seule l'affectation les distingue.
  if (stage === S.New) return assigneeId(lead) ? 'dispatched' : 'new';
  return PIPELINE_PHASES.find((p) => p.stages.includes(stage))?.key ?? null;
}

export interface CardSla {
  label: string;
  tone: 'ok' | 'warning' | 'breach';
}

/** Le paramètre `status` de `listLeads` : le nom du statut serveur. */
type ListLeadStatus = Parameters<LeadsApiService['listLeads']>[2];

/** Les anciens liens portaient l'indice de l'onglet (`status=1`) : on les relit sous leur sens d'alors. */
const LEGACY_STATUS_PARAM: Record<string, string> = { '0': 'New', '1': 'Open', '2': 'Qualified', '3': 'Converted', '4': 'Lost' };

// ——— Old status-based columns (kept for status-view backward compat) ———

const KANBAN_COLUMNS = [
  { status: 'New',       statusValue: 'New',       label: 'Nouveau',  color: '#6366f1' },
  { status: 'Open',      statusValue: 'Open',      label: 'Contacté', color: '#f59e0b' },
  { status: 'Qualified', statusValue: 'Qualified', label: 'Qualifié', color: '#8b5cf6' },
  { status: 'Converted', statusValue: 'Converted', label: 'Converti', color: '#22c55e' },
  { status: 'Lost',      statusValue: 'Lost',      label: 'Perdu',    color: '#ef4444' },
  { status: 'Expired',   statusValue: 'Expired',   label: 'Expiré',   color: '#94a3b8' },
];

/**
 * Une vue de la liste (maquette du 2026-11-03) : un jeu prédéfini des quatre filtres qu'elle fixe —
 * statut, intérêt, agent (« moi »), file d'attente. Les autres filtres (agence, source, champs)
 * restent posés quand on change de vue ; la vue active est celle dont le jeu correspond.
 */
export interface LeadView {
  key: string;
  label: string;
  status: string;
  intent: string;
  mine: boolean;
  queue: boolean;
}

const VIEW: Omit<LeadView, 'key' | 'label'> = { status: '', intent: '', mine: false, queue: false };
const PRIMARY_VIEWS: LeadView[] = [
  { ...VIEW, key: 'mine', label: 'Mes leads', mine: true },
  { ...VIEW, key: 'new', label: 'Nouveaux', status: 'New' },
  { ...VIEW, key: 'hot', label: 'Chauds', intent: 'Hot' },
  { ...VIEW, key: 'all', label: 'Tous les leads' },
];
const MORE_VIEWS: LeadView[] = [
  { ...VIEW, key: 'contacted', label: 'Contactés', status: 'Open' },
  { ...VIEW, key: 'qualified', label: 'Qualifiés', status: 'Qualified' },
  { ...VIEW, key: 'warm', label: 'Tièdes', intent: 'Warm' },
  { ...VIEW, key: 'converted', label: 'Convertis', status: 'Converted' },
  { ...VIEW, key: 'lost', label: 'Perdus', status: 'Lost' },
  { ...VIEW, key: 'queue', label: "En file d'attente", queue: true },
];

/** Les propriétés qu'une ligne peut montrer ; le nom est toujours là. */
export type LeadColumnKey =
  'product' | 'phone' | 'status' | 'intent' | 'agent' | 'created' | 'nextStep' | 'email' | 'source' | 'agency' | 'type' | 'score';

export const LEAD_COLUMNS: ReadonlyArray<{ key: LeadColumnKey; label: string; byDefault: boolean }> = [
  { key: 'product',  label: 'Produit',          byDefault: true },
  { key: 'phone',    label: 'Téléphone',        byDefault: true },
  { key: 'status',   label: 'Statut',           byDefault: true },
  { key: 'intent',   label: 'Intérêt',          byDefault: true },
  { key: 'agent',    label: 'Agent',            byDefault: true },
  { key: 'created',  label: 'Créé',             byDefault: true },
  { key: 'nextStep', label: 'Prochaine étape',  byDefault: false },
  { key: 'email',    label: 'E-mail',           byDefault: false },
  { key: 'source',   label: 'Source',           byDefault: false },
  { key: 'agency',   label: 'Agence',           byDefault: false },
  { key: 'type',     label: 'Type',             byDefault: false },
  { key: 'score',    label: 'Score',            byDefault: false },
];

/** Le choix des colonnes reste propre à ce navigateur : un confort, pas une donnée partagée. */
const COLUMNS_STORAGE_KEY = 'sankore.leads.columns';

function storedColumns(): Set<LeadColumnKey> {
  const fallback = new Set(LEAD_COLUMNS.filter((c) => c.byDefault).map((c) => c.key));
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!raw) return fallback;
    const keys = (JSON.parse(raw) as string[]).filter((k) => LEAD_COLUMNS.some((c) => c.key === k));
    return new Set(keys as LeadColumnKey[]);
  } catch {
    return fallback;
  }
}

/** Les couleurs du statut affiché, par étape du parcours (Nouveau → issue). */
const STEP_TONES = [
  'bg-blue-50 text-blue-700',
  'bg-amber-50 text-amber-800',
  'bg-violet-50 text-violet-700',
  'bg-emerald-50 text-emerald-700',
];

/** Une teinte par personne, stable d'un affichage à l'autre : la liste se lit plus vite qu'en gris uniforme. */
const AVATAR_TONES = [
  'bg-teal-50 text-teal-800',
  'bg-orange-50 text-orange-800',
  'bg-indigo-50 text-indigo-800',
  'bg-violet-50 text-violet-800',
  'bg-sky-50 text-sky-800',
  'bg-rose-50 text-rose-800',
];

@Component({
  templateUrl: './lead-homepage.html',
  imports: [
    CallButton,
    LeadNextStep,
    FormsModule,
    Button,
    TasIcon,
    TasTable,
    TimeagoPipe,
    DragDropModule,
    Menu,
    MenuItem,
    TasMenuTrigger,
    RouterLink,
  ],
  // Les classes que la CDK pose pendant un glisser-déposer : sans elles, les cartes sautent d'un
  // coup au lieu de s'écarter, et la carte en main n'a ni ombre ni relief.
  styles: [`
    .cdk-drop-list-dragging .cdk-drag:not(.cdk-drag-placeholder) {
      transition: transform 200ms cubic-bezier(0, 0, 0.2, 1);
    }
    .cdk-drag-animating {
      transition: transform 200ms cubic-bezier(0, 0, 0.2, 1);
    }
    .cdk-drag-preview {
      box-shadow: 0 10px 25px -5px rgb(15 23 42 / 0.25);
      transform: rotate(2deg);
      cursor: grabbing;
    }
    /* La colonne survolée montre l'emplacement, pas « Aucun lead » à côté. */
    .cdk-drop-list-dragging .lead-column-empty {
      display: none;
    }
  `],
})
export class LeadHomepage implements OnInit {
  private readonly _permissions = inject(PermissionsService);
  public readonly canCreate = this._permissions.can('lead:create');
  public readonly canExport = this._permissions.can('lead:export');
  public readonly canImport = this._permissions.can('lead:import');
  public readonly canAssign = this._permissions.can('lead:assign');
  // Sans « lead:read:all », le serveur ne renvoie que les leads de l'utilisateur : filtrer par
  // agent n'aurait rien d'autre à montrer que les siens.
  public readonly canFilterByAgent = this._permissions.can('lead:read:all');
  public readonly canWhatsApp = this._permissions.can('WhatsApp.Send', 'WhatsApp.Supervise');
  public readonly canManageTasks = this._permissions.can('lead:task:manage');
  public readonly canLogActivity = this._permissions.can('lead:activity:log');

  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _productNames = inject(ProductNamesStore).ensureLoaded();
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _leadSourcesApiService = inject(LeadSourcesApiService);
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _quickCreate = inject(QuickCreateEvents);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  /** Frappes de recherche, regroupées avant l'appel réseau. */
  private readonly _search$ = new Subject<void>();

  public isLoading = signal(false);
  public isExporting = signal(false);
  public leads = signal<LeadDto[]>([]);
  public searchQuery = signal('');
  public viewMode = signal<'list' | 'kanban'>('list');
  /** Le panneau « Colonnes », ouvert sous son bouton. */
  public showColumns = signal(false);
  public visibleColumns = signal<Set<LeadColumnKey>>(storedColumns());
  public readonly columns = LEAD_COLUMNS;

  // Multi-select
  public selectedLeadIds = signal<Set<string>>(new Set());

  public readonly selectedCount = computed(() => this.selectedLeadIds().size);
  public readonly allSelected = computed(() => {
    const leads = this.leads();
    const sel = this.selectedLeadIds();
    return leads.length > 0 && leads.every((l) => sel.has(l.id!));
  });

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

  /** Un agent sans rôle d'encadrement voit son parcours, pas les étapes du dispatch. */
  public readonly isAgentView = computed(() => {
    const roles = this._auth.connectedUser()?.roles ?? [];
    return !roles.some((r) => SUPERVISOR_ROLES.includes(r)) && roles.some((r) => AGENT_ROLES.includes(r));
  });
  public readonly pipelinePhases = computed(() => (this.isAgentView() ? AGENT_PHASES : PIPELINE_PHASES));
  private phaseOf(lead: LeadDto): PipelinePhase['key'] | null {
    return this.isAgentView() ? agentPhaseOf(lead) : phaseOf(lead);
  }
  /** Converti et Perdu sont des issues : ni « actifs », ni en risque de SLA. */
  private _isOutcome(lead: LeadDto): boolean {
    const phase = this.phaseOf(lead);
    return phase === 'converted' || phase === 'lost';
  }

  // Filtres de la vue Pipeline
  /** Produit d'intérêt : filtré côté client, le contrat de `listLeads` n'a pas de paramètre produit. */
  public filterProduct = signal('');
  public filterOwnerId = signal('');
  public filterSlaRisk = signal(false);
  /** File d'attente de dispatch : leads qu'aucun agent n'a pu prendre, relancés automatiquement. */
  public filterAwaitingDispatch = signal(false);
  /** Filtres sur les champs personnalisés, `clé:valeur` (formulaires dynamiques, lot 6). */
  public filterCustom = signal<string[]>([]);
  public agents = signal<Map<string, UserDto>>(new Map());

  public readonly agentOptions = computed(() =>
    [...this.agents().values()]
      .map((u) => ({ label: u.fullName || u.email || '', value: u.id ?? '' }))
      .filter((o) => o.label && o.value)
      .sort((a, b) => a.label.localeCompare(b.label)),
  );

  public readonly productOptions = computed(() =>
    [...new Set(this.leads().map((l) => l.interestedProduct?.trim()).filter((p): p is string => !!p))].sort(),
  );

  /** Leads du pipeline actif : ni perdus, ni filtrés par les puces. */
  private readonly _pipelineLeads = computed(() => {
    const product = this.filterProduct();
    return this.leads().filter((l) => this.phaseOf(l) !== null && (!product || l.interestedProduct?.trim() === product));
  });

  public readonly activeLeadCount = computed(
    () => this._pipelineLeads().filter((l) => !this._isOutcome(l)).length,
  );

  public readonly slaRiskCount = computed(
    () => this._pipelineLeads().filter((l) => this._isSlaAtRisk(l)).length,
  );

  public readonly phaseLeads = computed(() => {
    const riskOnly = this.filterSlaRisk();
    const byPhase = new Map<string, LeadDto[]>(this.pipelinePhases().map((p) => [p.key, []]));
    for (const lead of this._pipelineLeads()) {
      if (riskOnly && !this._isSlaAtRisk(lead)) continue;
      byPhase.get(this.phaseOf(lead)!)?.push(lead);
    }
    return byPhase;
  });

  public readonly agencyLabel = computed(() => {
    const agencyId = this.filterAgencyId() || this._auth.connectedUser()?.agencyId;
    if (!agencyId) return '';
    return this.agencyOptions().find((o) => o.value === agencyId)?.label ?? '';
  });

  public readonly leadStatusMeta = leadStatusMeta;
  public readonly intentMeta = intentMeta;

  /** Currently keyboard-focused card ID */
  public focusedCardId = signal<string | null>(null);

  // ——— Vues et puces de filtre (maquette du 2026-11-03) ———

  public readonly primaryViews = PRIMARY_VIEWS;
  public readonly moreViews = MORE_VIEWS;
  private readonly _me = computed(() => this._auth.connectedUser()?.id ?? '');

  /**
   * Le filtre agent et le premier chargement attendent le compte. Lus dans `ngOnInit`, ils ne
   * l'étaient pas encore à l'ouverture directe ou au rafraîchissement : l'agent arrivait sur
   * « Tous les leads » au lieu de « Mes leads », et un lien `?owner=<moi>` perdait son filtre
   * faute de `lead:read:all`.
   */
  private _accountReady = false;
  private readonly _whenAccountReady = effect(() => {
    const me = this._me();
    if (!me || this._accountReady) return;
    this._accountReady = true;
    untracked(() => {
      const params = this._route.snapshot.queryParams;
      if (params['owner'] && (this.canFilterByAgent() || params['owner'] === me)) this.filterOwnerId.set(params['owner']);
      // Sans aucun filtre dans l'adresse, un agent arrive sur ses leads, un encadrant sur tous.
      const viewKeys = ['q', 'status', 'leadSource', 'agency', 'intent', 'owner', 'queue', 'cf'];
      if (!viewKeys.some((k) => k in params) && this.isAgentView()) this.filterOwnerId.set(me);
      this.reloadCurrentPage();
    });
  });

  /** La vue dont le jeu de filtres est celui posé ; null quand l'utilisateur a composé le sien. */
  public readonly activeView = computed<LeadView | null>(() =>
    [...PRIMARY_VIEWS, ...MORE_VIEWS].find((v) =>
      v.status === this.filterStatus()
      && v.intent === this.filterIntent()
      && v.queue === this.filterAwaitingDispatch()
      && (v.mine ? !!this._me() && this.filterOwnerId() === this._me() : !this.filterOwnerId()),
    ) ?? null,
  );
  public readonly activeMoreView = computed(() => {
    const view = this.activeView();
    return view && MORE_VIEWS.includes(view) ? view : null;
  });

  /** Les filtres posés en plus de la vue, une puce chacun. */
  public readonly filterChips = computed(() => {
    const view = this.activeView();
    const chips: { key: 'status' | 'intent' | 'agent' | 'queue' | 'agency' | 'leadSource' | 'custom'; label: string }[] = [];
    if (!view) {
      if (this.filterStatus()) chips.push({ key: 'status', label: STATUS_FILTER_OPTIONS.find((o) => o.value === this.filterStatus())?.label ?? this.filterStatus() });
      if (this.filterIntent()) chips.push({ key: 'intent', label: `Intérêt : ${intentMeta(this.filterIntent()).label}` });
      if (this.filterOwnerId()) {
        const mine = this.filterOwnerId() === this._me();
        chips.push({ key: 'agent', label: mine ? 'Mes leads' : `Agent : ${this.agents().get(this.filterOwnerId())?.fullName ?? 'sélection'}` });
      }
      if (this.filterAwaitingDispatch()) chips.push({ key: 'queue', label: "En file d'attente" });
    }
    if (this.filterAgencyId())
      chips.push({ key: 'agency', label: this.agencyOptions().find((o) => o.value === this.filterAgencyId())?.label || 'Agence' });
    if (this.filterLeadSourceId())
      chips.push({ key: 'leadSource', label: this.sourceFilterOptions().find((o) => o.value === this.filterLeadSourceId())?.label || 'Source' });
    const custom = this.filterCustom().length;
    if (custom) chips.push({ key: 'custom', label: custom > 1 ? `${custom} champs personnalisés` : '1 champ personnalisé' });
    return chips;
  });

  public isVisible(column: LeadColumnKey): boolean {
    return this.visibleColumns().has(column);
  }

  public tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: {
      serverSide: true,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [10, 25, 50],
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
    if (params['status']) this.filterStatus.set(LEGACY_STATUS_PARAM[params['status']] ?? params['status']);
    // `leadSource` et non `source` : la valeur a changé de nature (uuid au lieu d'un indice
    // d'énumération). Un ancien lien portant `source=2` est donc ignoré plutôt que mal interprété —
    // aucune correspondance n'existe entre les deux vocabulaires.
    if (params['leadSource']) this.filterLeadSourceId.set(params['leadSource']);
    if (params['agency']) this.filterAgencyId.set(params['agency']);
    if (params['intent']) this.filterIntent.set(INTENT_LEGACY_PARAM[params['intent']] ?? params['intent']);
    if (params['queue'] === '1') this.filterAwaitingDispatch.set(true);
    this.filterCustom.set(this._route.snapshot.queryParamMap.getAll('cf'));
    // La liste est la vue par défaut depuis la maquette du 2026-11-03 ; le pipeline s'ouvre par
    // `view=pipeline`. L'ancien `view=list` reste lu, sans effet.
    if (params['view'] === 'pipeline') this.viewMode.set('kanban');

    // « Nouveau lead » de la barre latérale arrive ici avec `?nouveau=1`. Écouté et non lu une
    // fois : depuis cette page, le clic change seulement le paramètre, sans recréer l'écran.
    // Le paramètre est retiré aussitôt, pour qu'un rafraîchissement ne rouvre pas le tiroir.
    this._route.queryParamMap
      .pipe(
        filter((p) => p.get('nouveau') === '1'),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => {
        this._router.navigate([], { relativeTo: this._route, queryParams: { nouveau: null }, queryParamsHandling: 'merge', replaceUrl: true });
        if (this.canCreate()) this.openCreateDrawer();
      });

    // Créé depuis « Créer » de la barre du haut : ce n'est pas cette page qui a ouvert le tiroir.
    this._quickCreate.created$
      .pipe(
        filter((c) => c.kind === 'lead'),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => {
        this.reloadCurrentPage();
      });

    this._loadAgencies();
    this._loadAgents();
    this._loadLeadSources();
  }

  // ——— Pipeline helpers ———

  public leadsOfPhase(phase: PipelinePhase['key']): LeadDto[] {
    return this.phaseLeads().get(phase) ?? [];
  }

  public phaseIds(): string[] {
    return this.pipelinePhases().map((p) => 'phase-' + p.key);
  }

  /** Initiale du prénom et nom : « A. Sow », assez pour reconnaître un collègue sur une carte étroite. */
  public agentShortName(lead: LeadDto): string {
    const id = assigneeId(lead);
    const name = id ? this.agents().get(id)?.fullName?.trim() : '';
    if (!name) return '';
    const parts = name.split(/\s+/);
    return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name;
  }

  public agencyName(agencyId: string | null | undefined): string {
    return agencyId ? this.agencyOptions().find((o) => o.value === agencyId)?.label ?? '' : '';
  }

  /**
   * Le SLA de premier contact de l'affectation en cours, tel que le serveur le calcule. Ce badge
   * lisait auparavant `expiresAt` — la durée de vie du lead, 180 jours par défaut — avec un seuil
   * fixe de 24 h : il ne signalait jamais un premier contact en retard. Le seuil « en risque »
   * vient maintenant du serveur (`sla.warningAt`), le même que celui de l'e-mail de préalerte.
   */
  public cardSla(lead: LeadDto): CardSla | null {
    const sla = lead.sla;
    if (!sla?.deadline) return null;
    if (sla.firstContactAt) return { label: 'Premier contact fait', tone: 'ok' };

    const now = Date.now();
    const remaining = new Date(sla.deadline).getTime() - now;
    if (remaining < 0) return { label: 'SLA dépassé', tone: 'breach' };
    if (sla.warningAt && now >= new Date(sla.warningAt).getTime()) {
      const h = Math.max(1, Math.round(remaining / 3_600_000));
      return { label: `SLA : ${h} h restante${h > 1 ? 's' : ''}`, tone: 'warning' };
    }
    return { label: 'Dans les délais', tone: 'ok' };
  }

  private _isSlaAtRisk(lead: LeadDto): boolean {
    if (this._isOutcome(lead)) return false;
    const sla = this.cardSla(lead);
    return !!sla && sla.tone !== 'ok';
  }

  public setProductFilter(product: string): void {
    this.filterProduct.set(product);
  }

  public toggleSlaRisk(): void {
    this.filterSlaRisk.update((v) => !v);
  }

  // ——— Drag & Drop ———

  /** Hauteur de la carte en main, que reprend l'emplacement pointillé (96 px avant le premier glisser). */
  public readonly dragPlaceholderHeight = signal(96);

  public onDragStarted(event: CdkDragStart<LeadDto>): void {
    this.dragPlaceholderHeight.set(event.source.element.nativeElement.offsetHeight || 96);
  }

  public onDrop(event: CdkDragDrop<PipelinePhase>): void {
    if (event.previousContainer === event.container) return;
    this._moveToPhase(event.item.data, event.container.data);
  }

  // ——— Keyboard navigation ———

  public onCardKeydown(event: KeyboardEvent, lead: LeadDto): void {
    const phases = this.pipelinePhases();
    const idx = phases.findIndex((p) => p.key === this.phaseOf(lead));
    let target: PipelinePhase | undefined;

    if (event.key === 'ArrowRight') {
      target = phases[idx + 1];
    } else if (event.key === 'ArrowLeft') {
      target = phases[idx - 1];
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.openQuickView(lead);
      return;
    } else {
      return;
    }

    event.preventDefault();
    if (target) this._moveToPhase(lead, target);
  }

  private _moveToPhase(lead: LeadDto, phase: PipelinePhase): void {
    if (this.isAgentView()) {
      this._moveForAgent(lead, phase);
      return;
    }
    const fromStage = lead.pipelineStage ?? S.New;
    if (phaseOf(lead) === phase.key) return;
    if (fromStage === phase.dropStage) {
      // Seul cas : un lead affecté ramené dans « Nouveau ». Sans désaffectation, il y reviendrait.
      this._snackbar.error('Transition refusée', 'Ce lead a déjà un agent : il reste dans « Dispatché ».');
      return;
    }

    if (phase.key === 'converted') {
      this._snackbar.error(
        'Transition refusée',
        "Un lead devient client quand l'un de ses projets est approuvé : faites avancer le projet depuis sa fiche.",
      );
      return;
    }

    if (phase.key === 'dispatched' && !assigneeId(lead)) {
      this._snackbar.error('Transition refusée', "Un lead entre dans « Dispatché » par son affectation à un agent : dispatchez-le depuis sa fiche.");
      return;
    }

    if (!isTransitionAllowed(fromStage, phase.dropStage)) {
      this._snackbar.error('Transition refusée', transitionBlockedMessage(fromStage, phase.dropStage));
      return;
    }

    this._moveLeadOptimistic(lead, fromStage, phase.dropStage);
  }

  /**
   * Les colonnes de l'agent. Le contact et l'intérêt se posent en déplaçant la carte ; la
   * qualification se fait dans un projet et la conversion à son approbation, comme sur la fiche.
   * « Perdu » clôt le lead, après confirmation, comme « Clôturer le lead » de la fiche.
   */
  private _moveForAgent(lead: LeadDto, phase: PipelinePhase): void {
    const from = agentPhaseOf(lead);
    if (from === phase.key) return;

    if (from === 'converted') {
      this._snackbar.error('Transition refusée', 'Un lead converti ne change plus de colonne.');
      return;
    }
    if (from === 'lost') {
      this._snackbar.error('Transition refusée', 'Réouvrez le lead depuis sa fiche pour le remettre dans le parcours.');
      return;
    }
    if (phase.key === 'qualified') {
      this._snackbar.error('Transition refusée', 'Un lead se qualifie dans un projet : ouvrez sa fiche et qualifiez-le dans un projet.');
      return;
    }
    if (phase.key === 'converted') {
      this._snackbar.error(
        'Transition refusée',
        "Un lead devient client quand l'un de ses projets est approuvé : faites avancer le projet depuis sa fiche.",
      );
      return;
    }
    if (phase.key === 'lost') {
      this._confirmLost(lead);
      return;
    }

    const fromStage = lead.pipelineStage ?? S.New;
    if (fromStage === phase.dropStage) return;
    if (!isTransitionAllowed(fromStage, phase.dropStage)) {
      this._snackbar.error('Transition refusée', `Transition non autorisée vers « ${phase.label} » : avancez d'une étape à la fois, ou passez le lead en Perdu.`);
      return;
    }
    this._moveLeadOptimistic(lead, fromStage, phase.dropStage);
  }

  private _confirmLost(lead: LeadDto): void {
    this._confirmDialog.confirm({
      title: 'Passer ce lead en perdu ?',
      message: `« ${this.displayName(lead)} » sera clôturé comme perdu. Vous pourrez le réouvrir depuis sa fiche.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Passer en perdu', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this._leadsApiService.closeLead(lead.id!, {
          reason: CloseLeadRequestReasonEnum.Lost,
          detail: 'Déplacé dans « Perdu » depuis le pipeline',
        }).pipe(
          catchError(() => {
            this._snackbar.error('Erreur', 'Le lead n\'a pas pu être clôturé.');
            return EMPTY;
          }),
        ).subscribe(() => {
          this._snackbar.success('Lead perdu', `« ${this.displayName(lead)} » est passé en perdu.`);
          this.reloadCurrentPage();
              });
      },
    });
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
        const toLabel = this.pipelinePhases().find((p) => p.stages.includes(toStage))?.label ?? toStage;
        this._snackbar.success('Lead déplacé', `Déplacé vers « ${toLabel} »`);
          });
  }

  // ——— Existing methods (unchanged) ———

  /**
   * Source affichée sur une ligne : le libellé de la source **configurée** quand le lead en a une,
   * sinon le canal d'entrée. Les deux coexistent sur `LeadDto`, et afficher le seul canal revenait
   * à montrer « Web » pour trois campagnes différentes.
   */
  public productLabel(lead: LeadDto): string | null {
    return interestedProductLabel(lead.interestedProduct, this._productNames.names());
  }

  /** Libellé d'une valeur du filtre ; « Unknown » s'y lit « Non précisé ». */
  public productValueLabel(value: string): string {
    return interestedProductLabel(value, this._productNames.names()) ?? 'Non précisé';
  }

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
      case 'Cold': return 'text-blue-600';
      case 'Warm': return 'text-amber-600';
      case 'Hot':  return 'text-red-600';
      default:     return 'text-slate-400';
    }
  }

  public intentDotBg(level: string | number | null | undefined): string {
    switch (String(level)) {
      case 'Cold': return 'bg-blue-500';
      case 'Warm': return 'bg-amber-500';
      case 'Hot':  return 'bg-red-500';
      default:     return 'bg-slate-300';
    }
  }

  public setViewMode(mode: 'list' | 'kanban'): void {
    this.viewMode.set(mode);
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { view: mode === 'kanban' ? 'pipeline' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
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
        owner: this.filterOwnerId() || null,
        queue: this.filterAwaitingDispatch() ? '1' : null,
        // Répété dans l'URL (`cf=a:b&cf=c:d`), comme le serveur le lit.
        cf: this.filterCustom().length ? this.filterCustom() : null,
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

    const status = (this.filterStatus() || undefined) as ListLeadStatus | undefined;
    const agencyId = this.filterAgencyId() || undefined;
    const intent = (this.filterIntent() || undefined) as 'Cold' | 'Warm' | 'Hot' | undefined;
    const search = this.searchQuery() || undefined;
    const leadSourceConfigId = this.filterLeadSourceId() || undefined;
    const ownerId = this.filterOwnerId() || undefined;
    const awaitingDispatch = this.filterAwaitingDispatch() || undefined;

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
        awaitingDispatch,
        this.filterCustom().length ? this.filterCustom() : undefined,
        undefined,
        // Les leads que l'agent tient — affectés, ou à lui sans affectation —, ce que dit la colonne
        // « Agent ». `ownerId` seul manquait les leads dispatchés à un agent qui n'en est pas le propriétaire.
        ownerId,
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

  /**
   * Un clic sur un lead ouvre son aperçu, sans quitter la liste ni perdre filtres et défilement.
   * Ctrl/⌘ + clic ouvre directement la fiche complète dans un nouvel onglet, comme sur un lien.
   */
  public openQuickView(lead: LeadDto, event?: MouseEvent): void {
    if (event && (event.ctrlKey || event.metaKey)) {
      window.open(this._router.serializeUrl(this._router.createUrlTree(['/leads', lead.id])), '_blank');
      return;
    }

    const phase = this.phaseOf(lead);
    this._sideDrawerService.open<void, LeadQuickViewData, LeadQuickViewDrawer>(LeadQuickViewDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: {
        lead,
        phaseLabel: this.pipelinePhases().find((p) => p.key === phase)?.label ?? null,
        agentName: this.agents().get(assigneeId(lead) ?? '')?.fullName?.trim() ?? '',
        agencyName: this.agencyName(lead.agencyId),
        sla: this._isOutcome(lead) ? null : this.cardSla(lead),
      },
    });
  }

  public prospectTypeLabel(type: number | null | undefined): string {
    switch (Number(type)) {
      case 0: return 'Individuel';
      case 1: return 'Entreprise';
      default: return '—';
    }
  }

  // ——— Vues, filtres, colonnes ———

  public selectView(view: LeadView): void {
    this.filterStatus.set(view.status);
    this.filterIntent.set(view.intent);
    this.filterOwnerId.set(view.mine ? this._me() : '');
    this.filterAwaitingDispatch.set(view.queue);
    this._applyFilters();
  }

  public removeChip(key: 'status' | 'intent' | 'agent' | 'queue' | 'agency' | 'leadSource' | 'custom'): void {
    switch (key) {
      case 'status':     this.filterStatus.set(''); break;
      case 'intent':     this.filterIntent.set(''); break;
      case 'agent':      this.filterOwnerId.set(''); break;
      case 'queue':      this.filterAwaitingDispatch.set(false); break;
      case 'agency':     this.filterAgencyId.set(''); break;
      case 'leadSource': this.filterLeadSourceId.set(''); break;
      case 'custom':     this.filterCustom.set([]); break;
    }
    this._applyFilters();
  }

  public openFiltersDrawer(): void {
    const withoutAll = (options: { label: string; value: string }[]) => options.filter((o) => o.value);
    const ref = this._sideDrawerService.open<LeadFilters | null, LeadFiltersDrawerData, LeadFiltersDrawer>(LeadFiltersDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: {
        value: {
          status: this.filterStatus(),
          intent: this.filterIntent(),
          agent: this.filterOwnerId(),
          agency: this.filterAgencyId(),
          leadSource: this.filterLeadSourceId(),
          queue: this.filterAwaitingDispatch(),
          custom: this.filterCustom(),
        },
        statusOptions: STATUS_FILTER_OPTIONS,
        intentOptions: withoutAll(INTENT_FILTER_OPTIONS),
        agencyOptions: withoutAll(this.agencyOptions()),
        sourceOptions: withoutAll(this.sourceFilterOptions()),
        agentOptions: this.canFilterByAgent() ? this.agentOptions() : [],
      },
    });
    ref.closed.subscribe((next) => {
      if (!next) return;
      this.filterStatus.set(next.status);
      this.filterIntent.set(next.intent);
      this.filterOwnerId.set(next.agent);
      this.filterAgencyId.set(next.agency);
      this.filterLeadSourceId.set(next.leadSource);
      this.filterAwaitingDispatch.set(next.queue);
      this.filterCustom.set(next.custom);
      this._applyFilters();
    });
  }

  public toggleColumn(column: LeadColumnKey): void {
    this.visibleColumns.update((set) => {
      const next = new Set(set);
      if (next.has(column)) next.delete(column); else next.add(column);
      return next;
    });
    this._saveColumns();
  }

  public resetColumns(): void {
    this.visibleColumns.set(new Set(LEAD_COLUMNS.filter((c) => c.byDefault).map((c) => c.key)));
    this._saveColumns();
  }

  private _saveColumns(): void {
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify([...this.visibleColumns()]));
    } catch {
      // Stockage indisponible (navigation privée) : le choix vaut pour cette visite.
    }
  }

  // ——— Une ligne ———

  /** « Contacté », « Intéressé »… : le parcours de la fiche lead, pas le statut serveur brut. */
  public statusLabel(lead: LeadDto): string {
    return statusStepLabel(lead, statusStepIndex(lead));
  }

  public statusTone(lead: LeadDto): string {
    const index = statusStepIndex(lead);
    if (index < STEP_TONES.length) return STEP_TONES[index];
    return lead.status === 'Converted' ? 'bg-emerald-600 text-white' : 'bg-red-50 text-red-700';
  }

  public avatarTone(lead: LeadDto): string {
    const key = lead.id ?? this.displayName(lead);
    let hash = 0;
    for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
  }

  /** « Venu par Recommandation » : la source configurée, sinon le canal. */
  public origin(lead: LeadDto): string {
    return originLabel(lead);
  }

  public amountLabel(lead: LeadDto): string {
    return formatAmount(lead.desiredAmount?.amount, lead.desiredAmount?.currency);
  }

  /** « Ambroise B. » : le prénom se lit d'abord, l'initiale départage. */
  public agentName(lead: LeadDto): string {
    const id = assigneeId(lead);
    const name = id ? this.agents().get(id)?.fullName?.trim() : '';
    if (!name) return '';
    const parts = name.split(/\s+/);
    const last = parts[parts.length - 1];
    // Un nom qui finit par un chiffre (« Agent 3 ») reste entier : « Tester 3. » ne dit plus qui c'est.
    return parts.length > 1 && /^\p{L}/u.test(last) ? `${parts[0]} ${last[0]}.` : name;
  }

  public agencyLabelOf(lead: LeadDto): string {
    return this.agencyName(lead.agencyId);
  }

  /** « aujourd'hui », « hier », sinon le jour (« 29 oct. »). */
  public createdLabel(lead: LeadDto): string {
    const iso = lead.capturedAt ?? lead.createdAt;
    if (!iso) return '—';
    const day = new Date(iso);
    const today = new Date();
    const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((startOf(today) - startOf(day)) / 86_400_000);
    if (diff === 0) return "aujourd'hui";
    if (diff === 1) return 'hier';
    return day.getFullYear() === today.getFullYear() ? formatDay(iso, true) : formatDay(iso);
  }

  public openTaskFor(lead: LeadDto): void {
    const ref = this._sideDrawerService.open<string, NewTaskDrawerData, NewTaskDrawer>(NewTaskDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { subject: { type: 'lead', id: lead.id!, label: this.displayName(lead) } },
    });
    ref.closed.subscribe((id) => {
      if (id) this.reloadCurrentPage();
    });
  }

  public openNoteFor(lead: LeadDto): void {
    const ref = this._sideDrawerService.open(LogActivityDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { leadId: lead.id!, leadName: this.displayName(lead), initialType: LogActivityRequestTypeEnum.Note } satisfies LogActivityDrawerData,
    });
    ref.closed.subscribe((result) => {
      if (result) this.reloadCurrentPage();
    });
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

    // Une tâche par lead sélectionné. L'ancien tiroir n'en créait qu'une, pour le premier, en
    // annonçant pourtant « tâche créée pour N leads ».
    // Par les identifiants sélectionnés, pas par la page affichée : une sélection peut en déborder.
    const byId = new Map(this.leads().map((l) => [l.id, l]));
    const leads = selectedIds.map((id) => {
      const lead = byId.get(id);
      return { id, label: lead ? this.displayName(lead) : 'Lead' };
    });

    const ref = this._sideDrawerService.open<string, NewTaskDrawerData, NewTaskDrawer>(NewTaskDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { leads },
    });

    ref.closed.subscribe((id) => {
      if (!id) return;
      this.clearSelection();
      this.reloadCurrentPage();
    });
  }

  public openSystemCaptureDrawer(): void {
    const ref = this._sideDrawerService.open(SystemCaptureDrawer, {
      width: '100%', height: '100%', panelClass: 'side-drawer-panel',
    });
    ref.closed.subscribe((created: any) => {
      if (created) { this.reloadCurrentPage(); }
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
    const status = (this.filterStatus() || undefined) as ListLeadStatus | undefined;
    const agencyId = this.filterAgencyId() || undefined;
    const search = this.searchQuery() || undefined;
    const leadSourceConfigId = this.filterLeadSourceId() || undefined;
    const intent = (this.filterIntent() || undefined) as 'Cold' | 'Warm' | 'Hot' | undefined;

    // Les mêmes filtres que la liste : exporter « Chauds », « Mes leads » ou la file d'attente
    // donnait tous les leads des seuls statut, agence, recherche et source.
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
        intent,
        this.filterAwaitingDispatch() || undefined,
        this.filterCustom().length ? this.filterCustom() : undefined,
        this.filterOwnerId() || undefined,
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

  /** Agents actifs, pour nommer le titulaire d'une carte et alimenter la puce « Agent ». */
  private _loadAgents(): void {
    this._usersApiService
      .listUsers('Active', undefined, undefined, 1, 500)
      .pipe(catchError(() => EMPTY))
      .subscribe((res) => {
        this.agents.set(new Map((res.items ?? []).filter((u) => !!u.id).map((u) => [u.id!, u])));
      });
  }


}

export default LeadHomepage;
