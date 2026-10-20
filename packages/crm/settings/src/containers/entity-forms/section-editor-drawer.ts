import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, maxLength, required, submit, validate } from '@angular/forms/signals';
import { FormField as EntityFormField, FormSection } from '@sankore/crm-api';
import { TasTitle } from '@talisoft/ui/title';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { TasIcon } from '@talisoft/ui/icon';
import { ConditionPicker, ConditionValue } from './condition-picker';
import { CONDITION_TARGET_TYPES, keyFromLabel } from './entity-forms.models';

export interface SectionEditorData {
  /** Null : nouvelle section. */
  section: FormSection | null;
  sections: FormSection[];
  fields: EntityFormField[];
}

class SectionFormModel {
  public title!: string;
  public description!: string;
  public quickAdd!: boolean;
  public conditionField!: string;
  public conditionValues!: string[];

  public static from(section: FormSection | null): SectionFormModel {
    const m = new SectionFormModel();
    m.title = section?.title ?? '';
    m.description = section?.description ?? '';
    m.quickAdd = section?.quickAdd ?? false;
    m.conditionField = section?.visibleWhen?.fieldKey ?? '';
    m.conditionValues = [...(section?.visibleWhen?.values ?? [])];
    return m;
  }
}

/**
 * Création et modification d'une section. Ne parle pas au serveur : la section revient à l'éditeur,
 * qui enregistre la mise en page entière d'un seul coup — c'est ce que le serveur attend.
 */
@Component({
  selector: 'section-editor-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle, Button,
    TasFormField, TasLabel, TasError, TasInput, TasCheckbox, TasIcon,
    FormRoot, FormField, ConditionPicker,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <TasTitle class="text-lg">{{ data.section ? 'Modifier la section' : 'Nouvelle section' }}</TasTitle>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <tas-form-field>
            <tas-label>Titre <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" placeholder="Ex : Situation professionnelle" [formField]="formSchema.title" />
            @if (formSchema.title().touched() && formSchema.title().invalid()) {
              <tas-error>{{ formSchema.title().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Description</tas-label>
            <textarea tasInput rows="2" placeholder="Affichée sous le titre" [formField]="formSchema.description"></textarea>
          </tas-form-field>

          <div class="rounded-lg border border-slate-200 p-4">
            <tas-checkbox [formField]="formSchema.quickAdd">Afficher le titre dans la création rapide</tas-checkbox>
            <p class="text-xs text-slate-500 mt-1.5 ml-6">
              Chaque champ choisit lui-même s'il figure dans la création rapide. Sans titre, ceux de cette
              section y apparaissent simplement sans en-tête.
            </p>
          </div>

          <div class="rounded-lg border border-slate-200 p-4">
            <form-condition-picker
              [candidates]="conditionCandidates"
              [fieldKey]="formSchema.conditionField().value()"
              [values]="formSchema.conditionValues().value()"
              (changed)="setCondition($event)"
            ></form-condition-picker>
          </div>
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button type="button" (click)="close()">
          <tas-icon iconName="feather:x"></tas-icon> &nbsp; Annuler
        </button>
        <button tas-raised-button color="primary" type="button" (click)="handleSubmit()"
                [disabled]="formSchema().invalid()">
          <tas-icon iconName="feather:check"></tas-icon> &nbsp;
          {{ data.section ? 'Appliquer' : 'Ajouter la section' }}
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class SectionEditorDrawer {
  private readonly _dialogRef = inject(DialogRef<FormSection>);
  public readonly data: SectionEditorData = inject(DIALOG_DATA);

  public readonly model = signal(SectionFormModel.from(this.data.section));

  public readonly formSchema = form(this.model, (schema) => {
    required(schema.title, { message: 'Le titre est obligatoire' });
    maxLength(schema.title, 100, { message: '100 caractères au plus' });
    validate(schema.conditionValues, (ctx) =>
      ctx.valueOf(schema.conditionField) && ctx.value().length === 0
        ? { kind: 'condition', message: 'Cochez au moins une valeur' }
        : null,
    );
  });

  public readonly conditionCandidates: EntityFormField[] = this.data.fields.filter(
    (f) => !f.isArchived && CONDITION_TARGET_TYPES.includes(f.type!),
  );

  private readonly _takenKeys = computed(
    () => new Set(this.data.sections.map((s) => s.key ?? '').filter((k) => k !== this.data.section?.key)),
  );

  public setCondition(condition: ConditionValue): void {
    this.model.update((m) => ({ ...m, conditionField: condition.fieldKey, conditionValues: condition.values }));
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const v = field().value();
      const section: FormSection = {
        key: this.data.section?.key ?? keyFromLabel(v.title, this._takenKeys(), 'section'),
        title: v.title.trim(),
        description: v.description.trim() || null,
        quickAdd: v.quickAdd,
        order: this.data.section?.order ?? this.data.sections.length + 1,
        visibleWhen: v.conditionField ? { fieldKey: v.conditionField, values: v.conditionValues } : undefined,
      };
      this._dialogRef.close(section);
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}

export default SectionEditorDrawer;
