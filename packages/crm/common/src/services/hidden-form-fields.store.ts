import { inject, Injectable, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { FormsApiService } from '@sankore/crm-api';

export type FormEntityName = 'Lead' | 'Client' | 'Product';

/**
 * Les champs natifs qu'une institution a masqués dans le paramétrage des formulaires, par entité,
 * chargés une fois pour toute l'application. Les fiches les lisent pour ne pas afficher un champ
 * que l'institution n'utilise pas (le montant souhaité d'un lead, masqué par défaut).
 *
 * Tant que la mise en page n'est pas arrivée, `isVisible` répond non : un champ masqué ne doit pas
 * apparaître puis disparaître. Un échec de chargement rend tout visible — l'écran d'avant.
 */
@Injectable({ providedIn: 'root' })
export class HiddenFormFieldsStore {
  private readonly _api = inject(FormsApiService);
  private readonly _hidden = signal<Partial<Record<FormEntityName, ReadonlySet<string>>>>({});
  private readonly _requested = new Set<FormEntityName>();

  /** Lit un signal : utilisable dans un template ou un `computed`. Appeler `ensureLoaded` avant. */
  public isVisible(entity: FormEntityName, key: string): boolean {
    const hidden = this._hidden()[entity];
    return !!hidden && !hidden.has(key);
  }

  public ensureLoaded(entity: FormEntityName): this {
    if (!this._requested.has(entity)) this.refresh(entity);
    return this;
  }

  /** Recharge, après un enregistrement du paramétrage. */
  public refresh(entity: FormEntityName): void {
    this._requested.add(entity);
    this._api
      .getEntityForm(entity)
      .pipe(catchError(() => of(null)))
      .subscribe((form) => {
        const keys = new Set(
          (form?.fields ?? []).filter((f) => f.isNative && f.isHidden).map((f) => f.key ?? ''),
        );
        this._hidden.update((all) => ({ ...all, [entity]: keys }));
      });
  }
}
