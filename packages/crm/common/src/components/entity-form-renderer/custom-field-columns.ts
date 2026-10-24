import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY } from 'rxjs';
import { FormField as EntityFormField, FormFieldTypeEnum, FormsApiService } from '@sankore/crm-api';
import { institutionCurrency } from '../../models/institution-currency';

/** Ce qu'une cellule peut contenir pour chaque type — ce que le serveur sait relire. */
function formatHint(field: EntityFormField): string {
  switch (field.type) {
    case FormFieldTypeEnum.SingleChoice:
      return (field.options ?? []).map((o) => o.label).join(' · ');
    case FormFieldTypeEnum.MultiChoice:
      return `${(field.options ?? []).map((o) => o.label).join(' · ')} — plusieurs, séparés par « ; »`;
    case FormFieldTypeEnum.Boolean:
      return 'oui / non';
    case FormFieldTypeEnum.Date:
      return 'jj/mm/aaaa';
    case FormFieldTypeEnum.Money:
      return `montant en ${institutionCurrency()}, ex. 1 500 000`;
    case FormFieldTypeEnum.Integer:
    case FormFieldTypeEnum.Decimal:
    case FormFieldTypeEnum.Percent:
      return 'nombre';
    default:
      return 'texte';
  }
}

/**
 * Les colonnes `custom.<clé>` qu'un fichier d'import peut porter (formulaires dynamiques, lot 6),
 * avec ce que chacune attend. Sans elles, l'orthographe d'une clé ne se découvre qu'au rapport
 * d'import — ce que l'encart « Colonnes attendues » des écrans d'import existe pour éviter.
 * N'affiche rien quand le tenant n'a aucun champ personnalisé.
 */
@Component({
  selector: 'custom-field-columns',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (columns().length > 0) {
      <div class="mt-3">
        <p class="text-xs font-medium text-slate-700">Champs personnalisés ({{ columns().length }})</p>
        <ul class="mt-1.5 flex flex-col gap-1">
          @for (c of columns(); track c.column) {
            <li class="text-xs text-slate-600">
              <span class="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-mono text-slate-600">{{ c.column }}</span>
              <span class="ml-1.5">{{ c.label }}</span>
              <span class="ml-1 text-slate-400">— {{ c.hint }}</span>
            </li>
          }
        </ul>
        <p class="text-xs text-slate-500 mt-2">
          Une valeur refusée fait échouer la ligne, avec la colonne nommée dans le rapport.
        </p>
      </div>
    }
  `,
})
export class CustomFieldColumns {
  private readonly _formsApi = inject(FormsApiService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly entity = input.required<'Lead' | 'Client'>();
  private readonly _fields = signal<EntityFormField[]>([]);

  public readonly columns = computed(() =>
    this._fields()
      .filter((f) => !f.isNative && !f.isArchived)
      .map((f) => ({ column: `custom.${f.key}`, label: f.label ?? f.key ?? '', hint: formatHint(f) })),
  );

  constructor() {
    effect(() => {
      this._formsApi
        .getEntityForm(this.entity())
        .pipe(catchError(() => EMPTY), takeUntilDestroyed(this._destroyRef))
        .subscribe((form) => this._fields.set(form.fields ?? []));
    });
  }
}
