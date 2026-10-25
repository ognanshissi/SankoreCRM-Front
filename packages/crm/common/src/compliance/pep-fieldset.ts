import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  FieldTree,
  FormField,
  schema,
  validate,
} from '@angular/forms/signals';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasSelect } from '@talisoft/ui/select';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSwitch } from '@talisoft/ui/switch';
import { PEP_LINK_OPTIONS } from './compliance-labels';
import { PepStatus, emptyPepStatus, pepFromDto } from './pep-wire';
import { CustomersPepStatusDto, LeadsPepStatusDto } from '@sankore/crm-api';

/**
 * Modèle de saisie du statut PPE. Distinct de `PepStatus` (le transport) parce
 * qu'un formulaire manipule des chaînes et jamais `null` — sinon `tas-select` et
 * `input` repartent de zéro à chaque tour.
 */
export class PepFormModel {
  public isPep!: boolean;
  public function!: string;
  public countryCode!: string;
  public functionEndDate!: string;
  public link!: string;

  public static fromDto(
    dto: LeadsPepStatusDto | CustomersPepStatusDto | null | undefined,
  ): PepFormModel {
    return PepFormModel.fromStatus(pepFromDto(dto));
  }

  public static fromStatus(status: PepStatus): PepFormModel {
    const m = new PepFormModel();
    m.isPep = status.isPep;
    m.function = status.function ?? '';
    m.countryCode = status.countryCode ?? '';
    m.functionEndDate = (status.functionEndDate ?? '').slice(0, 10);
    m.link = status.link ?? '';
    return m;
  }

  public static empty(): PepFormModel {
    return PepFormModel.fromStatus(emptyPepStatus());
  }
}

export function pepFormToStatus(model: PepFormModel): PepStatus {
  return {
    isPep: model.isPep,
    function: model.function?.trim() || null,
    countryCode: model.countryCode?.trim() || null,
    functionEndDate: model.functionEndDate || null,
    link: model.link || null,
    overrideReason: null,
  };
}

/**
 * Validation partagée du bloc PPE, à appliquer sur le sous-arbre correspondant :
 * `apply(formSchema.pep, pepSchema)`.
 *
 * `validate` plutôt que `required` : la fonction n'est obligatoire **que** si
 * l'interrupteur PPE est armé (BNF-F-04), et un `required` inconditionnel
 * rendrait invalide tout formulaire d'une personne non exposée.
 */
export const pepSchema = schema<PepFormModel>((path) => {
  validate(path.function, (ctx) => {
    const model = ctx.valueOf(path);
    if (model.isPep && !model.function?.trim()) {
      return { kind: 'pepFunctionRequired', message: 'La fonction est obligatoire pour une personne exposée' };
    }
    return null;
  });
});

/**
 * Bloc PPE d'une personne : interrupteur, fonction, pays, date de fin de
 * fonction et lien. Sans la permission de lecture du détail, seul le badge
 * d'exposition reste visible — l'écran ne doit pas révéler la fonction exercée.
 */
@Component({
  selector: 'pep-fieldset',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    FormField,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasDatePicker,
    TasSelect,
    TasIcon,
    TasSwitch,
  ],
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-medium text-slate-700">Personne politiquement exposée</p>
          <p class="text-xs text-slate-500">
            Exposition déclarée pour {{ subjectLabel() }}.
          </p>
        </div>
        <tas-switch
          [checked]="field().isPep().value()"
          [disabled]="readOnly()"
          [ariaLabel]="'Statut PPE de ' + subjectLabel()"
          (toggle)="field().isPep().value.set($event)"
        ></tas-switch>
      </div>

      @if (!canReadDetails()) {
        <p class="flex items-center gap-2 text-xs text-slate-500">
          <tas-icon iconName="feather:lock" style="font-size:12px"></tas-icon>
          Le détail de l'exposition PPE ne vous est pas accessible.
        </p>
      } @else if (field().isPep().value()) {
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <tas-form-field>
            <tas-label>Fonction <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" placeholder="Fonction exercée" [formField]="field().function" />
            @if (field().function().touched() && field().function().invalid()) {
              <tas-error>{{ field().function().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Pays</tas-label>
            <input tasInput type="text" placeholder="Code pays (ex. CI)" [formField]="field().countryCode" />
          </tas-form-field>

          <div>
            <tas-date-picker mode="date" [formField]="field().functionEndDate">Date de fin de fonction</tas-date-picker>
            <tas-hint>Laissez vide si la fonction est toujours exercée.</tas-hint>
          </div>

          <tas-form-field>
            <tas-label>Lien</tas-label>
            <tas-select
              [options]="linkOptions()"
              placeholder="Lien avec la personne exposée"
              [formField]="field().link"
            ></tas-select>
          </tas-form-field>
        </div>
      }
    </div>
  `,
})
export class PepFieldset {
  public readonly field = input.required<FieldTree<PepFormModel>>();
  public readonly subjectLabel = input<string>('cette personne');
  public readonly canReadDetails = input(true);
  public readonly readOnly = input(false);

  public readonly linkOptions = computed(() => [
    { label: 'Non précisé', value: '' },
    ...PEP_LINK_OPTIONS,
  ]);
}
