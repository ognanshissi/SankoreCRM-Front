import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { TasTitle } from '@talisoft/ui/title';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import {
  TasError,
  TasFormField,
  TasHint,
  TasLabel,
} from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { LeadsApiService, ProductsApiService } from '@sankore/crm-api';
import { ProductConfigService } from '@sankore/crm/common';

class CreateQualificationTemplateFormModel {
  public name!: string;
  public description!: string;
  public productCategory!: string;
  public productCode!: string;

  public static instantiate(): CreateQualificationTemplateFormModel {
    const model = new CreateQualificationTemplateFormModel();
    model.name = '';
    model.description = '';
    model.productCategory = '';
    model.productCode = '';
    return model;
  }
}

@Component({
  selector: 'create-qualification-template',
  templateUrl: './create-qualification-template.html',
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
export class CreateQualificationTemplateComponent {
  private readonly _dialogRef = inject(DialogRef<string>);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _productsApiService = inject(ProductsApiService);
  private readonly _snackbarService = inject(SnackbarService);

  public readonly productConfig = inject(ProductConfigService);

  public model = signal(CreateQualificationTemplateFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.name, { message: 'Le nom du formulaire est obligatoire' });
  });

  public readonly productsOptions = signal<
    { value: string | null | undefined; label: string | null | undefined }[]
  >([]);

  /** Les produits proposés dépendent de la catégorie choisie. */
  private readonly _loadProducts = effect(() => {
    const category = this.formSchema.productCategory().value();
    if (!category) {
      this.productsOptions.set([]);
      return;
    }
    this._productsApiService
      .listProducts(true, category as any)
      .pipe(
        map((products) =>
          products.map((product) => ({
            value: product.code,
            label: product.name,
          })),
        ),
        catchError(() => EMPTY),
      )
      .subscribe((options) => this.productsOptions.set(options));
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      // Volontairement sans sections ni questions : elles se configurent dans
      // l'écran d'édition, une fois le brouillon créé.
      const templateId = await firstValueFrom(
        this._leadsApi
          .createQualificationTemplate({
            name: value.name,
            description: value.description || null,
            productCategory: (value.productCategory || null) as any,
            productCode: value.productCode || null,
            sections: null,
            questions: null,
          })
          .pipe(
            catchError(() => {
              this._snackbarService.error(
                'Erreur',
                'Impossible de créer le formulaire, réessayez plus tard.',
              );
              return EMPTY;
            }),
          ),
      );

      if (templateId) {
        this._snackbarService.success(
          'Succès',
          'Formulaire de qualification créé en brouillon.',
        );
        this._dialogRef.close(templateId);
      }
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}

export default CreateQualificationTemplateComponent;
