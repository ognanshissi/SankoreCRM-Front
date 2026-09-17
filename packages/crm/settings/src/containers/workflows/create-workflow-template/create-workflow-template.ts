import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { TasTitle } from '@talisoft/ui/title';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasError, TasLabel, TasHint } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasIcon } from '@talisoft/ui/icon';
import { WorkflowTemplatesApiService } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ENTITY_TYPE_OPTIONS } from '../workflow-shared';

class CreateWorkflowTemplateFormModel {
  public name!: string;
  public description!: string;
  public entityType!: string;

  public static instantiate(): CreateWorkflowTemplateFormModel {
    const model = new CreateWorkflowTemplateFormModel();
    model.name = '';
    model.description = '';
    model.entityType = ENTITY_TYPE_OPTIONS[0].value;
    return model;
  }
}

@Component({
  selector: 'create-workflow-template',
  templateUrl: './create-workflow-template.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    TasIcon,
    FormRoot,
    FormField,
  ],
})
export class CreateWorkflowTemplateComponent {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _workflowTemplatesApiService = inject(WorkflowTemplatesApiService);
  private readonly _snackbarService = inject(SnackbarService);

  public readonly entityTypeOptions = ENTITY_TYPE_OPTIONS;

  public model = signal(CreateWorkflowTemplateFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.name, { message: 'Le nom du modèle est obligatoire' });
    required(schema.entityType, { message: "L'entité déclencheur est obligatoire" });
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const result = await firstValueFrom(
        this._workflowTemplatesApiService
          .createWorkflowTemplate({
            name: value.name,
            description: value.description || null,
            entityType: value.entityType,
          })
          .pipe(
            catchError(() => {
              this._snackbarService.error(
                'Erreur',
                'Impossible de créer le modèle, réessayez plus tard.',
              );
              return EMPTY;
            }),
          ),
      );

      if (result) {
        this._snackbarService.success('Succès', 'Modèle de workflow créé avec succès');
        this._dialogRef.close(result);
      }
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}
