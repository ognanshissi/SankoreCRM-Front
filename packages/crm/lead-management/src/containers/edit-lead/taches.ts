import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, map } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import {
  TasksApiService,
  CrmTaskDto,
  CrmTaskDtoStatusEnum,
  CrmTaskDtoPriorityEnum,
  CreateTaskRequestPriorityEnum,
  FormFieldReferenceTargetEnum,
} from '@sankore/crm-api';
import {
  CompleteTaskDrawer,
  DeclineTaskDrawer,
  NewTaskDrawer,
  NewTaskDrawerData,
  TaskDetailDrawer,
  TaskDetailDrawerResult,
} from '@sankore/crm/tasks';
import {
  AuthenticationService,
  completenessGapLabel,
  completenessGapSection,
  EntityFormReferences,
  PermissionsService,
  SYSTEM_TASK_TYPES,
  taskTypeLabel,
} from '@sankore/crm/common';
import { LeadEditContext } from './lead-edit-context';
import { LeadComplianceStore } from './lead-compliance-store';
import { ConvertedLeadNotice } from './converted-lead-notice';
import { displayName, isConsentGap } from './lead-view.models';

type TaskFilter = 'todo' | 'done' | 'all';

interface TaskTypeMeta {
  label: string;
  icon: string;
}

/** Icônes des types système ; un type ajouté par le tenant prend celle d'une tâche générique. */
const TASK_TYPE_ICONS: Record<string, string> = {
  FirstContact:   'feather:phone',
  Qualification:  'feather:list',
  SlaFollowUp:    'feather:clock',
  ScoreReview:    'feather:bar-chart-2',
  OwnerHandover:  'feather:repeat',
  ManualDispatch: 'feather:shuffle',
};

const CLOSED_LEAD_STATUSES = ['Converted', 'Lost', 'Disqualified', 'Archived'];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface TaskSuggestion {
  key: string;
  icon: string;
  title: string;
  description: string;
  type: string;
  priority: CreateTaskRequestPriorityEnum;
}

/** Le libellé vient du paramétrage du tenant, joint à la tâche par le serveur. */
function typeMeta(task: CrmTaskDto): TaskTypeMeta {
  return {
    label: taskTypeLabel(task.type, task.typeLabel),
    icon: TASK_TYPE_ICONS[task.type ?? ''] ?? 'feather:check-square',
  };
}

function isOpen(task: CrmTaskDto): boolean {
  return task.status === CrmTaskDtoStatusEnum.Pending || task.status === CrmTaskDtoStatusEnum.InProgress;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? 's' : ''}`;
}

/** « 3 jours », « 5 h », « moins d'une heure ». */
function spanLabel(ms: number): string {
  if (ms >= DAY) return plural(Math.round(ms / DAY), 'jour');
  if (ms >= HOUR) return `${Math.round(ms / HOUR)} h`;
  return 'moins d\'une heure';
}

function dateTimeLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day} à ${time}`;
}

@Component({
  selector: 'lead-taches',
  imports: [TasCard, TasSpinner, TasIcon, TasTag, Button, ConvertedLeadNotice],
  templateUrl: './taches.html',
})
export class LeadTachesPage {
  private readonly _permissions = inject(PermissionsService);
  private readonly _leadEditContext = inject(LeadEditContext);
  private readonly _compliance = inject(LeadComplianceStore);
  private readonly _authenticationService = inject(AuthenticationService);
  private readonly _references = inject(EntityFormReferences);
  // Un lead converti est figé : l'état est replié dans la garde de droits
  // que le template lit déjà, pour qu'aucune action d'écriture ne puisse y
  // échapper.
  private readonly _canManageTask = this._permissions.can('lead:task:manage');
  public readonly canManageTask = computed(
    () => this._canManageTask() && !this._leadEditContext.isReadOnly(),
  );

  private readonly _tasksApi = inject(TasksApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sideDrawer = inject(SideDrawerService);

  public readonly id = input.required<string>();
  public readonly typeMeta = typeMeta;

  public readonly isLoading = signal(true);
  public readonly tasks = signal<CrmTaskDto[]>([]);
  public readonly actionInProgress = signal<string | null>(null);
  public readonly filter = signal<TaskFilter>('all');
  public readonly addingSuggestion = signal<string | null>(null);
  private readonly _dismissed = signal<Set<string>>(new Set());

  private readonly _users = toSignal(
    this._references.options(FormFieldReferenceTargetEnum.User).pipe(
      map((options) => new Map(options.map((o) => [o.value, o.label] as const))),
    ),
    { initialValue: new Map<string, string>() },
  );

  public readonly openTasks = computed(() =>
    this.tasks()
      .filter(isOpen)
      .sort((a, b) => new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime()),
  );

  public readonly closedTasks = computed(() =>
    this.tasks()
      .filter((t) => !isOpen(t))
      .sort((a, b) => new Date(b.completedAt ?? b.createdAt ?? 0).getTime() - new Date(a.completedAt ?? a.createdAt ?? 0).getTime()),
  );

  public readonly summary = computed(() => {
    const open = this.openTasks().length;
    const inProgress = this.openTasks().filter((t) => t.status === CrmTaskDtoStatusEnum.InProgress).length;
    const done = this.closedTasks().length;
    const first = open === 0
      ? 'Aucune tâche en cours'
      : `${plural(open, 'tâche')} à faire${inProgress ? ` dont ${inProgress} en cours` : ''}`;
    return `${first} · ${done} terminée${done > 1 ? 's' : ''}`;
  });

  public readonly filters = computed<{ key: TaskFilter; label: string; count: number }[]>(() => [
    { key: 'todo', label: 'À faire', count: this.openTasks().length },
    { key: 'done', label: 'Terminées', count: this.closedTasks().length },
    { key: 'all', label: 'Toutes', count: this.tasks().length },
  ]);

  public readonly showOpen = computed(() => this.filter() !== 'done');
  public readonly showClosed = computed(() => this.filter() !== 'todo');

  /**
   * Ce qui fait avancer le dossier et qu'aucune tâche ouverte ne couvre encore. Tout vient de ce
   * que la fiche affiche déjà (score, jauge de complétude) : l'onglet ne calcule aucun manque
   * lui-même, sinon il finirait par en proposer un que la conversion ne réclame pas.
   */
  public readonly suggestions = computed<TaskSuggestion[]>(() => {
    const lead = this._leadEditContext.lead();
    if (!lead || !this.canManageTask() || CLOSED_LEAD_STATUSES.includes(lead.status ?? '')) return [];

    const firstName = lead.firstName || displayName(lead);
    const gaps = this._compliance.completeness()?.gaps ?? [];
    const result: TaskSuggestion[] = [];

    if ((lead.qualificationCompleteness ?? 0) === 0 && lead.status !== 'Qualified') {
      result.push({
        key: 'qualify',
        icon: 'feather:list',
        title: 'Qualifier le lead',
        description: 'Il n\'a pas encore de score : la qualification mesure son intérêt et ouvre la suite du dossier.',
        type: SYSTEM_TASK_TYPES.Qualification,
        priority: CreateTaskRequestPriorityEnum.High,
      });
    }

    const consents = gaps.filter((g) => isConsentGap(g.code));
    if (consents.length > 0) {
      const blocking = consents.some((g) => g.blocking);
      result.push({
        key: 'consents',
        icon: 'feather:shield',
        title: consents.length === 1
          ? 'Recueillir le consentement obligatoire'
          : `Recueillir les ${consents.length} consentements obligatoires`,
        description: blocking
          ? `Sans ${consents.length > 1 ? 'eux' : 'lui'}, ${firstName} ne pourra pas être converti en client.`
          : 'Ils sont attendus avant la conversion.',
        type: SYSTEM_TASK_TYPES.Generic,
        priority: blocking ? CreateTaskRequestPriorityEnum.High : CreateTaskRequestPriorityEnum.Medium,
      });
    }

    // Les manques de la fiche client se corrigent sur le client, pas par une tâche du lead.
    const missing = gaps.filter((g) => !isConsentGap(g.code) && completenessGapSection(g.code) !== 'client');
    if (missing.length > 0) {
      const labels = missing.map((g) => g.detail || completenessGapLabel(g.code));
      result.push({
        key: 'missing-info',
        icon: 'feather:phone',
        title: missing.length === 1
          ? `Obtenir : ${labels[0].charAt(0).toLowerCase()}${labels[0].slice(1)}`
          : `Obtenir ${missing.length} informations manquantes`,
        description: missing.length === 1
          ? `À demander à ${firstName} pour compléter le dossier.`
          : `${labels.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`,
        type: SYSTEM_TASK_TYPES.Generic,
        priority: missing.some((g) => g.blocking) ? CreateTaskRequestPriorityEnum.High : CreateTaskRequestPriorityEnum.Medium,
      });
    }

    const openTitles = new Set(this.openTasks().map((t) => (t.title ?? '').trim().toLowerCase()));
    const openTypes = new Set(this.openTasks().map((t) => t.type));
    const dismissed = this._dismissed();
    return result.filter((s) =>
      !dismissed.has(s.key)
      && !openTitles.has(s.title.toLowerCase())
      && !(s.type === SYSTEM_TASK_TYPES.Qualification && openTypes.has(SYSTEM_TASK_TYPES.Qualification)),
    );
  });

  constructor() {
    effect(() => {
      const leadId = this.id();
      this._dismissed.set(this._readDismissed(leadId));
      this._loadTasks();
    });
  }

  // ——— Lecture des tâches ———

  public assigneeName(task: CrmTaskDto): string | null {
    const id = task.assignedAgentId;
    if (!id) return null;
    if (id === this._authenticationService.connectedUser()?.id) return 'vous';
    return this._users().get(id) ?? null;
  }

  public dueLabel(task: CrmTaskDto): { text: string; late: boolean } | null {
    if (!task.dueAt) return null;
    const diff = new Date(task.dueAt).getTime() - Date.now();
    if (Number.isNaN(diff)) return null;
    return diff < 0
      ? { text: `En retard de ${spanLabel(-diff)}`, late: true }
      : { text: `Échéance dans ${spanLabel(diff)}`, late: false };
  }

  /**
   * Une tâche « premier contact » née du dispatch se ferme seule quand l'agent enregistre le premier
   * contact (`AssignmentTasks.CompleteFirstContactAsync`), une tâche « dispatch manuel » quand le
   * lead trouve un agent. Fermée sans avoir été démarrée, elle l'a donc été par le serveur : l'écran
   * n'offre « Terminer » qu'après « Démarrer ».
   */
  public closedLabel(task: CrmTaskDto): string {
    if (task.status === CrmTaskDtoStatusEnum.Cancelled) {
      return task.triggerEventType === 'LeadDispatched'
        ? 'Annulée : le lead a changé d\'agent.'
        : 'Annulée.';
    }
    const when = dateTimeLabel(task.completedAt);
    if (!task.startedAt && task.triggerEventType === 'LeadDispatched' && task.type === SYSTEM_TASK_TYPES.FirstContact) {
      const who = this.assigneeName(task);
      const subject = who === 'vous' ? 'vous avez' : who ? `${who} a` : 'l\'agent a';
      return `Terminée automatiquement le ${when}, quand ${subject} enregistré le premier contact.`;
    }
    if (!task.startedAt && task.triggerEventType === 'LeadDispatchingFailed') {
      return `Terminée automatiquement le ${when}, quand le lead a trouvé un agent.`;
    }
    return when ? `Terminée le ${when}.` : 'Terminée.';
  }

  public timingChip(task: CrmTaskDto): { text: string; onTime: boolean } | null {
    if (task.status !== CrmTaskDtoStatusEnum.Completed || !task.completedAt || !task.dueAt) return null;
    const diff = new Date(task.dueAt).getTime() - new Date(task.completedAt).getTime();
    if (Number.isNaN(diff)) return null;
    if (Math.abs(diff) < HOUR) return { text: 'Faite à l\'échéance', onTime: true };
    return diff > 0
      ? { text: `Faite ${spanLabel(diff)} avant l'échéance`, onTime: true }
      : { text: `Faite ${spanLabel(-diff)} après l'échéance`, onTime: false };
  }

  public isHighPriority(task: CrmTaskDto): boolean {
    return task.priority === CrmTaskDtoPriorityEnum.High || task.priority === CrmTaskDtoPriorityEnum.Critical;
  }

  // ——— Suggestions ———

  public addSuggestion(s: TaskSuggestion): void {
    const lead = this._leadEditContext.lead();
    const me = this._authenticationService.connectedUser()?.id ?? null;
    const assignee = lead?.currentAssignedId ?? lead?.ownerId ?? me;
    this.addingSuggestion.set(s.key);

    this._tasksApi.createCrmTask({
      type: s.type,
      priority: s.priority,
      title: s.title,
      description: s.description,
      dueAt: new Date(Date.now() + DAY).toISOString(),
      leadId: this.id(),
      assignedAgentId: assignee,
    }).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible d\'ajouter la tâche.');
        this.addingSuggestion.set(null);
        return EMPTY;
      }),
    ).subscribe(() => {
      const who = assignee === me ? 'vous' : this._users().get(assignee ?? '') ?? 'l\'agent du lead';
      this._snackbar.success('Tâche ajoutée', `Échéance demain, assignée à ${who}.`);
      this.addingSuggestion.set(null);
      this._refresh();
    });
  }

  public dismissSuggestion(s: TaskSuggestion): void {
    const next = new Set(this._dismissed()).add(s.key);
    this._dismissed.set(next);
    try {
      localStorage.setItem(this._dismissedKey(this.id()), JSON.stringify([...next]));
    } catch {
      // Stockage indisponible (navigation privée) : la suggestion reste masquée jusqu'au rechargement.
    }
  }

  // ——— Actions ———

  /**
   * Détail de la tâche. `readOnly` suit la garde de l'écran : sur un lead converti, ou sans le droit
   * `lead:task:manage`, le drawer n'offre que la consultation.
   */
  public openTaskDetail(task: CrmTaskDto): void {
    if (!task.id) return;
    const ref = this._sideDrawer.open<TaskDetailDrawerResult, unknown, TaskDetailDrawer>(
      TaskDetailDrawer,
      {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: { task, readOnly: !this.canManageTask() },
      },
    );

    ref.closed.subscribe((result) => {
      if (!result) return;
      switch (result.action) {
        case 'start':
          this.startTask(result.task);
          break;
        case 'complete':
          this.completeTask(result.task);
          break;
        case 'decline':
          this.declineTask(result.task);
          break;
        case 'open-lead':
          // Déjà sur la fiche du lead : rien à faire.
          break;
      }
    });
  }

  public openCreateTaskDrawer(): void {
    const lead = this._leadEditContext.lead();
    const ref = this._sideDrawer.open<string, NewTaskDrawerData, NewTaskDrawer>(NewTaskDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: {
        subject: { type: 'lead', id: this.id(), label: lead ? displayName(lead) : 'Ce lead' },
        // Le lead a déjà quelqu'un : c'est à lui que la tâche revient d'abord.
        holderId: lead?.currentAssignedId ?? lead?.ownerId ?? null,
      },
    });

    ref.closed.subscribe((id) => {
      if (id) this._refresh();
    });
  }

  public startTask(task: CrmTaskDto): void {
    if (!task.id) return;

    // Optimistic update
    this.tasks.update((list) =>
      list.map((t) =>
        t.id === task.id
          ? { ...t, status: CrmTaskDtoStatusEnum.InProgress, startedAt: new Date().toISOString() }
          : t,
      ),
    );

    // Silent server confirmation
    this._tasksApi.startCrmTask(task.id).pipe(
      catchError(() => {
        // Rollback
        this.tasks.update((list) =>
          list.map((t) =>
            t.id === task.id ? { ...t, status: CrmTaskDtoStatusEnum.Pending, startedAt: null } : t,
          ),
        );
        this._snackbar.error('Erreur', 'Impossible de démarrer la tâche. Elle a été remise en attente.');
        return EMPTY;
      }),
    ).subscribe();
  }

  public completeTask(task: CrmTaskDto): void {
    if (!task.id) return;

    const ref = this._sideDrawer.open(CompleteTaskDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { task },
    });

    ref.closed.subscribe((result) => {
      if (result && typeof result === 'object' && (result as any).completed) {
        this._refresh();
      }
    });
  }

  public declineTask(task: CrmTaskDto): void {
    if (!task.id) return;

    const ref = this._sideDrawer.open(DeclineTaskDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { task },
    });

    ref.closed.subscribe((declined) => {
      if (declined) {
        this.tasks.update((list) => list.filter((t) => t.id !== task.id));
        this._leadEditContext.reload();
      }
    });
  }

  /**
   * Une tâche ajoutée, faite ou refusée change la « Prochaine étape » de l'en-tête : sans relire le
   * lead, l'en-tête montrait encore la tâche terminée jusqu'à la relecture suivante (30 s).
   */
  private _refresh(): void {
    this._loadTasks();
    this._leadEditContext.reload();
  }

  /**
   * Toutes les tâches du lead que l'utilisateur a le droit de voir. Le serveur restreint déjà
   * (un agent ne reçoit que les siennes, un responsable celles de son équipe) : filtrer en plus sur
   * l'utilisateur connecté cachait à un responsable les tâches de l'agent qui suit le lead.
   * Le spinner ne couvre que le premier chargement : après un ajout, la liste se met à jour en place.
   */
  private _loadTasks(): void {
    this._tasksApi.listCrmTasks(this.id()).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de charger les tâches du lead.');
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((tasks) => {
      this.tasks.set(tasks ?? []);
      this.isLoading.set(false);
    });
  }

  private _dismissedKey(leadId: string): string {
    return `lead-task-suggestions-dismissed:${leadId}`;
  }

  private _readDismissed(leadId: string): Set<string> {
    try {
      const raw = localStorage.getItem(this._dismissedKey(leadId));
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  }
}

export default LeadTachesPage;
