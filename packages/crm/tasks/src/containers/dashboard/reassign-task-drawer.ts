import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, firstValueFrom, map, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTitle } from '@talisoft/ui/title';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { CrmTaskDto, TasksApiService, UserDto, UsersApiService } from '@sankore/crm-api';
import { AuthenticationService } from '@sankore/crm/common';

export interface ReassignTaskDrawerData {
  task: CrmTaskDto;
}

class ReassignTaskFormModel {
  public agentId!: string;
  public reason!: string;

  public static instantiate(): ReassignTaskFormModel {
    const m = new ReassignTaskFormModel();
    m.agentId = '';
    m.reason = '';
    return m;
  }
}

@Component({
  selector: 'reassign-task-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasSpinner,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasInput,
    TasSelect,
    FormRoot,
    FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Réassigner la tâche</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (isLoadingUsers()) {
          <div class="flex justify-center py-10"><tas-spinner size="8" class="text-primary"></tas-spinner></div>
        } @else {
          <form [formRoot]="formSchema" class="flex flex-col gap-5">
            <tas-form-field>
              <tas-label>Nouvel agent <span class="text-functional-error">*</span></tas-label>
              <tas-select
                [options]="agentOptions()"
                placeholder="Choisissez un agent"
                [formField]="formSchema.agentId"
              ></tas-select>
              @if (formSchema.agentId().touched() && formSchema.agentId().invalid()) {
                <tas-error>{{ formSchema.agentId().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            <tas-form-field>
              <tas-label>Motif</tas-label>
              <textarea tasInput rows="3" placeholder="Pourquoi cette tâche change de main ?" [formField]="formSchema.reason"></textarea>
            </tas-form-field>
          </form>
        }
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center gap-3 w-full">
          <button tas-outlined-button type="button" (click)="close()">Annuler</button>
          <button
            tas-raised-button
            color="primary"
            type="button"
            (click)="handleSubmit()"
            [disabled]="formSchema().invalid() || formSchema().submitting()"
            [isLoading]="formSchema().submitting()"
          >
            Réassigner
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ReassignTaskDrawer {
  public readonly data = inject<ReassignTaskDrawerData>(DIALOG_DATA);
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _tasksApi = inject(TasksApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _snackbar = inject(SnackbarService);

  public isLoadingUsers = signal(true);
  public agentOptions = signal<{ label: string; value: string }[]>([]);

  public model = signal(ReassignTaskFormModel.instantiate());
  public formSchema = form(this.model, (schema) => {
    required(schema.agentId, { message: "Choisissez l'agent qui reprend la tâche" });
  });

  constructor() {
    this._usersApi
      .listUsers('Active', undefined, undefined, 1, 200)
      .pipe(catchError(() => of({ items: [] as UserDto[] })))
      .subscribe((result) => {
        // Le serveur refuse une réassignation vers l'agent déjà titulaire : inutile de le proposer.
        this.agentOptions.set(
          (result.items ?? [])
            .filter((u) => !!u.id && u.id !== this.data.task.assignedAgentId)
            .map((u) => ({ label: u.fullName || u.email || (u.id as string), value: u.id as string })),
        );
        this.isLoadingUsers.set(false);
      });
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value || !this.data.task.id) return;

      const ok = await firstValueFrom(
        this._tasksApi
          .reassignCrmTask(this.data.task.id, {
            newAgentId: value.agentId,
            reason: value.reason.trim() || null,
            actorId: this._auth.connectedUser()?.id ?? null,
          })
          .pipe(
            map(() => true),
            catchError((err: HttpErrorResponse) => {
              this._snackbar.error('Erreur', err.error?.title ?? 'Impossible de réassigner la tâche.');
              return of(false);
            }),
          ),
      );

      if (ok) {
        this._snackbar.success('Tâche réassignée', 'La tâche a été confiée à un autre agent.');
        this._dialogRef.close(true);
      }
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
