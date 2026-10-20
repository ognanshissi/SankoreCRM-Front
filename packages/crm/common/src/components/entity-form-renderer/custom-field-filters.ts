import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { FormField as EntityFormField, FormFieldTypeEnum, FormsApiService } from '@sankore/crm-api';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';

const FILTERABLE: ReadonlyArray<FormFieldTypeEnum> = [
  FormFieldTypeEnum.SingleChoice,
  FormFieldTypeEnum.MultiChoice,
  FormFieldTypeEnum.Boolean,
];

/**
 * Les filtres de liste sur les champs personnalisés (formulaires dynamiques, lot 6) : une liste
 * déroulante par champ à choix ou oui/non. Rendus dans la grille de filtres de l'écran hôte — son
 * élément est en `display: contents` — et émis comme le serveur les lit, `clé:valeur`
 * (`cf=segment:Commercant`).
 *
 * <p>Un champ marqué sensible n'est jamais proposé : le serveur refuse de filtrer dessus, filtrer
 * sur une valeur masquée revenant à la lire. Les textes et les nombres ne le sont pas non plus — un
 * filtre d'égalité sur un texte libre n'aide personne.</p>
 *
 * <p>Comme les autres barres de filtres du projet : signaux et `[ngModel]`, pas de signal forms —
 * rien à valider, rien à soumettre.</p>
 */
@Component({
  selector: 'custom-field-filters',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TasFormField, TasLabel, TasSelect],
  host: { class: 'contents' },
  template: `
    @for (field of fields(); track field.key) {
      <tas-form-field>
        <tas-label>{{ field.label }}</tas-label>
        <tas-select
          clearable
          [options]="optionsOf(field)"
          optionLabel="label"
          optionValue="value"
          placeholder="Tous"
          [ngModel]="selected()[field.key ?? ''] ?? ''"
          (ngModelChange)="select(field.key ?? '', $event)"
        ></tas-select>
      </tas-form-field>
    }
  `,
})
export class CustomFieldFilters {
  private readonly _formsApi = inject(FormsApiService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly entity = input.required<'Lead' | 'Client'>();
  /** Les filtres actifs, `clé:valeur`. */
  public readonly value = input<string[]>([]);
  public readonly valueChange = output<string[]>();

  private readonly _form = signal<EntityFormField[]>([]);

  public readonly fields = computed(() =>
    this._form().filter((f) => !f.isNative && !f.isArchived && !f.isSensitive && FILTERABLE.includes(f.type!)),
  );

  /** Vrai quand il y a au moins un champ à filtrer — l'hôte peut masquer un en-tête de section. */
  public readonly hasFilters = computed(() => this.fields().length > 0);

  public readonly selected = computed<Partial<Record<string, string>>>(() => {
    const out: Partial<Record<string, string>> = {};
    for (const filter of this.value()) {
      const at = filter.indexOf(':');
      if (at > 0) out[filter.slice(0, at)] = filter.slice(at + 1);
    }
    return out;
  });

  constructor() {
    effect(() => {
      const entity = this.entity();
      this._formsApi
        .getEntityForm(entity)
        .pipe(catchError(() => EMPTY), takeUntilDestroyed(this._destroyRef))
        .subscribe((form) => this._form.set(form.fields ?? []));
    });
  }

  public optionsOf(field: EntityFormField): { value: string; label: string }[] {
    if (field.type === FormFieldTypeEnum.Boolean) {
      return [
        { value: 'true', label: 'Oui' },
        { value: 'false', label: 'Non' },
      ];
    }
    return (field.options ?? []).map((o) => ({ value: o.value ?? '', label: o.label ?? o.value ?? '' }));
  }

  /** La croix d'effacement d'un `tas-select` notifie `null` : le filtre de ce champ est retiré. */
  public select(key: string, value: string | null): void {
    const next = { ...this.selected() };
    if (value) next[key] = value;
    else delete next[key];
    this.valueChange.emit(Object.entries(next).map(([k, v]) => `${k}:${v}`));
  }
}
