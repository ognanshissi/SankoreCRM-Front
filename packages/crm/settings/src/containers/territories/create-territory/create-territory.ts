import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasMultiSelect } from '@talisoft/ui/multi-select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TerritoriesApiService, ProductsApiService } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';

class CreateTerritoryFormModel {
  public name!: string;
  public code!: string;
  public description!: string;
  public latitude!: string;
  public longitude!: string;
  public rayonKm!: string;

  public static instantiate(): CreateTerritoryFormModel {
    const m = new CreateTerritoryFormModel();
    m.name = '';
    m.code = '';
    m.description = '';
    m.latitude = '';
    m.longitude = '';
    m.rayonKm = '';
    return m;
  }
}

@Component({
  selector: 'create-territory',
  templateUrl: './create-territory.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
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
    TasMultiSelect,
    TasSpinner,
    FormRoot,
    FormField,
  ],
})
export class CreateTerritoryComponent {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _territoriesApiService = inject(TerritoriesApiService);
  private readonly _productsApiService = inject(ProductsApiService);
  private readonly _snackbarService = inject(SnackbarService);

  public isLoadingOptions = signal(true);
  public specialtyOptions = signal<{ label: string; value: string }[]>([]);
  public selectedSpecialities = signal<string[]>([]);

  public model = signal(CreateTerritoryFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.name, { message: 'Le nom du territoire est obligatoire' });
    required(schema.code, { message: 'Le code du territoire est obligatoire' });
  });

  constructor() {
    this._productsApiService.listProducts().subscribe({
      next: (products) => {
        this.specialtyOptions.set(
          (products ?? []).map((p) => ({ label: p.name ?? p.code ?? '', value: p.code ?? '' }))
        );
        this.isLoadingOptions.set(false);
      },
      error: () => this.isLoadingOptions.set(false),
    });
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const result = await firstValueFrom(
        this._territoriesApiService
          .createTerritory({
            name: value.name,
            code: value.code,
            description: value.description || null,
            latitude: value.latitude ? parseFloat(value.latitude) : null,
            longitude: value.longitude ? parseFloat(value.longitude) : null,
            rayonKm: value.rayonKm ? parseFloat(value.rayonKm) : undefined,
            productSpecialities: this.selectedSpecialities().length
              ? this.selectedSpecialities()
              : null,
          })
          .pipe(
            catchError(() => {
              this._snackbarService.error('Erreur', 'Impossible de créer le territoire.');
              return EMPTY;
            }),
          ),
      );

      this._snackbarService.success('Succès', 'Territoire créé avec succès.');
      this._dialogRef.close(result ?? true);
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}
