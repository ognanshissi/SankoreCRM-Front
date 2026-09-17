import { Component, inject, input, OnInit, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import {
  TaskDto,
  UserDto,
  UsersApiService,
  WorkflowAuditEntryDto,
  WorkflowInstanceDto,
  WorkflowInstanceStepDto,
  WorkflowInstancesApiService,
  WorkflowStepDto,
  WorkflowTasksApiService,
  WorkflowTemplatesApiService,
} from '@sankore/crm-api';
import { entityTypeLabel, instanceStatusMeta, stepStatusMeta } from '../workflow-shared';

function taskStatusMeta(status: number | undefined): {
  label: string;
  severity: Severity;
} {
  switch (status) {
    case 0:
      return { label: 'En attente', severity: 'warning' };
    case 1:
      return { label: 'En cours', severity: 'info' };
    case 2:
      return { label: 'Terminé', severity: 'success' };
    case 3:
      return { label: 'Annulé', severity: 'neutral' };
    default:
      return { label: '—', severity: 'neutral' };
  }
}

function taskPriorityLabel(priority: number | undefined): string {
  switch (priority) {
    case 0: return 'Basse';
    case 1: return 'Normale';
    case 2: return 'Haute';
    case 3: return 'Urgente';
    default: return '—';
  }
}

@Component({
  selector: 'workflow-instance-detail',
  templateUrl: './instance-detail.html',
  imports: [NgClass, TasCard, Button, TasTag, TasSpinner, TasIcon, TimeagoPipe],
})
export class WorkflowInstanceDetailPage implements OnInit {
  private readonly _api = inject(WorkflowInstancesApiService);
  private readonly _templateApi = inject(WorkflowTemplatesApiService);
  private readonly _tasksApi = inject(WorkflowTasksApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _router = inject(Router);

  public readonly id = input.required<string>();         // templateId from parent route
  public readonly instanceId = input.required<string>();

  public readonly entityTypeLabel = entityTypeLabel;
  public readonly instanceStatusMeta = instanceStatusMeta;
  public readonly stepStatusMeta = stepStatusMeta;
  public readonly taskStatusMeta = taskStatusMeta;
  public readonly taskPriorityLabel = taskPriorityLabel;

  public isLoading = signal(true);
  public isActing = signal(false);
  public instance = signal<WorkflowInstanceDto | null>(null);
  public audit = signal<WorkflowAuditEntryDto[]>([]);
  public templateSteps = signal<WorkflowStepDto[]>([]);
  public tasks = signal<TaskDto[]>([]);
  public completingTaskId = signal<string | null>(null);
  public cancellingTaskId = signal<string | null>(null);
  public taskComment = signal<string>('');

  // ── Approve / Reject ──────────────────────────────────────────────────────
  public showApproveForm = signal(false);
  public showRejectForm = signal(false);
  public approveComment = signal('');
  public rejectComment = signal('');

  // ── Assign / Delegate ─────────────────────────────────────────────────────
  public showAssignForm = signal(false);
  public showDelegateForm = signal(false);
  public users = signal<UserDto[]>([]);
  public isLoadingUsers = signal(false);
  public assignUserId = signal('');
  public delegateUserId = signal('');
  public delegateComment = signal('');

  ngOnInit(): void {
    this._load();
  }

  public stepName(stateId: string | null | undefined): string {
    return this.instance()?.steps?.find((s) => s.id === stateId)?.name ?? stateId ?? '—';
  }

  public currentStep(): WorkflowInstanceStepDto | null {
    const inst = this.instance();
    if (!inst?.steps) return null;
    return inst.steps.find((s) => s.status === 'Pending') ?? null;
  }

  public userLabel(userId: string | null | undefined): string {
    if (!userId) return '—';
    const u = this.users().find((u) => u.id === userId);
    return u?.fullName ?? u?.email ?? userId;
  }

  // ── Approve ───────────────────────────────────────────────────────────────

  public approve(): void {
    this.isActing.set(true);
    this._api
      .approveWorkflowStep(this.instanceId(), { comment: this.approveComment() || null })
      .subscribe({
        next: () => {
          this._snackbar.success('Succès', 'Étape approuvée.');
          this.showApproveForm.set(false);
          this.approveComment.set('');
          this.isActing.set(false);
          this._load();
        },
        error: () => {
          this._snackbar.error('Erreur', "Impossible d'approuver.");
          this.isActing.set(false);
        },
      });
  }

  // ── Reject ────────────────────────────────────────────────────────────────

  public reject(): void {
    this.isActing.set(true);
    this._api
      .rejectWorkflowStep(this.instanceId(), { comment: this.rejectComment() || null })
      .subscribe({
        next: () => {
          this._snackbar.success('Succès', 'Étape rejetée.');
          this.showRejectForm.set(false);
          this.rejectComment.set('');
          this.isActing.set(false);
          this._load();
        },
        error: () => {
          this._snackbar.error('Erreur', "Impossible de rejeter.");
          this.isActing.set(false);
        },
      });
  }

  // ── Assign ────────────────────────────────────────────────────────────────

  public openAssignForm(): void {
    this.showRejectForm.set(false);
    this.showApproveForm.set(false);
    this.showDelegateForm.set(false);
    this.assignUserId.set('');
    this.showAssignForm.set(true);
    this._ensureUsers();
  }

  public assign(): void {
    const step = this.currentStep();
    if (!step?.id || !this.assignUserId()) return;
    this.isActing.set(true);
    this._api
      .assignStep(this.instanceId(), step.id, { assignedToUserId: this.assignUserId() })
      .subscribe({
        next: () => {
          this._snackbar.success('Succès', 'Étape assignée.');
          this.showAssignForm.set(false);
          this.assignUserId.set('');
          this.isActing.set(false);
          this._load();
        },
        error: () => {
          this._snackbar.error('Erreur', "Impossible d'assigner l'étape.");
          this.isActing.set(false);
        },
      });
  }

  // ── Delegate ──────────────────────────────────────────────────────────────

  public openDelegateForm(): void {
    this.showRejectForm.set(false);
    this.showApproveForm.set(false);
    this.showAssignForm.set(false);
    this.delegateUserId.set('');
    this.delegateComment.set('');
    this.showDelegateForm.set(true);
    this._ensureUsers();
  }

  public delegate(): void {
    const step = this.currentStep();
    if (!step?.id || !this.delegateUserId()) return;
    this.isActing.set(true);
    this._api
      .delegateStep(this.instanceId(), step.id, {
        toUserId: this.delegateUserId(),
        comment: this.delegateComment() || null,
      })
      .subscribe({
        next: () => {
          this._snackbar.success('Succès', 'Étape déléguée.');
          this.showDelegateForm.set(false);
          this.delegateUserId.set('');
          this.delegateComment.set('');
          this.isActing.set(false);
          this._load();
        },
        error: () => {
          this._snackbar.error('Erreur', "Impossible de déléguer l'étape.");
          this.isActing.set(false);
        },
      });
  }

  // ── Cancel instance ───────────────────────────────────────────────────────

  public cancelInstance(): void {
    const inst = this.instance();
    if (!inst?.id) return;
    this._confirm.confirm({
      title: "Annuler l'instance",
      message: `Le suivi en cours sera annulé définitivement. Continuer ?`,
      closable: true,
      acceptButtonProps: { label: "Annuler l'instance", theme: 'warn' },
      rejectButtonProps: { label: 'Retour' },
      accept: () => {
        this.isActing.set(true);
        this._api.cancelWorkflowInstance(inst.id!).subscribe({
          next: () => {
            this._snackbar.success('Succès', 'Instance annulée.');
            this.isActing.set(false);
            this._load();
          },
          error: () => {
            this._snackbar.error('Erreur', "Impossible d'annuler l'instance.");
            this.isActing.set(false);
          },
        });
      },
    });
  }

  // ── Workflow Tasks ────────────────────────────────────────────────────────

  public completeTask(task: TaskDto): void {
    if (!task.id) return;
    this.completingTaskId.set(task.id);
    this._tasksApi
      .completeWorkflowTask(this.instanceId(), task.id, { comment: this.taskComment() || null })
      .subscribe({
        next: () => {
          this._snackbar.success('Succès', 'Tâche complétée.');
          this.completingTaskId.set(null);
          this.taskComment.set('');
          this._load();
        },
        error: () => {
          this._snackbar.error('Erreur', 'Impossible de compléter la tâche.');
          this.completingTaskId.set(null);
        },
      });
  }

  public cancelTask(task: TaskDto): void {
    if (!task.id) return;
    this._confirm.confirm({
      title: 'Annuler la tâche',
      message: `La tâche "${task.title ?? 'cette tâche'}" sera annulée. Continuer ?`,
      closable: true,
      acceptButtonProps: { label: 'Annuler la tâche', theme: 'warn' },
      rejectButtonProps: { label: 'Retour' },
      accept: () => {
        this.cancellingTaskId.set(task.id!);
        this._tasksApi.cancelWorkflowTask(this.instanceId(), task.id!).subscribe({
          next: () => {
            this._snackbar.success('Succès', 'Tâche annulée.');
            this.cancellingTaskId.set(null);
            this._load();
          },
          error: () => {
            this._snackbar.error('Erreur', "Impossible d'annuler la tâche.");
            this.cancellingTaskId.set(null);
          },
        });
      },
    });
  }

  public goBack(): void {
    this._router.navigate(['/settings/workflows', this.id(), 'instances']);
  }

  // ── SLA helpers ───────────────────────────────────────────────────────────

  /** Computes the deadline for an instance step using its createdAt + template timeoutHours. */
  public stepDueAt(step: WorkflowInstanceStepDto): Date | null {
    if (!step.createdAt) return null;
    const timeout = this.templateSteps().find((s) => s.order === step.order)?.timeoutHours;
    if (!timeout) return null;
    const d = new Date(step.createdAt);
    d.setHours(d.getHours() + timeout);
    return d;
  }

  public stepIsOverdue(step: WorkflowInstanceStepDto): boolean {
    const due = this.stepDueAt(step);
    return !!due && due < new Date();
  }

  public stepDueAtIso(step: WorkflowInstanceStepDto): string | null {
    return this.stepDueAt(step)?.toISOString() ?? null;
  }

  public isTaskOverdue(dueAt: string | null | undefined): boolean {
    return !!dueAt && new Date(dueAt) < new Date();
  }

  private _load(): void {
    this.isLoading.set(true);
    forkJoin({
      instance: this._api.getWorkflowInstance(this.instanceId()),
      audit: this._api.getWorkflowInstanceAudit(this.instanceId()),
      template: this._templateApi.getWorkflowTemplate(this.id()),
      tasks: this._tasksApi.listWorkflowTasks(this.instanceId()),
    }).subscribe({
      next: ({ instance, audit, template, tasks }) => {
        this.instance.set(instance);
        this.audit.set(audit ?? []);
        this.templateSteps.set(template.steps ?? []);
        this.tasks.set(tasks ?? []);
        this.isLoading.set(false);
      },
      error: () => {
        this._snackbar.error('Erreur', "Impossible de charger l'instance.");
        this.isLoading.set(false);
      },
    });
  }

  private _ensureUsers(): void {
    if (this.users().length > 0) return;
    this.isLoadingUsers.set(true);
    this._usersApi.listUsers(undefined, undefined, undefined, 1, 200).subscribe({
      next: (result) => {
        this.users.set(result.items ?? []);
        this.isLoadingUsers.set(false);
      },
      error: () => this.isLoadingUsers.set(false),
    });
  }
}

export default WorkflowInstanceDetailPage;
