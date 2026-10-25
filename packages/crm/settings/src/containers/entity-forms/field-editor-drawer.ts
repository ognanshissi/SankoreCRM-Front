import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  applyEach,
  disabled,
  form,
  FormField,
  FormRoot,
  maxLength,
  pattern,
  readonly,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { FormField as EntityFormField, FormFieldTypeEnum, FormSection } from '@sankore/crm-api';
import { TasTitle } from '@talisoft/ui/title';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasIcon } from '@talisoft/ui/icon';
import { ConditionPicker, ConditionValue } from './condition-picker';
import {
  CHOICE_TYPES,
  CONDITION_TARGET_TYPES,
  CUSTOM_FIELD_TYPES,
  CUSTOM_KEY_PATTERN,
  fieldTypeLabel,
  keyFromLabel,
  NUMERIC_TYPES,
  orderedSections,
  TEXT_TYPES,
} from './entity-forms.models';

export interface FieldEditorData {
  /** Null : nouveau champ personnalisé. */
  field: EntityFormField | null;
  /** La section où créer le champ (`''` = hors section). */
  defaultSectionKey: string;
  sections: FormSection[];
  fields: EntityFormField[];
  /** Les champs personnalisés connus du serveur : leur identifiant et leur type ne changent plus. */
  savedCustomKeys: string[];
}

interface OptionRow {
  value: string;
  label: string;
}

class FieldFormModel {
  public key!: string;
  public label!: string;
  public type!: string;
  public sectionKey!: string;
  public helpText!: string;
  public placeholder!: string;
  public quickAdd!: boolean;
  public isRequired!: boolean;
  public isHidden!: boolean;
  public isSensitive!: boolean;
  public options!: OptionRow[];
  public min!: string;
  public max!: string;
  public maxLength!: string;
  public pattern!: string;
  public defaultValue!: string;
  public conditionField!: string;
  public conditionValues!: string[];

  public static from(field: EntityFormField | null, defaultSectionKey: string): FieldFormModel {
    const m = new FieldFormModel();
    m.key = field?.key ?? '';
    m.label = field?.label ?? '';
    m.type = field?.type ?? FormFieldTypeEnum.Text;
    m.sectionKey = field ? field.sectionKey ?? '' : defaultSectionKey;
    m.helpText = field?.helpText ?? '';
    m.placeholder = field?.placeholder ?? '';
    m.quickAdd = field?.quickAdd ?? false;
    m.isRequired = field?.isRequired ?? false;
    m.isHidden = field?.isHidden ?? false;
    m.isSensitive = field?.isSensitive ?? false;
    m.options = (field?.options ?? []).map((o) => ({ value: o.value ?? '', label: o.label ?? '' }));
    m.min = field?.min?.toString() ?? '';
    m.max = field?.max?.toString() ?? '';
    m.maxLength = field?.maxLength?.toString() ?? '';
    m.pattern = field?.pattern ?? '';
    m.defaultValue = field?.defaultValue ?? '';
    m.conditionField = field?.visibleWhen?.fieldKey ?? '';
    m.conditionValues = [...(field?.visibleWhen?.values ?? [])];
    return m;
  }
}

const numberOrNull = (text: string): number | null => {
  const trimmed = text.trim().replace(',', '.');
  return trimmed === '' ? null : Number(trimmed);
};

const isNumberText = (text: string): boolean => text.trim() === '' || Number.isFinite(numberOrNull(text));

/**
 * Création et modification d'un champ. Comme le panneau de section, il ne parle pas au serveur :
 * le champ revient à l'éditeur, qui enregistre la mise en page entière.
 *
 * Un champ NATIF n'expose que ce que le serveur accepte d'un tenant — libellé, aide, section et
 * les trois drapeaux. Son type, ses options et sa condition appartiennent à l'entité ; les montrer
 * modifiables ferait croire à un réglage que le serveur ignore.
 */
@Component({
  selector: 'field-editor-drawer',
  templateUrl: './field-editor-drawer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle, Button,
    TasFormField, TasLabel, TasError, TasHint, TasInput, TasSelect, TasCheckbox, TasIcon, TasDatePicker,
    FormRoot, FormField, ConditionPicker,
  ],
})
export class FieldEditorDrawer {
  private readonly _dialogRef = inject(DialogRef<EntityFormField>);
  public readonly data: FieldEditorData = inject(DIALOG_DATA);

  public readonly original = this.data.field;
  public readonly isNew = this.original === null;
  public readonly isNative = this.original?.isNative ?? false;
  public readonly isLocked = this.original?.isRequiredLocked ?? false;
  /** Identifiant et type restent modifiables tant que le serveur n'a jamais vu ce champ. */
  public readonly isDraft = !this.isNative && !this.data.savedCustomKeys.includes(this.original?.key ?? '');

  public readonly typeOptions = CUSTOM_FIELD_TYPES.map((t) => ({ value: t.value, label: t.label }));
  public readonly sectionOptions = [
    { value: '', label: 'Hors section (Général)' },
    ...orderedSections(this.data.sections).map((s) => ({ value: s.key ?? '', label: s.title ?? s.key ?? '' })),
  ];
  public readonly fieldTypeLabel = fieldTypeLabel;

  public readonly model = signal(FieldFormModel.from(this.original, this.data.defaultSectionKey));

  private readonly _takenKeys = new Set(
    this.data.fields.map((f) => f.key ?? '').filter((k) => k && k !== this.original?.key),
  );

  public readonly formSchema = form(this.model, (schema) => {
    required(schema.label, { message: 'Le libellé est obligatoire' });
    maxLength(schema.label, 150, { message: '150 caractères au plus' });

    required(schema.key, { message: "L'identifiant est obligatoire", when: () => this.isDraft });
    pattern(schema.key, CUSTOM_KEY_PATTERN, {
      message: 'Lettres et chiffres, en commençant par une minuscule (ex. segmentClient)',
      when: () => this.isDraft,
    });
    validate(schema.key, (ctx) =>
      this.isDraft && this._takenKeys.has(ctx.value())
        ? { kind: 'duplicate', message: 'Un autre champ porte déjà cet identifiant' }
        : null,
    );

    validate(schema.options, (ctx) => {
      if (!this.isChoice(ctx.valueOf(schema.type)) || this.isNative) return null;
      const rows = ctx.value();
      if (rows.length === 0) return { kind: 'options', message: 'Ajoutez au moins une option' };
      const values = rows.map((r) => r.value.trim());
      if (new Set(values).size !== values.length) {
        return { kind: 'options', message: 'Deux options portent la même valeur' };
      }
      return null;
    });
    // Seulement pour un choix : des lignes laissées vides par un type abandonné, et qui ne
    // s'affichent plus, ne doivent pas bloquer l'enregistrement.
    const optionsApply = ({ valueOf }: { valueOf: (p: typeof schema.type) => string }) =>
      !this.isNative && this.isChoice(valueOf(schema.type));
    applyEach(schema.options, (row) => {
      required(row.value, { message: 'Valeur obligatoire', when: optionsApply });
      required(row.label, { message: 'Libellé obligatoire', when: optionsApply });
    });

    validate(schema.min, (ctx) => (isNumberText(ctx.value()) ? null : { kind: 'number', message: 'Nombre attendu' }));
    validate(schema.max, (ctx) => {
      if (!isNumberText(ctx.value())) return { kind: 'number', message: 'Nombre attendu' };
      const min = numberOrNull(ctx.valueOf(schema.min));
      const max = numberOrNull(ctx.value());
      return min !== null && max !== null && min > max
        ? { kind: 'range', message: 'Le maximum doit dépasser le minimum' }
        : null;
    });
    validate(schema.maxLength, (ctx) => {
      const n = numberOrNull(ctx.value());
      return n === null || (Number.isInteger(n) && n >= 1 && n <= 10000)
        ? null
        : { kind: 'length', message: 'Un entier entre 1 et 10 000' };
    });
    validate(schema.pattern, (ctx) => {
      if (!ctx.value().trim()) return null;
      try {
        new RegExp(ctx.value());
        return null;
      } catch {
        return { kind: 'pattern', message: "Cette expression régulière n'est pas valide" };
      }
    });
    validate(schema.conditionValues, (ctx) =>
      ctx.valueOf(schema.conditionField) && ctx.value().length === 0
        ? { kind: 'condition', message: 'Cochez au moins une valeur' }
        : null,
    );

    // Un champ exigé par l'application reste obligatoire, visible et en création rapide ; un champ
    // obligatoire est forcément en création rapide, sinon chaque création échouerait au serveur.
    readonly(schema.key, { when: () => !this.isDraft });
    disabled(schema.isRequired, { when: () => this.isLocked });
    disabled(schema.quickAdd, { when: ({ valueOf }) => this.isLocked || valueOf(schema.isRequired) });
    disabled(schema.isHidden, { when: ({ valueOf }) => this.isLocked || valueOf(schema.isRequired) });
  });

  public readonly type = computed(() => this.formSchema.type().value() as FormFieldTypeEnum);
  public readonly showOptions = computed(() => !this.isNative && this.isChoice(this.type()));
  public readonly showRange = computed(() => !this.isNative && NUMERIC_TYPES.includes(this.type()));
  public readonly showText = computed(() => !this.isNative && TEXT_TYPES.includes(this.type()));
  /** Pas de valeur par défaut pour un montant ni un choix multiple : le serveur la refuserait. */
  public readonly showDefault = computed(
    () =>
      !this.isNative &&
      this.type() !== FormFieldTypeEnum.Money &&
      this.type() !== FormFieldTypeEnum.MultiChoice,
  );

  public readonly conditionCandidates: EntityFormField[] = this.data.fields.filter(
    (f) => !f.isArchived && f.key !== this.original?.key && CONDITION_TARGET_TYPES.includes(f.type!),
  );

  /** La condition d'un champ natif, en clair : elle s'affiche mais ne se règle pas. */
  public readonly nativeCondition = computed(() => {
    const c = this.original?.visibleWhen;
    if (!this.isNative || !c?.fieldKey) return null;
    const target = this.data.fields.find((f) => f.key === c.fieldKey);
    const labels = (c.values ?? []).map((v) => target?.options?.find((o) => o.value === v)?.label ?? v);
    return `${target?.label ?? c.fieldKey} : ${labels.join(', ')}`;
  });

  private _lastAutoKey = this.model().key;

  constructor() {
    // L'identifiant suit le libellé tant que l'administrateur ne l'a pas retouché lui-même.
    effect(() => {
      const label = this.formSchema.label().value();
      if (!this.isDraft) return;
      const current = this.model().key;
      if (current !== this._lastAutoKey) return;
      const next = label.trim() ? keyFromLabel(label, this._takenKeys) : '';
      this._lastAutoKey = next;
      if (next !== current) this.model.update((m) => ({ ...m, key: next }));
    });

    // Obligatoire entraîne la création rapide, et un champ obligatoire n'est pas masqué.
    effect(() => {
      if (!this.formSchema.isRequired().value()) return;
      const m = this.model();
      if (!m.quickAdd || m.isHidden) this.model.update((x) => ({ ...x, quickAdd: true, isHidden: false }));
    });
  }

  public isChoice(type: string): boolean {
    return CHOICE_TYPES.includes(type as FormFieldTypeEnum);
  }

  public addOption(): void {
    this.formSchema.options().value.update((rows) => [...rows, { value: '', label: '' }]);
  }

  public removeOption(index: number): void {
    this.formSchema.options().value.update((rows) => rows.filter((_, i) => i !== index));
  }

  /** La valeur suit le libellé tant qu'elle est vide : c'est ce qu'on stocke, sans accent ni espace. */
  public fillOptionValue(index: number): void {
    this.formSchema.options().value.update((rows) =>
      rows.map((r, i) =>
        i === index && !r.value.trim() && r.label.trim()
          ? { ...r, value: keyFromLabel(r.label, new Set(rows.map((x) => x.value)), 'option') }
          : r,
      ),
    );
  }

  public setCondition(condition: ConditionValue): void {
    this.model.update((m) => ({ ...m, conditionField: condition.fieldKey, conditionValues: condition.values }));
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const v = field().value();
      const base: EntityFormField = this.original ?? {
        isNative: false,
        isRequiredLocked: false,
        isArchived: false,
        order: this.data.fields.filter((f) => (f.sectionKey ?? '') === v.sectionKey).length + 1,
      };

      const placement = {
        label: v.label.trim(),
        helpText: v.helpText.trim() || null,
        placeholder: v.placeholder.trim() || null,
        sectionKey: v.sectionKey || null,
        // Changer de section place le champ en dernier dans la nouvelle.
        order:
          (this.original?.sectionKey ?? '') === v.sectionKey && this.original
            ? this.original.order
            : this.data.fields.filter((f) => (f.sectionKey ?? '') === v.sectionKey).length + 1,
        isRequired: this.isLocked || v.isRequired,
        quickAdd: this.isLocked || v.isRequired || v.quickAdd,
        isHidden: !this.isLocked && !v.isRequired && v.isHidden,
      };

      if (this.isNative) {
        this._dialogRef.close({ ...base, ...placement });
        return;
      }

      const type = v.type as FormFieldTypeEnum;
      this._dialogRef.close({
        ...base,
        ...placement,
        isHidden: false,
        key: this.isDraft ? v.key : base.key,
        type: this.isDraft ? type : base.type,
        isSensitive: v.isSensitive,
        options: this.isChoice(type)
          ? v.options.map((o) => ({ value: o.value.trim(), label: o.label.trim() }))
          : null,
        min: NUMERIC_TYPES.includes(type) ? numberOrNull(v.min) : null,
        max: NUMERIC_TYPES.includes(type) ? numberOrNull(v.max) : null,
        maxLength: TEXT_TYPES.includes(type) ? numberOrNull(v.maxLength) : null,
        pattern: TEXT_TYPES.includes(type) && v.pattern.trim() ? v.pattern.trim() : null,
        // Le sélecteur de date rend null quand on l'efface.
        defaultValue: this.showDefault() && v.defaultValue?.trim() ? v.defaultValue.trim() : null,
        visibleWhen: v.conditionField ? { fieldKey: v.conditionField, values: v.conditionValues } : undefined,
      });
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}

export default FieldEditorDrawer;
