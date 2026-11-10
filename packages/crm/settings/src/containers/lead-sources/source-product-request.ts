import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { form, FormField, FormRoot, submit } from '@angular/forms/signals';
import { catchError, map, of } from 'rxjs';
import { LeadSourceDetailDto, ProductsApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';

/** Ce que la carte enregistre : `productRequestIsHot` à `null` reprend le réglage du canal. */
export interface SourceProductRequestChange {
  defaultProductCode: string | null;
  productRequestIsHot: boolean | null;
}

/** Le produit par défaut vit dans le sac de réglages, sous l'une ou l'autre casse. */
export function defaultProductOf(source: LeadSourceDetailDto | null | undefined): string {
  const bag = (source?.settings ?? {}) as Record<string, unknown>;
  const value = bag['defaultProductCode'] ?? bag['DefaultProductCode'];
  return typeof value === 'string' ? value : '';
}

class SourceProductRequestFormModel {
  public product!: string;
  public hot!: boolean;

  public static fromSource(source: LeadSourceDetailDto | null): SourceProductRequestFormModel {
    const m = new SourceProductRequestFormModel();
    m.product = defaultProductOf(source);
    m.hot = source?.productRequestIsHot ?? source?.defaultProductRequestIsHot ?? false;
    return m;
  }
}

/**
 * Le produit que la source demande et ce que vaut cette demande (grands comptes, lot 3) : « un lead
 * qui remplit un formulaire pour un produit donné est un lead chaud ». Le produit par défaut
 * s'applique quand le formulaire n'en envoie pas — il ne pouvait jusque-là être choisi qu'à la
 * création de la source, et le serveur ne le lisait pas. L'option est cochée d'office pour les
 * formulaires web et les Lead Ads.
 */
@Component({
  selector: 'source-product-request',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRoot, FormField, Button, TasCard, TasFormField, TasLabel, TasHint, TasSelect],
  template: `
    <tas-card class="block mt-4">
      <div class="p-4 border-b border-slate-100">
        <p class="text-sm font-semibold text-slate-700">Demande de produit</p>
        <p class="mt-0.5 text-xs text-slate-500">
          Un prospect qui demande un produit précis attend une réponse rapide.
        </p>
      </div>
      <form [formRoot]="formSchema" class="p-4 flex flex-col gap-4" (submit)="$event.preventDefault()">
        <div class="max-w-md">
          <tas-form-field>
            <tas-label>Produit par défaut</tas-label>
            <tas-select [options]="productOptions()" placeholder="Aucun" [formField]="formSchema.product"></tas-select>
            <tas-hint>Appliqué quand le formulaire n’envoie pas de produit.</tas-hint>
          </tas-form-field>
        </div>
        <label class="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" class="mt-0.5 accent-primary" [formField]="formSchema.hot" />
          <span>
            Une demande pour un produit précis est un lead chaud
            <span class="block text-xs text-slate-500">
              Le lead est « Chaud » quel que soit son score : il passe en tête de « Ma journée » avec le délai de
              premier contact des leads chauds. Il redevient celui de son score après un contact « Pas intéressé »,
              sa clôture ou 30 jours sans activité.
              {{ source().defaultProductRequestIsHot ? 'Coché d’office pour ce canal.' : 'Décoché d’office pour ce canal.' }}
            </span>
          </span>
        </label>
        @if (canWrite()) {
          <div class="flex items-center gap-2">
            <button tas-raised-button color="primary" type="button" (click)="handleSubmit()"
                    [disabled]="formSchema().submitting() || !changed()"
                    [isLoading]="formSchema().submitting()">Enregistrer</button>
          </div>
        }
      </form>
    </tas-card>
  `,
})
export class SourceProductRequest {
  private readonly _productsApi = inject(ProductsApiService);

  public readonly source = input.required<LeadSourceDetailDto>();
  public readonly canWrite = input(false);
  /** Le parent enregistre et recharge. */
  public readonly save = output<SourceProductRequestChange>();

  private readonly _products = toSignal(
    this._productsApi.listProducts(true).pipe(
      map((products) => products.map((p) => ({ label: p.name ?? p.code ?? '—', value: p.code ?? '' }))),
      catchError(() => of([] as { label: string; value: string }[])),
    ),
    { initialValue: [] as { label: string; value: string }[] },
  );

  /** « Aucun » pour retirer le produit ; un code qui n'est plus au catalogue reste affiché. */
  public readonly productOptions = computed(() => {
    const options = [{ label: 'Aucun', value: '' }, ...this._products()];
    const current = defaultProductOf(this.source());
    return current && !options.some((o) => o.value === current) ? [...options, { label: current, value: current }] : options;
  });

  public readonly model = signal(SourceProductRequestFormModel.fromSource(null));
  public readonly formSchema = form(this.model);

  public readonly changed = computed(() => {
    const initial = SourceProductRequestFormModel.fromSource(this.source());
    const m = this.model();
    return m.product !== initial.product || m.hot !== initial.hot;
  });

  constructor() {
    effect(() => this.model.set(SourceProductRequestFormModel.fromSource(this.source())));
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const source = this.source();
      this.save.emit({
        defaultProductCode: value.product || null,
        // Égal au réglage du canal : on enregistre « celui du canal » plutôt qu'une copie figée.
        productRequestIsHot: value.hot === (source.defaultProductRequestIsHot ?? false) ? null : value.hot,
      });
    });
  }
}
