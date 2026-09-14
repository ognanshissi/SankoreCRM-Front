import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, filter, firstValueFrom, forkJoin } from 'rxjs';
import { NgClass } from '@angular/common';
import { Dialog } from '@angular/cdk/dialog';
import { TasTitle } from '@talisoft/ui/title';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasMultiSelect } from '@talisoft/ui/multi-select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TerritoriesApiService, ProductsApiService, TerritoryDto } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { DeleteTerritoryDialog } from './delete-territory-dialog';

class EditTerritoryFormModel {
  public name!: string;
  public description!: string;
  public latitude!: string;
  public longitude!: string;
  public rayonKm!: string;

  public static fromTerritory(t: TerritoryDto): EditTerritoryFormModel {
    const m = new EditTerritoryFormModel();
    m.name = t.name ?? '';
    m.description = t.description ?? '';
    m.latitude = t.latitude != null ? String(t.latitude) : '';
    m.longitude = t.longitude != null ? String(t.longitude) : '';
    m.rayonKm = t.rayonKm != null ? String(t.rayonKm) : '';
    return m;
  }
}

@Component({
  selector: 'edit-territory',
  templateUrl: './edit-territory.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    NgClass,
    TasTitle,
    TasCard,
    Button,
    TasIcon,
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
export class EditTerritoryPage {
  private readonly _territoriesApiService = inject(TerritoriesApiService);
  private readonly _productsApiService = inject(ProductsApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _dialog = inject(Dialog);
  private readonly _router = inject(Router);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public isSaving = signal(false);
  public isDeleting = signal(false);

  public territory = signal<TerritoryDto | null>(null);
  public specialtyOptions = signal<{ label: string; value: string }[]>([]);
  public selectedSpecialities = signal<string[]>([]);

  public updateModel = signal(new EditTerritoryFormModel());
  public formSchema = form(this.updateModel, (schema) => {
    required(schema.name, { message: 'Le nom du territoire est obligatoire' });
  });

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      forkJoin({
        territory: this._territoriesApiService.getTerritory(this.id()),
        products: this._productsApiService.listProducts(),
      }).subscribe({
        next: ({ territory, products }) => {
          this.territory.set(territory);
          this.updateModel.set(EditTerritoryFormModel.fromTerritory(territory));
          this.selectedSpecialities.set(territory.productSpecialities ?? []);
          this.specialtyOptions.set(
            (products ?? []).map((p) => ({ label: p.name ?? p.code ?? '', value: p.code ?? '' }))
          );
          this.isLoading.set(false);
        },
        error: () => {
          this._snackbarService.error('Erreur', 'Impossible de charger le territoire.');
          this.isLoading.set(false);
        },
      });
    });
  }

  public handleUpdate(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      await firstValueFrom(
        this._territoriesApiService
          .updateTerritory(this.id(), {
            name: value.name,
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
              this._snackbarService.error('Erreur', 'Impossible de mettre à jour le territoire.');
              return EMPTY;
            }),
          ),
      );
      this._snackbarService.success('Succès', 'Territoire mis à jour avec succès.');
    });
  }

  public openDeleteDialog(): void {
    const ref = this._dialog.open<boolean>(DeleteTerritoryDialog, {
      width: '480px',
      data: { territoryName: this.territory()?.name ?? '' },
    });

    ref.closed.pipe(filter(Boolean)).subscribe(() => {
      this.isDeleting.set(true);
      this._territoriesApiService
        .deleteTerritory(this.id())
        .pipe(
          catchError(() => {
            this._snackbarService.error('Erreur', 'Impossible de supprimer le territoire.');
            this.isDeleting.set(false);
            return EMPTY;
          }),
        )
        .subscribe(() => {
          this._snackbarService.success('Succès', 'Territoire supprimé avec succès.');
          this._router.navigate(['/settings/territories']);
        });
    });
  }
}

export default EditTerritoryPage;
