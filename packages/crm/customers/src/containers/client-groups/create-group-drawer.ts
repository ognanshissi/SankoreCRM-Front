import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { TasTitle } from '@talisoft/ui/title';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  AgenciesApiService,
  ClientGroupsApiService,
  CreateGroupRequestTypeEnum,
} from '@sankore/crm-api';

import { GROUP_TYPE_OPTIONS } from './group-labels';

class CreateGroupFormModel {
  public name!: string;
  public type!: string;
  public agencyId!: string;
  public constitutionDate!: string;

  public static instantiate(): CreateGroupFormModel {
    const model = new CreateGroupFormModel();
    model.name = '';
    model.type = 'SolidarityGroup';
    model.agencyId = '';
    // Un groupe se constitue le jour où on le saisit dans la très grande
    // majorité des cas : la date du jour évite une saisie de plus.
    model.constitutionDate = new Date().toISOString().slice(0, 10);
    return model;
  }
}

@Component({
  selector: 'create-group-drawer',
  templateUrl: './create-group-drawer.html',
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
    TasSpinner,
    FormRoot,
    FormField,
  ],
})
export class CreateGroupDrawer {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _clientGroupsApiService = inject(ClientGroupsApiService);
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _snackbarService = inject(SnackbarService);

  public readonly typeOptions = GROUP_TYPE_OPTIONS;

  public isLoadingAgencies = signal(true);
  public agencyOptions = signal<{ label: string; value: string }[]>([]);

  public model = signal(CreateGroupFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.name, { message: 'Le nom du groupe est obligatoire' });
    required(schema.type, { message: 'Le type de groupe est obligatoire' });
    required(schema.agencyId, { message: "L'agence de rattachement est obligatoire" });
    required(schema.constitutionDate, {
      message: 'La date de constitution est obligatoire',
    });
  });

  constructor() {
    this._agenciesApiService
      .listAgencies(false, 1, 200)
      .pipe(
        catchError(() => {
          this._snackbarService.error('Erreur', 'Impossible de charger les agences.');
          this.isLoadingAgencies.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.agencyOptions.set(
          (result.items ?? []).map((agency) => ({
            label: agency.name ?? agency.code ?? '',
            value: agency.id ?? '',
          })),
        );
        this.isLoadingAgencies.set(false);
      });
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();

      const result = await firstValueFrom(
        this._clientGroupsApiService
          .createClientGroup({
            name: value.name,
            // Le contrat attend le nom du type, pas son index.
            type: value.type as CreateGroupRequestTypeEnum,
            agencyId: value.agencyId,
            constitutionDate: value.constitutionDate,
          })
          .pipe(
            catchError((err: HttpErrorResponse) => {
              // Le serveur distingue GROUP_NAME_ALREADY_USED (409) et
              // AGENCY_OUT_OF_SCOPE (403) : remonter son message fait gagner
              // l'aller-retour qu'un texte générique coûterait.
              this._snackbarService.error(
                'Erreur',
                err.error?.detail ??
                  err.error?.title ??
                  'Impossible de créer le groupe.',
              );
              return EMPTY;
            }),
          ),
      );

      if (result?.groupId) {
        this._snackbarService.success(
          'Groupe créé',
          'Ajoutez ses membres et pourvoyez le bureau pour l’activer.',
        );
        this._dialogRef.close(result.groupId);
      }
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}
