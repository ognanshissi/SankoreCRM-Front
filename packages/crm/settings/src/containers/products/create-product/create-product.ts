import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { ProductsApiService } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';

class CreateProductFormModel {
  public name!: string;
  public code!: string;
  public description!: string;

  public static instantiate(): CreateProductFormModel {
    const m = new CreateProductFormModel();
    m.name = '';
    m.code = '';
    m.description = '';
    return m;
  }
}

@Component({
  selector: 'create-product',
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
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <p class="text-base font-semibold text-slate-800">Nouveau produit</p>
        <p class="text-xs text-slate-400 mt-0.5">Les produits servent de spécialités pour les utilisateurs et les territoires.</p>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">

          <tas-form-field>
            <tas-label>Nom <span class="text-functional-error">*</span></tas-label>
            <input
              tasInput
              type="text"
              placeholder="ex: Assurance Vie"
              [formField]="formSchema.name"
            />
            @if (formSchema.name().touched() && formSchema.name().invalid()) {
              <tas-error>{{ formSchema.name().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Code <span class="text-functional-error">*</span></tas-label>
            <input
              tasInput
              type="text"
              placeholder="ex: ASS_VIE"
              [formField]="formSchema.code"
            />
            <p class="text-xs text-slate-400 mt-1">Identifiant technique unique. Ne pourra plus être modifié après création.</p>
            @if (formSchema.code().touched() && formSchema.code().invalid()) {
              <tas-error>{{ formSchema.code().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Description</tas-label>
            <input
              tasInput
              type="text"
              placeholder="ex: Produits d'assurance vie et épargne"
              [formField]="formSchema.description"
            />
          </tas-form-field>

        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">
          <tas-icon iconName="feather:x" iconSize="sm"></tas-icon>
          Annuler
        </button>
        <button
          tas-raised-button
          color="primary"
          type="button"
          (click)="handleSubmit()"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
        >
          <tas-icon iconName="feather:plus" iconSize="sm"></tas-icon>
          Créer le produit
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class CreateProductComponent {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _productsApiService = inject(ProductsApiService);
  private readonly _snackbarService = inject(SnackbarService);

  public model = signal(CreateProductFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.name, { message: 'Le nom du produit est obligatoire' });
    required(schema.code, { message: 'Le code du produit est obligatoire' });
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const result = await firstValueFrom(
        this._productsApiService
          .createProduct({
            name: value.name,
            code: value.code,
            description: value.description || null,
          })
          .pipe(
            catchError(() => {
              this._snackbarService.error('Erreur', 'Impossible de créer le produit.');
              return EMPTY;
            }),
          ),
      );
      this._snackbarService.success('Succès', 'Produit créé avec succès.');
      this._dialogRef.close(result ?? true);
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}

export default CreateProductComponent;
