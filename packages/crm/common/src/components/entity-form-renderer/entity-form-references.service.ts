import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of, shareReplay } from 'rxjs';
import { INSTITUTION_CURRENCIES } from '../../models/institution-currency';
import {
  AgenciesApiService,
  FormFieldReferenceTargetEnum,
  LeadSourcesApiService,
  LegalFormsApiService,
  ProductsApiService,
  UsersApiService,
} from '@sankore/crm-api';

export interface ReferenceOption {
  value: string;
  label: string;
}

/** Les pays de l'UEMOA d'abord — la zone d'exercice — puis les voisins et partenaires fréquents. */
const COUNTRIES: ReferenceOption[] = [
  { value: 'CI', label: "Côte d'Ivoire" },
  { value: 'SN', label: 'Sénégal' },
  { value: 'BF', label: 'Burkina Faso' },
  { value: 'ML', label: 'Mali' },
  { value: 'BJ', label: 'Bénin' },
  { value: 'TG', label: 'Togo' },
  { value: 'NE', label: 'Niger' },
  { value: 'GW', label: 'Guinée-Bissau' },
  { value: 'GH', label: 'Ghana' },
  { value: 'GN', label: 'Guinée' },
  { value: 'LR', label: 'Liberia' },
  { value: 'NG', label: 'Nigeria' },
  { value: 'CM', label: 'Cameroun' },
  { value: 'MA', label: 'Maroc' },
  { value: 'FR', label: 'France' },
  { value: 'US', label: 'États-Unis' },
];

// Une liste « Devise » dans un formulaire propose les mêmes codes que la monnaie de l'institution.
const CURRENCIES: ReferenceOption[] = INSTITUTION_CURRENCIES.map((c) => ({ ...c }));

const LANGUAGES: ReferenceOption[] = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'Anglais' },
];

/**
 * Les listes derrière les champs de type « Référence » d'un formulaire dynamique. Une seule
 * requête par liste et par session de page : un formulaire de lead en affiche deux ou trois, et le
 * même écran rouvert ne doit pas les recharger toutes.
 *
 * <p>Une liste qui ne se charge pas rend une liste VIDE, pas une erreur : l'agent voit un champ sans
 * choix plutôt qu'un formulaire cassé, et le serveur refusera s'il manque une valeur obligatoire.</p>
 *
 * <p>Les valeurs sont celles que les contrats attendent : l'id pour une agence, un utilisateur ou une
 * source, le CODE pour un produit (ce que porte `interestedProduct`) et pour une forme juridique.</p>
 */
@Injectable({ providedIn: 'root' })
export class EntityFormReferences {
  private readonly _agencies = inject(AgenciesApiService);
  private readonly _users = inject(UsersApiService);
  private readonly _products = inject(ProductsApiService);
  private readonly _sources = inject(LeadSourcesApiService);
  private readonly _legalForms = inject(LegalFormsApiService);

  private readonly _cache = new Map<FormFieldReferenceTargetEnum, Observable<ReferenceOption[]>>();

  public options(target: FormFieldReferenceTargetEnum | null | undefined): Observable<ReferenceOption[]> {
    if (!target) return of([]);

    let cached = this._cache.get(target);
    if (!cached) {
      cached = this._load(target).pipe(
        catchError(() => of<ReferenceOption[]>([])),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this._cache.set(target, cached);
    }
    return cached;
  }

  private _load(target: FormFieldReferenceTargetEnum): Observable<ReferenceOption[]> {
    switch (target) {
      case FormFieldReferenceTargetEnum.Agency:
        return this._agencies.listAgencies(false, 1, 200).pipe(
          map((page) => (page.items ?? []).map((a) => ({ value: a.id ?? '', label: a.name ?? a.code ?? '' }))),
        );
      case FormFieldReferenceTargetEnum.User:
        return this._users.listUsers('Active', undefined, undefined, 1, 500).pipe(
          map((page) =>
            (page.items ?? []).map((u) => ({
              value: u.id ?? '',
              label: u.fullName || [u.firstName, u.lastName].filter(Boolean).join(' ') || (u.id ?? ''),
            })),
          ),
        );
      case FormFieldReferenceTargetEnum.Product:
        return this._products.listProducts(true).pipe(
          map((products) => products.map((p) => ({ value: p.code ?? '', label: p.name ?? p.code ?? '' }))),
        );
      case FormFieldReferenceTargetEnum.LeadSource:
        // Toutes sauf les archivées, comme l'ancien écran de création : une source en test ou en pause
        // reçoit encore des leads saisis à la main ; une source archivée se consulte, ne s'attribue plus.
        return this._sources.listLeadSources(undefined, undefined, undefined, undefined, 1, 200).pipe(
          map((page) =>
            (page.items ?? [])
              .filter((s) => s.status !== 'Archived')
              .map((s) => ({ value: s.id ?? '', label: s.label?.trim() || s.code?.trim() || 'Source sans nom' })),
          ),
        );
      case FormFieldReferenceTargetEnum.LegalForm:
        return this._legalForms.listLegalForms(false).pipe(
          map((forms) => forms.map((f) => ({ value: f.code ?? '', label: f.label ?? f.code ?? '' }))),
        );
      case FormFieldReferenceTargetEnum.Country:
        return of(COUNTRIES);
      case FormFieldReferenceTargetEnum.Currency:
        return of(CURRENCIES);
      case FormFieldReferenceTargetEnum.Language:
        return of(LANGUAGES);
      default:
        return of([]);
    }
  }

}
