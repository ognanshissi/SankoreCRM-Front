import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { TasTitle } from '@talisoft/ui/title';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasError, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { AgenciesApiService, AgencyDto, AgencyType } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';

export class CreateAgencyFormModel {
  public name!: string;
  public description!: string;
  public agencyType!: AgencyType;
  public parentAgencyId!: string;
  public addressStreet!: string;
  public addressCity!: string;
  public addressZipCode!: string;
  public addressCountry!: string;

  public static instantiate(): CreateAgencyFormModel {
    const model = new CreateAgencyFormModel();
    model.name = '';
    model.description = '';
    model.agencyType = AgencyType.NUMBER_3;
    model.parentAgencyId = '';
    model.addressStreet = '';
    model.addressCity = '';
    model.addressZipCode = '';
    model.addressCountry = '';
    return model;
  }
}

export const AGENCY_TYPE_OPTIONS = [
  { label: 'HeadQuarter', value: AgencyType.NUMBER_0 },
  { label: 'Région', value: AgencyType.NUMBER_1 },
  { label: 'Zone', value: AgencyType.NUMBER_2 },
  { label: 'Agence', value: AgencyType.NUMBER_3 },
];

@Component({
  selector: 'create-agency',
  templateUrl: './create-agency.html',
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
    TasInput,
    TasSelect,
    FormRoot,
    FormField,
  ],
})
export class CreateAgencyComponent {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _snackbarService = inject(SnackbarService);

  public readonly agencyTypeOptions = AGENCY_TYPE_OPTIONS;
  public parentAgencies = signal<{ name: string | null | undefined, id: string | undefined | null }[]>([]);
  public parentAgencyOptions = computed(() =>
    this.parentAgencies().map((a) => ({
      label: a.name ?? '',
      value: a.id ?? '',
    })),
  );

  public model = signal(CreateAgencyFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.name, { message: "Le nom de l'agence est obligatoire" });
    validate(schema.parentAgencyId, (ctx) => {
      const type = ctx.valueOf(schema.agencyType);
      if (type !== AgencyType.NUMBER_0 && !ctx.value()) {
        return {
          kind: 'required',
          message: "L'agence parente est obligatoire",
        };
      }
      return null;
    });
  });

  public isHQ = computed(() => {
    console.log(this.formSchema.agencyType().value() === AgencyType.NUMBER_0);
    return this.formSchema.agencyType().value() === AgencyType.NUMBER_0;
  });

  constructor() {
    this._loadParentAgencies();

    // effect(() => {
    //   if (this.isHQ()) {
    //     this.model.update((m) => ({ ...m, parentAgencyId: '' }));
    //   }
    // });
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const result = await firstValueFrom(
        this._agenciesApiService
          .createAgency({
            name: value.name,
            description: value.description || null,
            agencyType: value.agencyType,
            parentAgencyId: this.isHQ() ? null : value.parentAgencyId,
            addressStreet: value.addressStreet || null,
            addressCity: value.addressCity || null,
            addressZipCode: value.addressZipCode || null,
            addressCountry: value.addressCountry || null,
          })
          .pipe(
            catchError(() => {
              this._snackbarService.error(
                'Erreur',
                "Impossible de créer l'agence, réessayez plus tard.",
              );
              return EMPTY;
            }),
          ),
      );

      if (result) {
        this._snackbarService.success('Succès', 'Agence créée avec succès');
        this._dialogRef.close(result);
      }
    });
  }

  public close(): void {
    this._dialogRef.close();
  }

  private _loadParentAgencies(): void {
    this._agenciesApiService.getParentAgencies('id,name').pipe(
      map((agencies: Array<AgencyDto>) => agencies.map(agency => ({ id: agency.id ?? "", name: agency.name ?? "" })),)
    ).subscribe({
      next: (result) => this.parentAgencies.set(result),
    });
  }
}
