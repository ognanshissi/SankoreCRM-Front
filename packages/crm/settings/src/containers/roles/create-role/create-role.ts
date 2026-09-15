import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { signal } from '@angular/core';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { RolesApiService } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';

class CreateRoleFormModel {
  public name!: string;
  public label!: string;

  public static instantiate(): CreateRoleFormModel {
    const m = new CreateRoleFormModel();
    m.name = '';
    m.label = '';
    return m;
  }
}

@Component({
  selector: 'create-role',
  templateUrl: './create-role.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    Button,
    TasIcon,
    TasFormField,
    TasLabel,
    TasError,
    TasInput,
    FormRoot,
    FormField,
  ],
})
export class CreateRoleComponent {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _rolesApiService = inject(RolesApiService);
  private readonly _snackbarService = inject(SnackbarService);

  public model = signal(CreateRoleFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.name, { message: 'Le nom du rôle est obligatoire' });
    required(schema.label, { message: 'Le libellé du rôle est obligatoire' });
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const result = await firstValueFrom(
        this._rolesApiService
          .createRole({
            name: value.name,
            label: value.label,
          })
          .pipe(
            catchError(() => {
              this._snackbarService.error(
                'Erreur',
                'Impossible de créer le rôle, réessayez plus tard.',
              );
              return EMPTY;
            }),
          ),
      );

      this._snackbarService.success('Succès', 'Rôle créé avec succès');
      this._dialogRef.close(result ?? true);
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}
