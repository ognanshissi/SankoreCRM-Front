import { Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { DatePipe } from '@angular/common';
import { catchError, EMPTY, forkJoin, map, of } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasTitle } from '@talisoft/ui/title';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import {
  CrmTaskDto,
  CrmTaskDtoStatusEnum,
  LeadDto,
  LeadsApiService,
  TaskAssignmentEntryDto,
  TasksApiService,
  UserDto,
  UsersApiService,
} from '@sankore/crm-api';
import {
  computeSla,
  priorityMeta,
  statusMeta,
  triggerLabel,
  typeLabel,
} from './task-meta';

/** Une ligne de l'historique des attributions ; `id` sert de clé de suivi à `tas-table`. */
export interface TaskAssignmentRow extends TaskAssignmentEntryDto {
  id: string;
}

export interface TaskDetailDrawerData {
  task: CrmTaskDto;
  /**
   * Masque les actions, en gardant la consultation. L'onglet Tâches d'un lead s'en sert : sur un
   * lead converti ses actions disparaissent, et le drawer ne doit pas rouvrir une porte que l'écran
   * vient de fermer.
   */
  readOnly?: boolean;
}

/**
 * Ce que l'agent a demandé en fermant le drawer. Les actions ne sont **pas** exécutées ici : elles
 * remontent à l'hôte, qui possède déjà les parcours « démarrer », « terminer » (avec résultat et
 * tâche de suivi) et « refuser » (avec motif). Les rejouer dans ce drawer en ferait une seconde
 * implémentation à maintenir, et ouvrir un drawer depuis un drawer se passe mal.
 */
export interface TaskDetailDrawerResult {
  /**
   * `open-lead` est là pour la même raison : naviguer depuis le drawer laisserait la fiche du lead
   * s'ouvrir derrière lui. C'est l'hôte qui ferme puis navigue.
   */
  action: 'start' | 'complete' | 'decline' | 'open-lead';
  task: CrmTaskDto;
}

/**
 * Détail d'une tâche, pour l'agent qui la travaille.
 *
 * `GET /leads/tasks/{taskId}` renvoie le même `CrmTaskDto` que la liste : il n'apporte aucun champ
 * de plus, mais il est rejoué à l'ouverture pour que le statut, l'horodatage et l'échéance affichés
 * soient ceux du serveur et non ceux d'une liste chargée plusieurs minutes plus tôt. En cas d'échec,
 * on retombe sur la tâche transmise plutôt que de n'afficher qu'une erreur.
 *
 * Deux identifiants du DTO ne parlent pas à un humain — `leadId` et `assignedAgentId` : ils sont
 * résolus en noms, et le lead devient un lien. L'écran « Terminer la tâche » affichait jusqu'ici
 * « Lead <uuid> ».
 */
@Component({
  selector: 'task-detail-drawer',
  imports: [
    DatePipe,
    TimeagoPipe,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasIcon,
    TasSpinner,
    TasTag,
    TasTable,
    Button,
  ],
  templateUrl: './task-detail-drawer.html',
})
export class TaskDetailDrawer {
  private readonly _dialogRef = inject<DialogRef<TaskDetailDrawerResult>>(DialogRef);
  private readonly _tasksApi = inject(TasksApiService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _usersApi = inject(UsersApiService);

  public readonly data = inject<TaskDetailDrawerData>(DIALOG_DATA);

  public readonly statusMeta = statusMeta;
  public readonly priorityMeta = priorityMeta;
  public readonly typeLabel = typeLabel;
  public readonly triggerLabel = triggerLabel;

  public task = signal<CrmTaskDto>(this.data.task);
  public isRefreshing = signal(true);

  public lead = signal<LeadDto | null>(null);
  public isLoadingLead = signal(false);
  public agent = signal<UserDto | null>(null);

  public readonly sla = computed(() => computeSla(this.task(), Date.now()));

  public assignments = signal<TaskAssignmentRow[]>([]);
  public isLoadingAssignments = signal(true);
  /** Noms des agents cités dans l'historique, résolus une fois chacun. */
  public agentNames = signal<Record<string, string>>({});
  public readonly assignmentsTableConfig: TableConfig = {
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 5, pageSizeOptions: [5, 10] },
  };

  public readonly isPending = computed(
    () => this.task().status === CrmTaskDtoStatusEnum.Pending,
  );
  public readonly isInProgress = computed(
    () => this.task().status === CrmTaskDtoStatusEnum.InProgress,
  );
  public readonly isClosed = computed(
    () =>
      this.task().status === CrmTaskDtoStatusEnum.Completed ||
      this.task().status === CrmTaskDtoStatusEnum.Cancelled,
  );

  public readonly leadLabel = computed(() => {
    const lead = this.lead();
    if (!lead) return '';
    return (
      lead.fullName?.trim() ||
      [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() ||
      lead.phoneNumber?.trim() ||
      lead.email?.trim() ||
      'Lead sans nom'
    );
  });

  public readonly agentLabel = computed(() => {
    const agent = this.agent();
    return agent?.fullName?.trim() || agent?.email?.trim() || '';
  });

  constructor() {
    this._refreshTask();
    this._loadLead();
    this._loadAgent();
    this._loadAssignments();
  }

  public agentName(id: string | null | undefined): string {
    if (!id) return 'personne';
    return this.agentNames()[id] ?? 'un agent';
  }

  public assignmentLabel(row: TaskAssignmentRow): string {
    switch (row.kind) {
      case 'Initial':
        return row.agentId ? `Attribuée à ${this.agentName(row.agentId)}` : 'Créée sans agent';
      case 'SlaExtended':
        return `SLA prolongé — reste à ${this.agentName(row.agentId)}`;
      default:
        return `Transférée de ${this.agentName(row.previousAgentId)} à ${this.agentName(row.agentId)}`;
    }
  }

  public close(): void {
    this._dialogRef.close();
  }

  public requestAction(action: TaskDetailDrawerResult['action']): void {
    this._dialogRef.close({ action, task: this.task() });
  }

  private _refreshTask(): void {
    const id = this.data.task.id;
    if (!id) {
      this.isRefreshing.set(false);
      return;
    }

    this._tasksApi
      .getCrmTask(id)
      .pipe(
        catchError(() => {
          // La tâche transmise par la liste reste affichée : une panne de rafraîchissement ne doit
          // pas vider un drawer dont on a déjà le contenu.
          this.isRefreshing.set(false);
          return EMPTY;
        }),
      )
      .subscribe((task: CrmTaskDto) => {
        if (task) this.task.set(task);
        this.isRefreshing.set(false);
      });
  }

  private _loadLead(): void {
    const leadId = this.data.task.leadId;
    if (!leadId) return;

    this.isLoadingLead.set(true);
    this._leadsApi
      .getLead(leadId)
      .pipe(
        catchError(() => {
          // Le lead peut avoir été fusionné ou supprimé : le lien disparaît alors, et l'identifiant
          // brut reste affiché pour le support.
          this.isLoadingLead.set(false);
          return EMPTY;
        }),
      )
      .subscribe((lead) => {
        this.lead.set(lead);
        this.isLoadingLead.set(false);
      });
  }

  private _loadAssignments(): void {
    const id = this.data.task.id;
    if (!id) {
      this.isLoadingAssignments.set(false);
      return;
    }

    this._tasksApi
      .getCrmTaskAssignments(id)
      .pipe(
        catchError(() => {
          this.isLoadingAssignments.set(false);
          return EMPTY;
        }),
      )
      .subscribe((entries) => {
        // Le plus récent d'abord : c'est le dernier transfert qu'on vient chercher, et la table
        // pagine par cinq.
        const rows = [...entries]
          .reverse()
          .map((e, i) => ({ ...e, id: `${i}` }) as TaskAssignmentRow);
        this.assignments.set(rows);
        this.isLoadingAssignments.set(false);
        this._resolveAgentNames(rows);
      });
  }

  private _resolveAgentNames(rows: TaskAssignmentRow[]): void {
    const ids = [
      ...new Set(
        rows
          .flatMap((r) => [r.agentId, r.previousAgentId, r.actorId])
          .filter((x): x is string => !!x),
      ),
    ];
    if (!ids.length) return;

    forkJoin(
      ids.map((uid) =>
        this._usersApi.getUser(uid).pipe(
          map((u) => [uid, u?.fullName?.trim() || u?.email?.trim() || ''] as const),
          catchError(() => of([uid, ''] as const)),
        ),
      ),
    ).subscribe((pairs) => {
      const names: Record<string, string> = {};
      for (const [uid, name] of pairs) if (name) names[uid] = name;
      this.agentNames.set(names);
    });
  }

  private _loadAgent(): void {
    const agentId = this.data.task.assignedAgentId;
    if (!agentId) return;

    this._usersApi
      .getUser(agentId)
      .pipe(catchError(() => of(null)))
      .subscribe((agent) => this.agent.set(agent));
  }
}
