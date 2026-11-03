import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, maxLength, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map, of } from 'rxjs';
import { AttentionItemDto, UserDto, UsersApiService, WorkflowInstancesApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';

function serverMessage(err: HttpErrorResponse, fallback: string): string {
  return err.error?.error || err.error?.detail || err.error?.title || fallback;
}

class ReassignFormModel {
  public userId!: string;
  public reason!: string;

  public static instantiate(): ReassignFormModel {
    const m = new ReassignFormModel();
    m.userId = '';
    m.reason = '';
    return m;
  }
}

/**
 * « Réaffecter » depuis « Santé des workflows » : l'étape ouverte passe à une personne nommée, qui en
 * est prévenue. Les titulaires du rôle de l'étape sont proposés d'abord ; une autre personne peut
 * la décider quand même, l'étape lui étant confiée.
 */
@Component({
  selector: 'reassign-step-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
    TasFormField, TasLabel, TasError, TasHint, TasInput, TasSelect, Button, FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>Réaffecter l'étape</tas-drawer-title>
      <tas-drawer-content>
        <div class="mb-5 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
          <p class="font-medium text-slate-800">« {{ item.stepName }} »</p>
          <p class="mt-0.5 text-slate-500">{{ item.circuit }}@if (item.recordLabel) { · {{ item.recordLabel }} }</p>
          @if (item.assignedTo || item.approverRole) {
            <p class="mt-1 text-xs text-slate-500">Aujourd'hui : {{ item.assignedTo || item.approverRole }}</p>
          }
        </div>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <tas-form-field>
            <tas-label>Confier à <span class="text-functional-error">*</span></tas-label>
            <tas-select [options]="userOptions()" placeholder="Choisir une personne" [formField]="formSchema.userId"></tas-select>
            @if (formSchema.userId().touched() && formSchema.userId().invalid()) {
              <tas-error>{{ formSchema.userId().errors()[0].message }}</tas-error>
            } @else if (item.approverRole) {
              <tas-hint>Les « {{ item.approverRole }} » sont proposés d'abord ; la personne choisie pourra décider l'étape.</tas-hint>
            }
          </tas-form-field>
          <tas-form-field>
            <tas-label>Motif</tas-label>
            <input tasInput type="text" placeholder="Ex. : agent en congés" [formField]="formSchema.reason" />
            @if (formSchema.reason().invalid()) {
              <tas-error>{{ formSchema.reason().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>Facultatif — écrit dans l'historique et transmis à la personne.</tas-hint>
            }
          </tas-form-field>
        </form>
      </tas-drawer-content>
      <tas-drawer-action>
        <div class="flex justify-end gap-2">
          <button tas-outlined-button color="primary" type="button" (click)="dialogRef.close(false)">Annuler</button>
          <button tas-raised-button color="primary" type="button" (click)="handleSubmit()"
                  [disabled]="formSchema().invalid() || formSchema().submitting()"
                  [isLoading]="formSchema().submitting()">Réaffecter</button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ReassignStepDrawer implements OnInit {
  public readonly item = inject<AttentionItemDto>(DIALOG_DATA);
  protected readonly dialogRef = inject(DialogRef<boolean>);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _instancesApi = inject(WorkflowInstancesApiService);
  private readonly _snackbar = inject(SnackbarService);

  private readonly _users = signal<UserDto[]>([]);
  public readonly userOptions = computed(() => {
    const role = this.item.approverRoleCode?.toLowerCase();
    const holds = (u: UserDto) => !!role && (u.roles ?? []).some((r) => r.toLowerCase() === role);
    return this._users()
      .filter((u) => u.id && u.id !== this.item.assignedToUserId)
      .sort((a, b) => Number(holds(b)) - Number(holds(a)) || (a.fullName ?? '').localeCompare(b.fullName ?? ''))
      .map((u) => ({
        label: [u.fullName, u.agencyName, holds(u) ? this.item.approverRole : null].filter(Boolean).join(' · '),
        value: u.id!,
      }));
  });

  public model = signal(ReassignFormModel.instantiate());
  public formSchema = form(this.model, (schema) => {
    required(schema.userId, { message: 'Choisissez la personne' });
    maxLength(schema.reason, 500, { message: '500 caractères au plus' });
  });

  ngOnInit(): void {
    this._usersApi.listUsers('Active', undefined, undefined, 1, 500)
      .pipe(catchError(() => EMPTY))
      .subscribe((res) => this._users.set(res.items ?? []));
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const done = await firstValueFrom(
        this._instancesApi
          .assignStep(this.item.instanceId!, this.item.instanceStepId!, {
            assignedToUserId: value.userId,
            reason: value.reason.trim() || null,
          })
          .pipe(
            map(() => true),
            catchError((err: HttpErrorResponse) => {
              this._snackbar.error('Réaffectation impossible', serverMessage(err, "L'étape n'a pas pu être réaffectée."));
              return of(false);
            }),
          ),
      );
      if (done) this.dialogRef.close(true);
    });
  }
}

class CancelFormModel {
  public reason!: string;

  public static instantiate(): CancelFormModel {
    const m = new CancelFormModel();
    m.reason = '';
    return m;
  }
}

/**
 * « Annuler l'instance » : le circuit s'arrête et ne retient plus le dossier. Le motif est exigé —
 * il est la seule trace, dans l'historique, de pourquoi un circuit n'est pas allé au bout.
 */
@Component({
  selector: 'cancel-instance-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
    TasFormField, TasLabel, TasError, TasHint, TasInput, Button, FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>Annuler le circuit</tas-drawer-title>
      <tas-drawer-content>
        <div class="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900" role="note">
          <p class="font-medium">« {{ item.circuit }} »@if (item.recordLabel) { — {{ item.recordLabel }} }</p>
          <p class="mt-1">Le circuit s'arrête à l'étape « {{ item.stepName }} » : plus personne n'aura à la décider, et il ne retiendra plus le dossier. On ne peut pas le reprendre ensuite ; il faudra en démarrer un nouveau.</p>
        </div>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <tas-form-field>
            <tas-label>Motif <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" placeholder="Ex. : doublon, dossier abandonné par le client" [formField]="formSchema.reason" />
            @if (formSchema.reason().touched() && formSchema.reason().invalid()) {
              <tas-error>{{ formSchema.reason().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>Écrit dans l'historique du circuit.</tas-hint>
            }
          </tas-form-field>
        </form>
      </tas-drawer-content>
      <tas-drawer-action>
        <div class="flex justify-end gap-2">
          <button tas-outlined-button color="primary" type="button" (click)="dialogRef.close(false)">Retour</button>
          <button tas-raised-button color="warn" type="button" (click)="handleSubmit()"
                  [disabled]="formSchema().invalid() || formSchema().submitting()"
                  [isLoading]="formSchema().submitting()">Annuler le circuit</button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class CancelInstanceDrawer {
  public readonly item = inject<AttentionItemDto>(DIALOG_DATA);
  protected readonly dialogRef = inject(DialogRef<boolean>);
  private readonly _instancesApi = inject(WorkflowInstancesApiService);
  private readonly _snackbar = inject(SnackbarService);

  public model = signal(CancelFormModel.instantiate());
  public formSchema = form(this.model, (schema) => {
    required(schema.reason, { message: 'Le motif est obligatoire' });
    maxLength(schema.reason, 500, { message: '500 caractères au plus' });
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const reason = field().value().reason.trim();
      const done = await firstValueFrom(
        this._instancesApi.cancelWorkflowInstance(this.item.instanceId!, { reason }).pipe(
          map(() => true),
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Annulation impossible', serverMessage(err, "Le circuit n'a pas pu être annulé."));
            return of(false);
          }),
        ),
      );
      if (done) this.dialogRef.close(true);
    });
  }
}
