import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, maxLength, pattern, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { TasTitle } from '@talisoft/ui/title';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TaskTypeDto, TaskTypesApiService } from '@sankore/crm-api';

class EditTaskTypeFormModel {
  public label!: string;
  public description!: string;
  public displayOrder!: string;

  public static fromTaskType(t: TaskTypeDto): EditTaskTypeFormModel {
    const m = new EditTaskTypeFormModel();
    m.label = t.label ?? '';
    m.description = t.description ?? '';
    m.displayOrder = String(t.displayOrder ?? 0);
    return m;
  }
}

@Component({
  selector: 'edit-task-type-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle, Button,
    TasFormField, TasLabel, TasError, TasHint, TasInput, FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <TasTitle class="text-lg">Modifier le type de tâche</TasTitle>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <tas-form-field>
            <tas-label>Code</tas-label>
            <input tasInput type="text" [value]="data.code" disabled />
            <tas-hint>
              @if (data.isSystem) {
                Type système : les tâches automatiques l'utilisent, il ne peut pas être désactivé.
              } @else {
                Le code ne change pas : les tâches existantes le portent.
              }
            </tas-hint>
          </tas-form-field>

          <tas-form-field>
            <tas-label>Libellé <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" [formField]="formSchema.label" />
            @if (formSchema.label().touched() && formSchema.label().invalid()) {
              <tas-error>{{ formSchema.label().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Description</tas-label>
            <input tasInput type="text" placeholder="Description optionnelle" [formField]="formSchema.description" />
            @if (formSchema.description().touched() && formSchema.description().invalid()) {
              <tas-error>{{ formSchema.description().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Ordre d'affichage</tas-label>
            <input tasInput type="text" inputmode="numeric" [formField]="formSchema.displayOrder" />
            @if (formSchema.displayOrder().touched() && formSchema.displayOrder().invalid()) {
              <tas-error>{{ formSchema.displayOrder().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>Les types sont proposés du plus petit au plus grand.</tas-hint>
            }
          </tas-form-field>
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-2">
          <button tas-outlined-button type="button" (click)="close()">Annuler</button>
          <button tas-raised-button color="primary" type="button" (click)="handleSubmit()"
                  [disabled]="formSchema().invalid() || formSchema().submitting()"
                  [isLoading]="formSchema().submitting()">Enregistrer</button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class EditTaskTypeDrawer {
  public readonly data: TaskTypeDto = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(TaskTypesApiService);
  private readonly _snackbar = inject(SnackbarService);

  public model = signal(EditTaskTypeFormModel.fromTaskType(this.data));
  public formSchema = form(this.model, (schema) => {
    required(schema.label, { message: 'Le libellé est obligatoire' });
    maxLength(schema.label, 100, { message: '100 caractères au plus' });
    maxLength(schema.description, 500, { message: '500 caractères au plus' });
    pattern(schema.displayOrder, /^\d{1,6}$/, { message: 'Un nombre entier positif' });
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;
      const saved = await firstValueFrom(
        this._api.updateTaskType(this.data.id!, {
          label: value.label.trim(),
          description: value.description.trim() || null,
          displayOrder: Number(value.displayOrder),
        }).pipe(
          map(() => true),
          catchError(() => {
            this._snackbar.error('Erreur', 'Impossible d’enregistrer le type.');
            return EMPTY;
          }),
        ),
        { defaultValue: false },
      );
      if (saved) this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
