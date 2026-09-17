import { Component, inject, input, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasTag } from '@talisoft/ui/tag';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import {
  UserDto,
  UsersApiService,
  WorkflowAuditEntryDto,
  WorkflowInstanceDto,
  WorkflowInstanceStepDto,
  WorkflowInstancesApiService,
} from '@sankore/crm-api';
import { entityTypeLabel, instanceStatusMeta, stepStatusMeta } from '../workflow-shared';

@Component({
  selector: 'workflow-instance-detail',
  templateUrl: './instance-detail.html',
  imports: [TasCard, Button, TasTag, TasSpinner, TasIcon, RouterLink, TimeagoPipe],
})
export class WorkflowInstanceDetailPage implements OnInit {
  private readonly _api = inject(WorkflowInstancesApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _router = inject(Router);

  public readonly id = input.required<string>();         // templateId from parent route
  public readonly instanceId = input.required<string>();

  public readonly entityTypeLabel = entityTypeLabel;
  public readonly instanceStatusMeta = instanceStatusMeta;
  public readonly stepStatusMeta = stepStatusMeta;

  public isLoading = signal(true);
  public isActing = signal(false);
  public instance = signal<WorkflowInstanceDto | null>(null);
  public audit = signal<WorkflowAuditEntryDto[]>([]);

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

  public goBack(): void {
    this._router.navigate(['/settings/workflows', this.id(), 'instances']);
  }

  private _load(): void {
    this.isLoading.set(true);
    forkJoin({
      instance: this._api.getWorkflowInstance(this.instanceId()),
      audit: this._api.getWorkflowInstanceAudit(this.instanceId()),
    }).subscribe({
      next: ({ instance, audit }) => {
        this.instance.set(instance);
        this.audit.set(audit ?? []);
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
