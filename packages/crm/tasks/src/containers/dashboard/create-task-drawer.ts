import { Component, inject, signal, OnInit } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY, of } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import {
  TasSideDrawer,
  TasDrawerTitle,
  TasDrawerContent,
  TasDrawerAction,
} from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TasksApiService,
  UsersApiService,
  CreateTaskRequestTypeEnum,
  CreateTaskRequestPriorityEnum,
} from '@sankore/crm-api';
import { AuthenticationService } from '@sankore/crm/common';

export interface CreateTaskDrawerData {
  leadId?: string | null;
  currentOwnerId?: string | null;
}

const TYPE_OPTIONS = [
  { label: 'Premier contact',  value: CreateTaskRequestTypeEnum.FirstContact },
  { label: 'Qualification',    value: CreateTaskRequestTypeEnum.Qualification },
  { label: 'Suivi SLA',        value: CreateTaskRequestTypeEnum.SlaFollowUp },
  { label: 'Revue score',      value: CreateTaskRequestTypeEnum.ScoreReview },
  { label: 'Passation',        value: CreateTaskRequestTypeEnum.OwnerHandover },
  { label: 'Dispatch manuel',  value: CreateTaskRequestTypeEnum.ManualDispatch },
  { label: 'Générique',        value: CreateTaskRequestTypeEnum.Generic },
];

const PRIORITY_OPTIONS = [
  { label: 'Basse',    value: CreateTaskRequestPriorityEnum.Low },
  { label: 'Moyenne',  value: CreateTaskRequestPriorityEnum.Medium },
  { label: 'Haute',    value: CreateTaskRequestPriorityEnum.High },
  { label: 'Critique', value: CreateTaskRequestPriorityEnum.Critical },
];

@Component({
  selector: 'create-task-drawer',
  imports: [
    FormsModule,
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
    TasIcon, TasSpinner, Button,
    TasFormField, TasLabel, TasError, TasInput, TasSelect, TasTitle,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Nouvelle tâche</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-3">
          <tas-form-field>
            <tas-label>Titre <span class="text-red-500">*</span></tas-label>
            <input tasInput type="text" placeholder="Ex : Rappeler le prospect"
              [ngModel]="title()" (ngModelChange)="title.set($event)" />
            @if (submitted() && !title().trim()) {
              <tas-error>Le titre est obligatoire.</tas-error>
            }
          </tas-form-field>

          <div class="grid grid-cols-2 gap-3">
            <tas-form-field>
              <tas-label>Type <span class="text-red-500">*</span></tas-label>
              <tas-select [options]="typeOptions" optionLabel="label" optionValue="value"
                placeholder="Sélectionnez" [ngModel]="type()" (ngModelChange)="type.set($event)"></tas-select>
              @if (submitted() && !type()) {
                <tas-error>Le type est obligatoire.</tas-error>
              }
            </tas-form-field>
            <tas-form-field>
              <tas-label>Priorité</tas-label>
              <tas-select [options]="priorityOptions" optionLabel="label" optionValue="value"
                placeholder="Moyenne" [ngModel]="priority()" (ngModelChange)="priority.set($event)"></tas-select>
            </tas-form-field>
          </div>

          <!-- Agent selector -->
          <tas-form-field>
            <tas-label>Assigner à</tas-label>
            @if (isLoadingAgents()) {
              <div class="flex items-center gap-2 py-2">
                <tas-spinner size="3" class="text-primary"></tas-spinner>
                <span class="text-xs text-slate-400">Chargement des agents…</span>
              </div>
            } @else {
              <tas-select
                [options]="agentOptions()"
                optionLabel="label"
                optionValue="value"
                placeholder="Moi-même"
                [ngModel]="assignedAgentId()"
                (ngModelChange)="assignedAgentId.set($event)"
              ></tas-select>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Échéance <span class="text-red-500">*</span></tas-label>
            <input tasInput type="datetime-local" [ngModel]="dueAt()" (ngModelChange)="dueAt.set($event)" />
            @if (submitted() && !dueAt()) {
              <tas-error>L'échéance est obligatoire.</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Description</tas-label>
            <textarea tasInput rows="3" placeholder="Détails de la tâche…"
              [ngModel]="description()" (ngModelChange)="description.set($event)"></textarea>
          </tas-form-field>
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="space-x-4">
          <button tas-outlined-button type="button" (click)="close()">Annuler</button>
          <button tas-raised-button color="primary" type="button"
            [disabled]="isSubmitting()" (click)="submit()">
            @if (isSubmitting()) { <tas-spinner size="3" class="text-white"></tas-spinner> }
            Créer la tâche
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class CreateTaskDrawer implements OnInit {
  public readonly data: CreateTaskDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _tasksApi = inject(TasksApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly typeOptions = TYPE_OPTIONS;
  public readonly priorityOptions = PRIORITY_OPTIONS;

  public title = signal('');
  public type = signal('');
  public priority = signal(CreateTaskRequestPriorityEnum.Medium);
  public dueAt = signal('');
  public description = signal('');
  public assignedAgentId = signal('');
  public isSubmitting = signal(false);
  public submitted = signal(false);

  // Agent list
  public isLoadingAgents = signal(true);
  public agentOptions = signal<{ label: string; value: string }[]>([]);

  ngOnInit(): void {
    // Pre-select lead's current owner if provided
    if (this.data.currentOwnerId) {
      this.assignedAgentId.set(this.data.currentOwnerId);
    }
    this._loadAgents();
  }

  public submit(): void {
    this.submitted.set(true);
    if (!this.title().trim() || !this.type() || !this.dueAt()) return;

    this.isSubmitting.set(true);
    const selectedAgent = this.assignedAgentId() || this._auth.connectedUser()?.id || null;

    this._tasksApi.createCrmTask({
      type: this.type() as CreateTaskRequestTypeEnum,
      priority: this.priority() as CreateTaskRequestPriorityEnum,
      title: this.title().trim(),
      dueAt: new Date(this.dueAt()).toISOString(),
      leadId: this.data.leadId ?? null,
      assignedAgentId: selectedAgent,
      description: this.description().trim() || null,
    }).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de créer la tâche.');
        this.isSubmitting.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      const agentLabel = this.agentOptions().find((a) => a.value === selectedAgent)?.label ?? 'vous-même';
      this._snackbar.success('Tâche créée', `Assignée à ${agentLabel}.`);
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private _loadAgents(): void {
    this.isLoadingAgents.set(true);
    const currentUserId = this._auth.connectedUser()?.id;
    const currentUserName = this._auth.connectedUser()?.fullName ?? this._auth.connectedUser()?.email ?? 'Moi-même';

    this._usersApi.listUsers(0, undefined, undefined, 1, 200).pipe(
      catchError(() => of({ items: [] })),
    ).subscribe((result: any) => {
      const users = result?.items ?? [];
      const options: { label: string; value: string }[] = [];

      // Self first
      if (currentUserId) {
        options.push({ label: `${currentUserName} (moi)`, value: currentUserId });
      }

      // Other agents
      for (const u of users) {
        if (u.id === currentUserId) continue;
        const name = u.fullName ?? u.email ?? u.id;
        const suffix = u.agencyName ? ` — ${u.agencyName}` : '';
        options.push({ label: `${name}${suffix}`, value: u.id });
      }

      this.agentOptions.set(options);
      this.isLoadingAgents.set(false);
    });
  }
}
