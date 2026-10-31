import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { ProductDto, ProductsApiService } from '@sankore/crm-api';

/**
 * Les noms des produits du catalogue, par code, chargés une fois pour toute l'application.
 * Le produit d'intérêt d'un lead est un code (`S_PUS001`) : sans cette table, les écrans
 * l'affichaient tel quel. Les produits inactifs sont inclus — un lead ancien garde son produit.
 * Un échec de chargement laisse les codes : un écran ne doit pas tomber pour un libellé.
 */
@Injectable({ providedIn: 'root' })
export class ProductNamesStore {
  private readonly _api = inject(ProductsApiService);
  private readonly _products = signal<ProductDto[]>([]);
  private _requested = false;

  /** Code → nom. Lit un signal : utilisable dans un template ou un `computed`. */
  public readonly names = computed(() => {
    const names: Record<string, string> = {};
    for (const p of this._products()) if (p.code && p.name) names[p.code] = p.name;
    return names;
  });

  /** Charge le catalogue si personne ne l'a encore fait ; renvoie le store pour chaîner. */
  public ensureLoaded(): this {
    if (!this._requested) this.refresh();
    return this;
  }

  /** Recharge, après une modification du catalogue. */
  public refresh(): void {
    this._requested = true;
    this._api.listProducts().pipe(catchError(() => of(null))).subscribe((products) => {
      if (products) this._products.set(products);
    });
  }
}
