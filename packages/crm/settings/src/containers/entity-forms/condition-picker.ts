import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FormField as EntityFormField, FormFieldTypeEnum } from '@sankore/crm-api';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { TasCheckbox } from '@talisoft/ui/checkbox';

export interface ConditionValue {
  fieldKey: string;
  values: string[];
}

/**
 * « Visible si <champ> vaut l'une de ces valeurs ». Présentationnel : le panneau qui l'héberge
 * garde la condition dans son propre modèle et la reçoit par `changed`.
 *
 * Les candidats sont déjà filtrés par l'appelant (champs à choix ou oui/non, non archivés, autres
 * que le champ édité) : c'est la même règle que le serveur applique à l'enregistrement.
 */
@Component({
  selector: 'form-condition-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TasFormField, TasLabel, TasHint, TasSelect, TasCheckbox],
  template: `
    <div class="flex flex-col gap-3">
      <tas-form-field>
        <tas-label>Afficher seulement si</tas-label>
        <tas-select
          [options]="targetOptions()"
          placeholder="Toujours afficher"
          [ngModel]="fieldKey()"
          [ngModelOptions]="{ standalone: true }"
          (ngModelChange)="selectTarget($event)"
        ></tas-select>
        <tas-hint>Par exemple, un champ propre aux entreprises n'apparaît que pour elles.</tas-hint>
      </tas-form-field>

      @if (target(); as t) {
        <div>
          <p class="text-xs font-medium text-slate-600 mb-2">… vaut l'une de ces valeurs</p>
          <div class="flex flex-wrap gap-x-5 gap-y-2">
            @for (option of valueOptions(); track option.value) {
              <tas-checkbox
                [checked]="values().includes(option.value)"
                (valueChange)="toggle(option.value, $event)"
              >
                {{ option.label }}
              </tas-checkbox>
            }
          </div>
          @if (values().length === 0) {
            <p class="text-xs text-functional-error mt-2">Cochez au moins une valeur, ou retirez la condition.</p>
          }
        </div>
      }
    </div>
  `,
})
export class ConditionPicker {
  public readonly candidates = input.required<EntityFormField[]>();
  public readonly fieldKey = input<string>('');
  public readonly values = input<string[]>([]);

  public readonly changed = output<ConditionValue>();

  public readonly targetOptions = computed(() => [
    { value: '', label: 'Toujours afficher' },
    ...this.candidates().map((f) => ({ value: f.key ?? '', label: f.label ?? f.key ?? '' })),
  ]);

  public readonly target = computed(() =>
    this.candidates().find((f) => f.key === this.fieldKey()) ?? null,
  );

  public readonly valueOptions = computed(() => {
    const t = this.target();
    if (!t) return [];
    if (t.type === FormFieldTypeEnum.Boolean) {
      return [
        { value: 'true', label: 'Oui' },
        { value: 'false', label: 'Non' },
      ];
    }
    return (t.options ?? []).map((o) => ({ value: o.value ?? '', label: o.label ?? o.value ?? '' }));
  });

  public selectTarget(key: string): void {
    // Changer de champ vide les valeurs : celles de l'ancien champ ne veulent rien dire pour le nouveau.
    this.changed.emit({ fieldKey: key ?? '', values: [] });
  }

  public toggle(value: string, checked: boolean): void {
    const current = this.values().filter((v) => v !== value);
    this.changed.emit({ fieldKey: this.fieldKey(), values: checked ? [...current, value] : current });
  }
}
