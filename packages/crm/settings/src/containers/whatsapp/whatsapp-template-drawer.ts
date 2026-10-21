import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, tap } from 'rxjs';
import {
  WhatsAppApiService,
  WhatsAppTemplateDto,
  WhatsAppVariableMappingDto,
  WhatsAppVariableMappingDtoFieldEnum,
} from '@sankore/crm-api';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTag } from '@talisoft/ui/tag';
import {
  splitTemplateText,
  TEMPLATE_CATEGORY_LABELS,
  templateStatusView,
  VARIABLE_FIELD_LABELS,
  VARIABLE_FIELD_OPTIONS,
  whatsAppErrorMessage,
} from './whatsapp-referential';

export interface WhatsAppTemplateDrawerData {
  template: WhatsAppTemplateDto;
  productOptions: { label: string; value: string }[];
}

class TemplateConfigFormModel {
  /** Vide = proposé pour tous les produits. */
  public productLineIds!: string[];
  /** Une entrée par variable, dans l'ordre `{{1}}…{{n}}`. Chaîne vide = l'agent saisit. */
  public variables!: string[];

  public static fromTemplate(dto: WhatsAppTemplateDto): TemplateConfigFormModel {
    const m = new TemplateConfigFormModel();
    m.productLineIds = [...(dto.productLineIds ?? [])];
    const count = Math.max(0, dto.variableCount ?? 0);
    const byIndex = new Map((dto.variableMappings ?? []).map((v) => [v.index, v.field]));
    m.variables = Array.from({ length: count }, (_, i) => byIndex.get(i + 1) ?? '');
    return m;
  }
}

/**
 * Paramétrage d'un template : produits pour lesquels il est proposé, et champ qui remplit
 * chaque variable. Le texte lui-même appartient à Meta et n'est pas modifiable ici ; l'aperçu
 * le montre tel que le client le recevra, chaque `{{n}}` portant le champ choisi.
 *
 * Les produits sont une liste de cases et non un `tas-multi-select` : celui-ci n'affiche pas
 * une sélection reçue par `writeValue` (son `SelectionModel` n'est alimenté que par les clics),
 * et le premier clic remplaçait alors silencieusement les produits déjà enregistrés.
 */
@Component({
  selector: 'whatsapp-template-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    Button,
    TasFormField,
    TasLabel,
    TasHint,
    TasSelect,
    TasTag,
    FormRoot,
    FormField,
  ],
  template: `
    <tas-side-drawer width="760px">
      <tas-drawer-title>
        <p class="text-base font-semibold text-slate-800">Paramétrer le template</p>
        <p class="text-xs text-slate-400 mt-0.5 font-mono">{{ template.name }}</p>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-6">
          <!-- Résumé -->
          <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <tas-tag [severity]="status.severity">{{ status.label }}</tas-tag>
            @if (template.isAvailable === false) {
              <tas-tag severity="neutral">Retiré</tas-tag>
            }
            <span>{{ categoryLabel }}</span>
            <span>·</span>
            <span>{{ template.language || '—' }}</span>
            <span>·</span>
            <span class="tabular-nums">{{ template.channelDisplayPhoneNumber || '—' }}</span>
          </div>

          @if (template.status !== 'Approved' || template.isAvailable === false) {
            <div class="p-3 rounded-lg bg-orange-50 border border-orange-200 text-sm text-slate-700">
              Ce template n’est pas proposé aux agents : seuls les templates approuvés par Meta et
              encore présents chez 360dialog le sont. Son paramétrage est conservé.
            </div>
          }

          <!-- Aperçu façon WhatsApp -->
          <div class="rounded-xl p-4" style="background:#e5ddd5">
            <div class="max-w-md bg-white rounded-lg rounded-tl-none shadow-sm p-3 text-sm text-slate-800">
              @if (headerSegments().length) {
                <p class="font-semibold mb-1">
                  @for (seg of headerSegments(); track $index) {
                    @if (seg.kind === 'variable') {
                      <span class="inline-block rounded-md px-1.5 py-0.5 text-xs font-medium align-baseline"
                        [class]="seg.label ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-600'">
                        {{ seg.text }}{{ seg.label ? ' · ' + seg.label : ' · saisi par l’agent' }}
                      </span>
                    } @else {<span class="whitespace-pre-wrap">{{ seg.text }}</span>}
                  }
                </p>
              }
              <p class="leading-relaxed">
                @for (seg of bodySegments(); track $index) {
                  @if (seg.kind === 'variable') {
                    <span class="inline-block rounded-md px-1.5 py-0.5 text-xs font-medium align-baseline"
                      [class]="seg.label ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-600'">
                      {{ seg.text }}{{ seg.label ? ' · ' + seg.label : ' · saisi par l’agent' }}
                    </span>
                  } @else {<span class="whitespace-pre-wrap">{{ seg.text }}</span>}
                }
              </p>
              @if (template.footerText) {
                <p class="text-xs text-slate-400 mt-2">{{ template.footerText }}</p>
              }
            </div>
            @if (template.buttons?.length) {
              <div class="max-w-md mt-1 flex flex-col gap-1">
                @for (label of template.buttons; track $index) {
                  <div class="bg-white rounded-full shadow-sm py-1.5 text-center text-sm font-medium" style="color:#00a5f4">
                    {{ label }}
                  </div>
                }
              </div>
            }
          </div>

          <form [formRoot]="formSchema" class="flex flex-col gap-6">
            <!-- Produits -->
            <div>
              <p class="text-sm font-semibold text-slate-700">Produits</p>
              <p class="text-xs text-slate-500 mt-0.5">
                Le template n’est proposé que sur les leads de ces produits. Aucun coché : proposé pour tous.
              </p>
              @if (productChoices().length === 0) {
                <p class="text-sm text-slate-500 mt-3">Aucun produit dans le catalogue.</p>
              } @else {
                <div class="mt-3 max-h-60 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                  @for (option of productChoices(); track option.value) {
                    <label class="flex items-center gap-3 px-3 py-2 text-sm text-slate-700 cursor-pointer hover:bg-slate-50">
                      <input
                        type="checkbox"
                        class="form-checkbox"
                        [checked]="isProductSelected(option.value)"
                        (change)="toggleProduct(option.value, $any($event.target).checked)"
                      />
                      {{ option.label }}
                    </label>
                  }
                </div>
              }
              <p class="text-xs text-slate-500 mt-2">
                {{ selectedProductCount() === 0 ? 'Proposé pour tous les produits.' : selectedProductCount() + ' produit(s) sélectionné(s).' }}
              </p>
            </div>

            <!-- Variables -->
            <div>
              <p class="text-sm font-semibold text-slate-700">Variables</p>
              @if (variableCount === 0) {
                <p class="text-sm text-slate-500 mt-1">Ce template n’a aucune variable.</p>
              } @else {
                <p class="text-xs text-slate-500 mt-0.5">
                  Le champ choisi est rempli automatiquement à l’envoi. Sans champ, l’agent saisit la valeur.
                </p>
                <div class="mt-3 flex flex-col gap-3">
                  @for (variable of formSchema.variables; track $index) {
                    <tas-form-field>
                      <tas-label>Variable {{ placeholderOf($index) }}</tas-label>
                      <tas-select
                        [options]="fieldOptions"
                        optionLabel="label"
                        optionValue="value"
                        placeholder="Aucun — l’agent saisit"
                        [formField]="variable"
                      ></tas-select>
                    </tas-form-field>
                  }
                </div>
                <tas-hint class="block mt-2">
                  « Produit demandé » reprend le produit du lead ; « Agent » désigne la personne qui envoie.
                </tas-hint>
              }
            </div>
          </form>
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
        <button
          tas-raised-button
          color="primary"
          type="button"
          (click)="handleSubmit()"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
        >
          Enregistrer
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class WhatsAppTemplateDrawer {
  public readonly data: WhatsAppTemplateDrawerData = inject(DIALOG_DATA);

  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(WhatsAppApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly template = this.data.template;
  public readonly status = templateStatusView(this.template.status);
  public readonly categoryLabel =
    TEMPLATE_CATEGORY_LABELS[this.template.category ?? ''] ?? (this.template.category || '—');
  public readonly variableCount = Math.max(0, this.template.variableCount ?? 0);
  public readonly fieldOptions = VARIABLE_FIELD_OPTIONS;

  public model = signal(TemplateConfigFormModel.fromTemplate(this.template));

  public formSchema = form(this.model);

  /**
   * Les produits connus, plus ceux déjà rattachés au template mais absents du catalogue
   * chargé (supprimés, ou catalogue en échec) : les taire les ferait disparaître à
   * l'enregistrement sans que personne l'ait décidé.
   */
  public readonly productChoices = computed(() => {
    const known = this.data.productOptions;
    const knownIds = new Set(known.map((o) => o.value));
    const orphans = (this.template.productLineIds ?? [])
      .filter((id) => !knownIds.has(id))
      .map((id) => ({ label: `Produit inconnu (${id.slice(0, 8)}…)`, value: id }));
    return [...known, ...orphans];
  });

  public readonly selectedProductCount = computed(
    () => this.formSchema.productLineIds().value().length,
  );

  private readonly _variables = computed(() => this.formSchema.variables().value());

  public readonly headerSegments = computed(() =>
    splitTemplateText(this.template.headerText, (i) => this._labelFor(i)),
  );

  public readonly bodySegments = computed(() =>
    splitTemplateText(this.template.bodyText, (i) => this._labelFor(i)),
  );

  /** `{{n}}` écrit depuis le code : en clair dans le template, Angular y verrait une interpolation. */
  public placeholderOf(position: number): string {
    return `{{${position + 1}}}`;
  }

  public isProductSelected(id: string): boolean {
    return this.formSchema.productLineIds().value().includes(id);
  }

  public toggleProduct(id: string, checked: boolean): void {
    const current = this.formSchema.productLineIds().value();
    const next = checked
      ? current.includes(id) ? current : [...current, id]
      : current.filter((value) => value !== id);
    this.formSchema.productLineIds().value.set(next);
    this.formSchema.productLineIds().markAsDirty();
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value || !this.template.id) return;

      const variableMappings: WhatsAppVariableMappingDto[] = value.variables
        .map((fieldName, i) => ({ index: i + 1, field: fieldName }))
        .filter((m) => !!m.field)
        .map((m) => ({ index: m.index, field: m.field as WhatsAppVariableMappingDtoFieldEnum }));

      let saved = false;
      await firstValueFrom(
        this._api
          .configureWhatsAppTemplate(this.template.id, {
            productLineIds: value.productLineIds,
            variableMappings,
          })
          .pipe(
            tap(() => {
              saved = true;
            }),
            catchError((err: unknown) => {
              this._snackbar.error(
                'Enregistrement refusé',
                whatsAppErrorMessage(err, 'Le paramétrage du template n’a pas pu être enregistré.'),
              );
              return EMPTY;
            }),
          ),
        { defaultValue: null },
      );

      if (!saved) return;

      this._snackbar.success('Template paramétré', 'Les agents verront ce paramétrage au prochain envoi.');
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close();
  }

  private _labelFor(index: number): string | null {
    const field = this._variables()[index - 1];
    return field ? (VARIABLE_FIELD_LABELS[field as WhatsAppVariableMappingDtoFieldEnum] ?? field) : null;
  }
}
