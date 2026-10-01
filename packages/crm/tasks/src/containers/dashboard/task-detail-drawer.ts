import { Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { DatePipe } from '@angular/common';
import { catchError, EMPTY, of } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasTitle } from '@talisoft/ui/title';
import { TimeagoPipe } from '@talisoft/ui/timeago';
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

  private _loadAgent(): void {
    const agentId = this.data.task.assignedAgentId;
    if (!agentId) return;

    this._usersApi
      .getUser(agentId)
      .pipe(catchError(() => of(null)))
      .subscribe((agent) => this.agent.set(agent));
  }
}
