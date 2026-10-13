import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, max, min, readonly, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, forkJoin, map, of } from 'rxjs';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { AgentSettingsDto, ProductsApiService, UsersApiService } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { EditUserState } from './edit-user-state';

/** Mêmes codes que l'onglet Paramétrage agent du profil (sous-étiquette primaire, minuscules). */
const LANGUAGE_LABELS: Record<string, string | undefined> = {
  fr: 'Français',
  dyu: 'Dioula',
  bci: 'Baoulé',
  en: 'Anglais',
  wo: 'Wolof',
};

const DAY_SHORT: Record<string, string | undefined> = {
  Monday: 'Lun', Tuesday: 'Mar', Wednesday: 'Mer', Thursday: 'Jeu', Friday: 'Ven', Saturday: 'Sam', Sunday: 'Dim',
};

/** Borne serveur de `PUT users/{id}/agent-settings/ceiling`. */
const MAX_CEILING = 500;

class CeilingFormModel {
  public ceiling!: number;
  public static of(value: number): CeilingFormModel {
    const m = new CeilingFormModel();
    m.ceiling = value;
    return m;
  }
}

/**
 * Ce que l'administration fixe pour un agent — produits autorisés et plafond de leads — et, en
 * lecture, ce que l'agent déclare lui-même depuis son profil. Les deux réglages s'appliquent dès
 * qu'ils changent : pas de bouton Enregistrer pour une puce retirée.
 */
@Component({
  selector: 'user-parametrage',
  imports: [DatePipe, FormsModule, FormRoot, FormField, TasFormField, TasLabel, TasHint, TasError, TasIcon, TasInput, TasSelect, TasSpinner],
  template: `
    @if (isLoading() && !settings()) {
      <div class="flex justify-center py-24"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
    } @else if (settings(); as s) {
      <section class="rounded-2xl bg-white shadow-sm border border-slate-100 p-6">
        <h2 class="text-xl font-bold text-primary">Paramétrage agent</h2>
        <p class="text-sm text-slate-600 mt-0.5">Ce que vous fixez ici, l'agent ne peut pas le modifier depuis son profil.</p>

        <div class="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-6 mt-5">
          <!-- Produits autorisés -->
          <div>
            <p class="text-sm font-medium text-slate-800 mb-2">Produits autorisés</p>
            <div class="flex flex-wrap items-center gap-2">
              @for (code of products(); track code) {
                <span class="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-full bg-blue-50 text-blue-800 text-xs font-medium">
                  {{ productLabel(code) }}
                  @if (canUpdate()) {
                    <button type="button" class="w-4 h-4 rounded-full hover:bg-blue-100 flex items-center justify-center disabled:opacity-50"
                      [attr.aria-label]="'Retirer ' + productLabel(code)" [disabled]="isSavingProducts()" (click)="removeProduct(code)">
                      <tas-icon iconName="feather:x" style="font-size:11px"></tas-icon>
                    </button>
                  }
                </span>
              } @empty {
                <span class="text-sm text-slate-500">Aucun produit : l'agent ne reçoit pas de lead lié à un produit.</span>
              }
              @if (canUpdate() && addableOptions().length && !isAdding()) {
                <button type="button" class="px-3 py-1 rounded-full border border-dashed border-slate-400 text-xs font-medium text-slate-700 hover:border-primary hover:text-primary"
                  (click)="isAdding.set(true)">+ Ajouter</button>
              }
            </div>
            @if (isAdding()) {
              <div class="flex items-center gap-2 mt-3 max-w-xs">
                <div class="flex-1">
                  <tas-select [options]="addableOptions()" [searchable]="true" placeholder="Choisir un produit…" aria-label="Produit à ajouter"
                    [ngModel]="null" (ngModelChange)="addProduct($event)"></tas-select>
                </div>
                <button type="button" class="text-xs text-slate-500 hover:underline" (click)="isAdding.set(false)">Annuler</button>
              </div>
            }
          </div>

          <!-- Plafond -->
          <form [formRoot]="ceilingForm" (submit)="$event.preventDefault(); saveCeiling()">
            <tas-form-field>
              <tas-label>Plafond de leads actifs</tas-label>
              <input tasInput type="number" class="!w-40" [formField]="ceilingForm.ceiling"
                (blur)="saveCeiling()" />
              @if (ceilingForm.ceiling().invalid()) {
                <tas-error>{{ ceilingForm.ceiling().errors()[0].message }}</tas-error>
              } @else {
                <tas-hint>L'agent peut choisir une capacité plus basse, jamais plus haute.</tas-hint>
              }
            </tas-form-field>
            @if (s.maxActiveLeads != null && s.maxActiveLeads < (s.capacityCeiling ?? 0)) {
              <p class="text-xs text-slate-600 mt-1">Capacité choisie par l'agent : {{ s.maxActiveLeads }}.</p>
            }
          </form>
        </div>

        <!-- Déclaré par l'agent -->
        <dl class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 pt-5 border-t border-slate-100">
          <div>
            <dt class="text-xs text-slate-500">Disponibilité</dt>
            <dd class="text-sm font-semibold text-slate-900 mt-0.5">{{ availabilityLabel() }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">Horaires</dt>
            <dd class="text-sm font-semibold text-slate-900 mt-0.5">{{ hoursLabel() }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">Langues</dt>
            <dd class="text-sm font-semibold text-slate-900 mt-0.5">{{ languagesLabel() }}</dd>
          </div>
        </dl>
        <p class="text-xs text-slate-500 mt-4">
          Disponibilité, horaires et langues sont choisis par l'agent dans son profil.
          @if (s.updatedAt) { Dernière mise à jour le {{ s.updatedAt | date: 'd MMM yyyy' }}. }
        </p>
      </section>
    } @else {
      <p class="text-sm text-slate-600 py-24 text-center">Le paramétrage de cet agent n'a pas pu être chargé.</p>
    }
  `,
})
export class UserParametragePage {
  private readonly _usersApi = inject(UsersApiService);
  private readonly _productsApi = inject(ProductsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _state = inject(EditUserState);

  public readonly id = input.required<string>();
  public readonly canUpdate = this._permissions.can('user:update');
  public readonly maxCeiling = MAX_CEILING;

  public isLoading = signal(true);
  public settings = signal<AgentSettingsDto | null>(null);
  public products = signal<string[]>([]);
  public isAdding = signal(false);
  public isSavingProducts = signal(false);
  private readonly _catalog = signal<{ label: string; value: string }[]>([]);

  public ceilingModel = signal(CeilingFormModel.of(30));
  public ceilingForm = form(this.ceilingModel, (schema) => {
    required(schema.ceiling, { message: 'Indiquez un plafond' });
    min(schema.ceiling, 1, { message: 'Au moins 1 lead' });
    max(schema.ceiling, MAX_CEILING, { message: `${MAX_CEILING} leads au maximum` });
    readonly(schema.ceiling, () => !this.canUpdate());
  });

  public readonly addableOptions = computed(() => {
    const taken = new Set(this.products());
    return this._catalog().filter((p) => !taken.has(p.value));
  });

  public readonly availabilityLabel = computed(() => {
    const s = this.settings();
    // Sans enregistrement, le serveur renvoie la valeur par défaut « Available » : ce n'est pas
    // une déclaration de l'agent, et l'écran ne doit pas le présenter comme tel.
    if (!s?.updatedAt) return 'Non renseignée';
    switch (s.availability) {
      case 'Paused': return 'En pause';
      case 'Absent': {
        const a = s.absence;
        return a ? `Absent du ${this._date(a.from)} au ${this._date(a.to)}` : 'Absent';
      }
      default: return 'Disponible';
    }
  });

  public readonly hoursLabel = computed(() => {
    const s = this.settings();
    // Sans horaires déclarés, le dispatching n'applique aucune contrainte horaire.
    if (!s?.workingHoursConfigured) return 'Non déclarés (sans restriction)';
    const days = (s.workingHours ?? []).filter((d) => d.enabled);
    if (!days.length) return 'Aucun jour travaillé';
    const ranges = new Set(days.map((d) => `${d.start}–${d.end}`));
    const labels = days.map((d) => DAY_SHORT[d.day ?? ''] ?? d.day);
    const span = labels.length > 2 ? `${labels[0]}–${labels[labels.length - 1]}` : labels.join(', ');
    return ranges.size === 1 ? `${span} · ${[...ranges][0]}` : `${days.length} jours, horaires variables`;
  });

  public readonly languagesLabel = computed(() => {
    const codes = this.settings()?.spokenLanguages ?? [];
    return codes.length ? codes.map((c) => LANGUAGE_LABELS[c] ?? c).join(', ') : 'Non renseignées';
  });

  constructor() {
    effect(() => this._load(this.id()));
  }

  public productLabel(code: string): string {
    return this._catalog().find((p) => p.value === code)?.label ?? code;
  }

  public addProduct(code: string | null): void {
    if (!code) return;
    this.isAdding.set(false);
    this._saveProducts([...this.products(), code]);
  }

  public removeProduct(code: string): void {
    this._saveProducts(this.products().filter((p) => p !== code));
  }

  /** Appliqué à la sortie du champ ou sur Entrée, seulement s'il a changé et qu'il est valide. */
  public saveCeiling(): void {
    const current = this.settings()?.capacityCeiling;
    if (!this.canUpdate() || this.ceilingModel().ceiling === current) return;

    submit(this.ceilingForm, async (field) => {
      const value = Number(field()?.value()?.ceiling);
      const ok = await firstValueFrom(
        this._usersApi.setAgentCapacityCeiling(this.id(), { capacityCeiling: value }).pipe(
          map(() => true),
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Plafond non enregistré', err.error?.detail ?? 'Le plafond n’a pas pu être modifié.');
            return of(false);
          }),
        ),
      );
      if (!ok) return;
      this._snackbar.success('Plafond enregistré', `${value} leads actifs au maximum.`);
      // Relecture : une capacité choisie par l'agent au-dessus du nouveau plafond y a été ramenée.
      this._load(this.id());
    });
  }

  private _saveProducts(next: string[]): void {
    const previous = this.products();
    this.products.set(next);
    this.isSavingProducts.set(true);
    this._usersApi
      .updateUser(this.id(), { specialties: next })
      .pipe(
        catchError(() => {
          this.products.set(previous);
          this.isSavingProducts.set(false);
          this._snackbar.error('Erreur', 'Les produits autorisés n’ont pas été mis à jour.');
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.isSavingProducts.set(false);
        this._state.reload();
      });
  }

  private _load(id: string): void {
    this.isLoading.set(true);
    forkJoin({
      settings: this._usersApi.getUserAgentSettings(id).pipe(catchError(() => of(null))),
      products: this._productsApi.listProducts().pipe(catchError(() => of([]))),
    }).subscribe(({ settings, products }) => {
      this._catalog.set((products ?? []).filter((p) => !!p.code).map((p) => ({ label: p.name ?? p.code!, value: p.code! })));
      this.settings.set(settings);
      if (settings) {
        this.products.set(settings.products ?? []);
        this.ceilingModel.set(CeilingFormModel.of(settings.capacityCeiling ?? 30));
        this.ceilingForm().reset();
      }
      this.isLoading.set(false);
    });
  }

  private _date(value: string | null | undefined): string {
    return value ? new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '?';
  }
}

export default UserParametragePage;
