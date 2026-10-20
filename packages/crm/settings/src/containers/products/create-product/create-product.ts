import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, firstValueFrom, map, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import {
  CreateProductRequestCategoryEnum,
  EntityFormDto,
  FormsApiService,
  ProductsApiService,
} from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  asEnum,
  EntityFormRenderer,
  explainFormError,
  formErrorDetail,
} from '@sankore/crm/common';
import { ProductParametersEditor } from '../product-parameters-editor';

/**
 * Les champs natifs que `POST products` ne prend pas : le lien vers le système de gestion a son
 * propre geste, sur la fiche. Les montrer à la création — si un tenant les cochait en création
 * rapide — ferait saisir une valeur que personne n'enregistre.
 */
const NOT_ON_CREATE = ['businessProductId', 'businessPlatformName'];

/**
 * Création d'un produit, pilotée par la mise en page du tenant (formulaires dynamiques, lot 5).
 * Le moteur affiche les champs de la création rapide ; l'éditeur de paramètres, propre à la
 * catégorie, reste sous le formulaire.
 */
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
    TasSpinner,
    EntityFormRenderer,
    ProductParametersEditor,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <p class="text-base font-semibold text-slate-800">Nouveau produit</p>
        <p class="text-xs text-slate-400 mt-0.5">
          Les produits servent de spécialités pour les utilisateurs et les territoires.
        </p>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (form(); as f) {
          <entity-form-renderer [form]="f" mode="quick" [columns]="1" [exclude]="excluded" />

          <div class="mt-5">
            <p class="text-sm font-semibold text-slate-700 mb-2">Paramètres du produit</p>
            <product-parameters-editor
              [category]="category()"
              [initialJson]="''"
              (parametersJsonChange)="parametersJson.set($event)"
            ></product-parameters-editor>
          </div>
        } @else if (loadFailed()) {
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Le formulaire n'a pas pu être chargé.
            <button tas-text-button type="button" (click)="load()">Réessayer</button>
          </div>
        } @else {
          <div class="flex justify-center py-16"><tas-spinner size="8" class="text-primary"></tas-spinner></div>
        }
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
          [disabled]="!form() || submitting()"
          [isLoading]="submitting()"
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
  private readonly _formsApi = inject(FormsApiService);
  private readonly _snackbarService = inject(SnackbarService);

  private readonly _renderer = viewChild(EntityFormRenderer);

  public readonly excluded = NOT_ON_CREATE;
  public readonly form = signal<EntityFormDto | null>(null);
  public readonly loadFailed = signal(false);
  public readonly submitting = signal(false);
  public readonly parametersJson = signal('');

  /** La catégorie choisie, qui décide des paramètres proposés en dessous. */
  public readonly category = computed(() => {
    const value = this._renderer()?.wireValues()['category'];
    return typeof value === 'string' ? value : '';
  });

  constructor() {
    this.load();
  }

  public load(): void {
    this.loadFailed.set(false);
    this._formsApi.getEntityForm('Product').subscribe({
      next: (form) => this.form.set(form),
      error: () => this.loadFailed.set(true),
    });
  }

  public async handleSubmit(): Promise<void> {
    const renderer = this._renderer();
    if (!renderer || this.submitting()) return;

    if (!renderer.valid()) {
      renderer.markAllAsTouched();
      return;
    }

    const v = renderer.wireValues();
    const text = (key: string) => (typeof v[key] === 'string' ? (v[key] as string) : null);
    const category = asEnum(CreateProductRequestCategoryEnum, v['category']);
    if (!category) {
      renderer.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    const id = await firstValueFrom(
      this._productsApiService
        .createProduct({
          name: text('name'),
          code: text('code'),
          category,
          description: text('description'),
          // `yyyy-MM-dd`, ce qu'un DateOnly lit. L'ancien écran envoyait un instant ISO complet.
          effectiveFrom: text('effectiveFrom'),
          parametersJson: this.parametersJson() || null,
          customFields: renderer.customFieldsPayload(),
        })
        .pipe(
          map((created) => created ?? true),
          catchError((err: HttpErrorResponse) => {
            const detail = formErrorDetail(err);
            this._snackbarService.error(
              'Création impossible',
              explainFormError(detail, this.form()) ??
                (detail === 'PRODUCT_CODE_TAKEN' ? 'Ce code est déjà utilisé par un autre produit.' : 'Impossible de créer le produit.'),
            );
            // `of(null)` et non EMPTY : `firstValueFrom` d'un flux vide rejette. L'ancien écran
            // annonçait le succès même après une erreur pour cette raison.
            return of(null);
          }),
        ),
    );
    this.submitting.set(false);

    if (!id) return;
    this._snackbarService.success('Succès', 'Produit créé avec succès.');
    this._dialogRef.close(id);
  }

  public close(): void {
    this._dialogRef.close();
  }
}

export default CreateProductComponent;
