import {
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { SlicePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSpinner } from '@talisoft/ui/spinner';
import { ProductsApiService, ProductDto } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  BreadcrumbService,
  PermissionsService,
  productCategoryLabel,
} from '@sankore/crm/common';
import { ProductParametersEditor } from '../product-parameters-editor';
import { BeneficiaryPolicyEditor } from '../beneficiary-policy-editor';
import { KycRemotePolicyEditor } from '../kyc-remote-policy-editor';

@Component({
  selector: 'edit-product',
  imports: [
    RouterLink,
    TasCard,
    Button,
    TasIcon,
    TasFormField,
    TasLabel,
    TasInput,
    TasSpinner,
    TasTag,
    SlicePipe,
    Anchor,
    ProductParametersEditor,
    BeneficiaryPolicyEditor,
    KycRemotePolicyEditor,
  ],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else if (loadFailed()) {
      <div class="max-w-2xl">
        <tas-card>
          <div class="p-6 flex flex-col items-center text-center gap-2">
            <tas-icon
              iconName="feather:alert-triangle"
              class="text-functional-error"
              style="font-size:22px"
            ></tas-icon>
            <p class="text-sm font-medium text-slate-700">
              Impossible de charger ce produit.
            </p>
            <p class="text-xs text-slate-400">
              Vérifiez votre connexion, puis réessayez.
            </p>
            <div class="flex gap-2 mt-2">
              <button
                tas-raised-button
                color="primary"
                type="button"
                (click)="reloadProduct()"
              >
                Réessayer
              </button>
              <a [routerLink]="['/settings/products']" tas-outlined-button>
                Retour aux produits
              </a>
            </div>
          </div>
        </tas-card>
      </div>
    } @else if (product()) {
      <div class="max-w-2xl pb-6 flex flex-col gap-4">
        <!-- Page header -->
        <div class="flex items-center gap-3">
          <a [routerLink]="['/settings/products']" tas-button iconButton>
            <tas-icon iconName="feather:chevron-left"></tas-icon>
          </a>
          <div class="flex items-center gap-2.5 min-w-0">
            <div
              class="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center shrink-0"
            >
              <span class="text-xs font-bold text-indigo-600">{{
                codeBadge()
              }}</span>
            </div>
            <div class="min-w-0">
              <h1 class="text-lg font-semibold text-slate-800 truncate">
                {{ product()!.name ?? product()!.code }}
              </h1>
              @if (product()!.code) {
                <span class="text-xs font-mono text-slate-400">{{
                  product()!.code
                }}</span>
              }
            </div>
          </div>
        </div>

        <!-- Readonly metadata -->
        <tas-card>
          <div class="p-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <p class="text-xs text-slate-400 mb-1">Code technique</p>
              <p class="font-mono text-sm font-medium text-slate-800">
                {{ product()!.code ?? '—' }}
              </p>
            </div>
            <div>
              <p class="text-xs text-slate-400 mb-1">Catégorie</p>
              @if (product()!.category) {
                <tas-tag [severity]="categoryMeta(product()!.category).severity">
                  {{ categoryMeta(product()!.category).label }}
                </tas-tag>
              } @else {
                <p class="text-sm text-slate-500">—</p>
              }
            </div>
            <div>
              <p class="text-xs text-slate-400 mb-1">Statut</p>
              <tas-tag [severity]="product()!.isActive ? 'success' : 'warning'">
                {{ product()!.isActive ? 'Actif' : 'Inactif' }}
              </tas-tag>
            </div>
            <div>
              <p class="text-xs text-slate-400 mb-1">Date d'effet</p>
              <p class="text-sm text-slate-800">
                {{ product()!.effectiveFrom ? (product()!.effectiveFrom | slice:0:10) : '—' }}
                @if (product()!.effectiveTo) {
                  → {{ product()!.effectiveTo | slice:0:10 }}
                }
              </p>
            </div>
            <div>
              <p class="text-xs text-slate-400 mb-1">Identifiant</p>
              <p class="font-mono text-xs text-slate-500 truncate">
                {{ product()!.id }}
              </p>
            </div>
          </div>
        </tas-card>

        <!-- Edit form -->
        <tas-card>
          <div class="p-4 flex flex-col gap-4">
            <p class="text-sm font-semibold text-slate-700">
              Modifier le produit
            </p>

            <tas-form-field>
              <tas-label>Nom</tas-label>
              <input
                tasInput
                type="text"
                placeholder="ex: Assurance Vie"
                [value]="editedName()"
                (input)="editedName.set($any($event.target).value)"
              />
            </tas-form-field>

            <tas-form-field>
              <tas-label>Description</tas-label>
              <input
                tasInput
                type="text"
                placeholder="ex: Produits d'assurance vie et épargne"
                [value]="editedDescription()"
                (input)="editedDescription.set($any($event.target).value)"
              />
            </tas-form-field>

            <!-- Parameters editor -->
            <div class="mt-2">
              <p class="text-sm font-semibold text-slate-700 mb-2">Paramètres du produit</p>
              <product-parameters-editor
                [category]="product()!.category ?? ''"
                [initialJson]="product()!.parametersJson ?? ''"
                (parametersJsonChange)="editedParametersJson.set($event)"
              ></product-parameters-editor>
            </div>

            <div class="flex justify-end">
              @if (canUpdate()) {
                <button
                  tas-raised-button
                  color="primary"
                  type="button"
                  [disabled]="isSaving()"
                  [isLoading]="isSaving()"
                  (click)="save()"
                >
                  <tas-icon iconName="feather:save" iconSize="sm"></tas-icon>
                  Enregistrer
                </button>
              }
            </div>
          </div>
        </tas-card>

        <!-- CBS Integration -->
        <tas-card>
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <tas-icon iconName="feather:link" class="text-slate-400" style="font-size:14px"></tas-icon>
              Intégration Core Banking (CBS)
            </p>
            <p class="text-xs text-slate-400 mt-0.5">Associez ce produit à son équivalent dans le système bancaire central.</p>
          </div>
          <div class="p-4">
            @if (cbsLinked()) {
              <div class="flex items-center gap-3 p-3 rounded-lg bg-green-50 border border-green-200 mb-3">
                <tas-icon iconName="feather:check-circle" class="text-green-500" style="font-size:16px"></tas-icon>
                <div>
                  <p class="text-xs font-medium text-green-800">Produit lié au CBS</p>
                  <p class="text-[10px] text-green-700 mt-0.5">
                    Plateforme : <span class="font-semibold">{{ cbsPlatform() }}</span>
                    · ID : <span class="font-mono font-semibold">{{ cbsProductId() }}</span>
                  </p>
                </div>
              </div>
            }
            <div class="grid grid-cols-2 gap-3">
              <tas-form-field>
                <tas-label>Plateforme CBS</tas-label>
                <input tasInput type="text" placeholder="Ex : T24, Flexcube, Temenos"
                  [value]="cbsPlatform()" (input)="cbsPlatform.set($any($event.target).value)" />
              </tas-form-field>
              <tas-form-field>
                <tas-label>ID produit CBS</tas-label>
                <input tasInput type="text" placeholder="Ex : PROD-001"
                  [value]="cbsProductId()" (input)="cbsProductId.set($any($event.target).value)" />
              </tas-form-field>
            </div>
            <div class="flex justify-end mt-3">
              @if (canUpdate()) {
                <button tas-outlined-button color="primary" type="button" class="text-xs"
                  [disabled]="isLinkingCbs() || !cbsPlatform().trim() || !cbsProductId().trim()"
                  (click)="linkToCbs()">
                  @if (isLinkingCbs()) { <tas-spinner size="3" class="text-primary"></tas-spinner> }
                  <tas-icon iconName="feather:link" style="font-size:12px"></tas-icon>
                  {{ cbsLinked() ? 'Mettre à jour le lien' : 'Lier au CBS' }}
                </button>
              }
            </div>
          </div>
        </tas-card>

        <!-- Politique bénéficiaires, foyer et questionnaires (BNF-F-14) -->
        <beneficiary-policy-editor
          [product]="product()"
          [canUpdate]="canUpdate()"
          (saved)="reloadProduct()"
        ></beneficiary-policy-editor>

        <!-- KYC à distance (KRM-F-01) -->
        <kyc-remote-policy-editor
          [product]="product()"
          [canUpdate]="canUpdate()"
          (saved)="reloadProduct()"
        ></kyc-remote-policy-editor>

        <!-- Danger zone -->
        <h2 class="text-lg font-semibold text-slate-800">Zone de danger</h2>

        <tas-card>
          <div class="p-4 flex items-start justify-between gap-4">
            <div class="flex items-start gap-3">
              <div
                class="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center shrink-0 mt-0.5"
              >
                <tas-icon
                  iconName="feather:trash-2"
                  class="text-red-400"
                  style="font-size:14px"
                ></tas-icon>
              </div>
              <div>
                <p class="text-sm font-semibold text-red-600">
                  Supprimer ce produit
                </p>
                <p class="text-sm text-slate-500 mt-0.5">
                  Suppression définitive et irréversible. Les spécialités
                  associées à ce produit seront retirées des utilisateurs et
                  territoires.
                </p>
              </div>
            </div>
            @if (canDelete()) {
              <button
                tas-outlined-button
                color="warn"
                type="button"
                [disabled]="isDeleting()"
                [isLoading]="isDeleting()"
                (click)="confirmDelete()"
                class="shrink-0"
              >
                <tas-icon iconName="feather:trash-2" iconSize="sm"></tas-icon>
                Supprimer
              </button>
            }
          </div>
        </tas-card>
      </div>
    }
  `,
})
export class EditProductPage {
  private readonly _permissions = inject(PermissionsService);
  public readonly canUpdate = this._permissions.can('product:update');
  public readonly canDelete = this._permissions.can('product:delete');

  private readonly _productsApiService = inject(ProductsApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);
  private readonly _router = inject(Router);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public readonly id = input.required<string>();

  /**
   * Le libellé vient du référentiel partagé : la version précédente ne
   * connaissait que trois catégories et affichait le code brut
   * (« HealthInsurance ») pour toutes les autres.
   */
  public categoryMeta(
    cat: string | null | undefined,
  ): { label: string; severity: Severity } {
    const label = productCategoryLabel(cat);
    switch (cat) {
      case 'Loan': return { label, severity: 'info' };
      case 'Savings': return { label, severity: 'success' };
      case 'Tontine': return { label, severity: 'warning' };
      default: return { label, severity: 'neutral' };
    }
  }

  public isLoading = signal(true);
  public loadFailed = signal(false);
  public isSaving = signal(false);
  public isDeleting = signal(false);
  public product = signal<ProductDto | null>(null);
  public editedName = signal('');
  public editedDescription = signal('');
  public editedParametersJson = signal('');

  // CBS integration
  public cbsPlatform = signal('');
  public cbsProductId = signal('');
  public cbsLinked = linkedSignal(() => {
    return !!(this.cbsProductId() && this.cbsPlatform());
  });
  public isLinkingCbs = signal(false);

  public codeBadge = computed(() => {
    const code = this.product()?.code;
    if (!code) return '??';
    return code
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 2)
      .toUpperCase();
  });

  constructor() {
    effect(() => {
      const productId = this.id();
      this._load(productId);
    });
  }

  /**
   * Rechargement après une écriture composée (politique bénéficiaires et
   * foyer) : le 204 ne dit pas ce que le serveur a réellement retenu.
   */
  public reloadProduct(): void {
    this._load(this.id());
  }

  private _load(productId: string): void {
    this.isLoading.set(true);
    this.loadFailed.set(false);
    this._productsApiService.getProduct(productId).subscribe({
      next: (product) => {
        this.product.set(product);
        this.editedName.set(product.name ?? '');
        this.cbsPlatform.set(product.businessPlatformName ?? '');
        this.cbsProductId.set(product.businessProductId ?? '');
        this.editedDescription.set(product.description ?? '');
        this.editedParametersJson.set(product.parametersJson ?? '');
        this.isLoading.set(false);
        this._breadcrumbService.set([
          { label: 'Paramétrage', link: ['/settings'] },
          { label: 'Produits', link: ['/settings/products'] },
          { label: product.name ?? product.code ?? 'Produit' },
        ]);
      },
      error: () => {
        this._snackbarService.error(
          'Erreur',
          'Impossible de charger le produit.',
        );
        this.loadFailed.set(true);
        this.isLoading.set(false);
      },
    });
  }

  public save(): void {
    this.isSaving.set(true);
    this._productsApiService
      .updateProduct(this.id(), {
        name: this.editedName().trim() || null,
        description: this.editedDescription().trim() || null,
        parametersJson: this.editedParametersJson().trim() || null,
      })
      .pipe(
        catchError(() => {
          this._snackbarService.error(
            'Erreur',
            'Impossible de mettre à jour le produit.',
          );
          this.isSaving.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._snackbarService.success('Succès', 'Produit mis à jour.');
        this.product.update((p) =>
          p
            ? {
                ...p,
                name: this.editedName().trim() || null,
                description: this.editedDescription().trim() || null,
                parametersJson: this.editedParametersJson().trim() || null,
              }
            : p,
        );
        this.isSaving.set(false);
      });
  }

  public linkToCbs(): void {
    if (!this.cbsPlatform().trim() || !this.cbsProductId().trim()) return;
    this.isLinkingCbs.set(true);
    this._productsApiService.linkProductToCbs(this.id(), {
      businessPlatformName: this.cbsPlatform().trim(),
      businessProductId: this.cbsProductId().trim(),
    }).pipe(
      catchError(() => {
        this._snackbarService.error('Erreur', 'Impossible de lier le produit au CBS.');
        this.isLinkingCbs.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this.cbsLinked.set(true);
      this._snackbarService.success('Produit lié', `Lié à ${this.cbsPlatform()} — ${this.cbsProductId()}.`);
      this.isLinkingCbs.set(false);
    });
  }

  public confirmDelete(): void {
    this._confirmDialogService.confirm({
      title: 'Supprimer le produit',
      message: `Supprimer "${this.product()?.name ?? this.product()?.code}" ? Cette action est irréversible.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Supprimer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isDeleting.set(true);
        this._productsApiService
          .deleteProduct(this.id())
          .pipe(
            catchError(() => {
              this._snackbarService.error(
                'Erreur',
                'Impossible de supprimer le produit.',
              );
              this.isDeleting.set(false);
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this._snackbarService.success('Succès', 'Produit supprimé.');
            this._router.navigate(['/settings/products']);
          });
      },
    });
  }
}

export default EditProductPage;
