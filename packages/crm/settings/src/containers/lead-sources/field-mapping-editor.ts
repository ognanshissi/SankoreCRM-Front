import { Component, inject, input, signal, output, OnInit, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { PreviewMappingResult } from '@sankore/crm-api';
import { LeadSourcesService } from './lead-sources.service';
import {
  MappingRule, MapEntry,
  LEAD_TARGET_FIELDS, TRANSFORMATION_OPTIONS, E164_COUNTRY_OPTIONS,
  emptyRule, missingRequiredFields, uid,
} from './field-mapping.types';

@Component({
  selector: 'field-mapping-editor',
  standalone: true,
  imports: [
    FormsModule,
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    Button,
    TasFormField,
    TasLabel,
    TasInput,
    TasSelect,
  ],
  template: `
    <div class="flex flex-col gap-4">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-semibold text-slate-700">
            Correspondance des champs
          </h2>
          <p class="text-xs text-slate-400 mt-0.5">
            Associez les champs reçus de la source aux champs du lead.
          </p>
        </div>
        <div class="flex items-center gap-2">
          @if (!readonly()) {
            <button tas-outlined-button type="button" (click)="addRule()">
              <tas-icon
                iconName="feather:plus"
                style="font-size:12px"
              ></tas-icon>
              Ajouter un champ
            </button>
          }
        </div>
      </div>

      <!-- Missing required fields warning -->
      @if (missingFields().length > 0) {
        <div
          class="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2"
        >
          <tas-icon
            iconName="feather:alert-triangle"
            class="text-amber-500 shrink-0 mt-0.5"
            style="font-size:14px"
          ></tas-icon>
          <div>
            <p class="text-xs font-medium text-amber-800">
              Champs obligatoires non mappés :
            </p>
            <p class="text-xs text-amber-700 mt-0.5">
              {{
                missingFields()
                  .map((f) => f.label)
                  .join(', ')
              }}
            </p>
          </div>
        </div>
      }

      <!-- Mapping rules -->
      @if (rules().length === 0) {
        <div
          class="flex flex-col items-center justify-center py-12 text-center"
        >
          <tas-icon
            iconName="feather:columns"
            class="text-slate-300 mb-2"
            style="font-size:28px"
          ></tas-icon>
          <p class="text-sm text-slate-400">Aucun champ configuré</p>
          @if (!readonly()) {
            <button
              tas-outlined-button
              type="button"
              class="mt-3"
              (click)="addRule()"
            >
              Ajouter un champ
            </button>
          }
        </div>
      } @else {
        <!-- Table header -->
        <div
          class="grid grid-cols-12 gap-2 px-3 py-2 bg-slate-50 rounded-t-lg text-xs font-medium text-slate-500"
        >
          <div class="col-span-3">Champ source</div>
          <div class="col-span-3">Champ du lead</div>
          <div class="col-span-3">Transformation</div>
          <div class="col-span-2">Valeur par défaut</div>
          <div class="col-span-1"></div>
        </div>

        @for (rule of rules(); track rule._uid; let i = $index) {
          <div
            class="border border-slate-200 rounded-lg p-3 flex flex-col gap-2 bg-slate-50 shadow"
          >
            <!-- Main row -->
            <div class="grid grid-cols-12 gap-2 items-start ">
              <!-- Source field -->
              <div class="col-span-3">
                <tas-form-field>
                  <input
                    tasInput
                    type="text"
                    [placeholder]="isJsonPath() ? '$.data.phone' : 'phone'"
                    [ngModel]="rule.sourceField"
                    (ngModelChange)="updateField(i, 'sourceField', $event)"
                    [disabled]="readonly()"
                  />
                </tas-form-field>
              </div>

              <!-- Target field (closed list) -->
              <div class="col-span-3">
                <tas-form-field>
                  <tas-select
                    [options]="targetFieldOptions"
                    optionLabel="label"
                    optionValue="key"
                    placeholder="Champ du lead"
                    [ngModel]="rule.targetField"
                    (ngModelChange)="updateField(i, 'targetField', $event)"
                    [disabled]="readonly()"
                  ></tas-select>
                  @if (isRequiredField(rule.targetField)) {
                    <span class="text-[10px] text-red-500">Obligatoire</span>
                  }
                </tas-form-field>
              </div>

              <!-- Transformation -->
              <div class="col-span-3">
                <tas-form-field>
                  <tas-select
                    [options]="transformationOptions"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="Aucune"
                    [ngModel]="rule.transformation"
                    (ngModelChange)="updateField(i, 'transformation', $event)"
                    [disabled]="readonly()"
                  ></tas-select>
                </tas-form-field>
              </div>

              <!-- Default value -->
              <div class="col-span-2">
                <tas-form-field>
                  <input
                    tasInput
                    type="text"
                    placeholder="—"
                    [ngModel]="rule.defaultValue"
                    (ngModelChange)="updateField(i, 'defaultValue', $event)"
                    [disabled]="readonly()"
                  />
                </tas-form-field>
              </div>

              <!-- Delete -->
              <div class="col-span-1 flex justify-end">
                @if (!readonly()) {
                  <button
                    tas-button
                    iconButton
                    type="button"
                    (click)="removeRule(i)"
                  >
                    <tas-icon
                      iconName="feather:trash-2"
                      class="text-red-400"
                      style="font-size:12px"
                    ></tas-icon>
                  </button>
                }
              </div>
            </div>

            <!-- E.164 country selector -->
            @if (rule.transformation === 'e164') {
              <div class="pl-3 border-l-2 border-blue-200 ml-1">
                <tas-form-field>
                  <tas-label>Pays par défaut</tas-label>
                  <tas-select
                    [options]="e164Countries"
                    optionLabel="label"
                    optionValue="value"
                    [ngModel]="rule.e164Country"
                    (ngModelChange)="updateField(i, 'e164Country', $event)"
                    [disabled]="readonly()"
                  ></tas-select>
                </tas-form-field>
              </div>
            }

            <!-- Map entries table -->
            @if (rule.transformation === 'map') {
              <div
                class="pl-3 border-l-2 border-purple-200 ml-1 flex flex-col gap-2"
              >
                <p class="text-xs font-medium text-slate-600">
                  Table de correspondance
                </p>
                @for (entry of rule.mapEntries; track $index; let j = $index) {
                  <div class="flex items-center gap-2">
                    <input
                      tasInput
                      type="text"
                      placeholder="Valeur source"
                      [ngModel]="entry.source"
                      (ngModelChange)="updateMapEntry(i, j, 'source', $event)"
                      [disabled]="readonly()"
                      class="flex-1"
                    />
                    <tas-icon
                      iconName="feather:arrow-right"
                      class="text-slate-300 shrink-0"
                      style="font-size:12px"
                    ></tas-icon>
                    <input
                      tasInput
                      type="text"
                      placeholder="Valeur cible"
                      [ngModel]="entry.target"
                      (ngModelChange)="updateMapEntry(i, j, 'target', $event)"
                      [disabled]="readonly()"
                      class="flex-1"
                    />
                    @if (!readonly()) {
                      <button
                        tas-icon-button
                        type="button"
                        (click)="removeMapEntry(i, j)"
                      >
                        <tas-icon
                          iconName="feather:x"
                          class="text-slate-400"
                          style="font-size:10px"
                        ></tas-icon>
                      </button>
                    }
                  </div>
                }
                @if (!readonly()) {
                  <button
                    tas-outlined-button
                    type="button"
                    class="self-start text-xs"
                    (click)="addMapEntry(i)"
                  >
                    <tas-icon
                      iconName="feather:plus"
                      style="font-size:10px"
                    ></tas-icon>
                    Ajouter une correspondance
                  </button>
                }
              </div>
            }

            <!-- Concat separator -->
            @if (rule.transformation === 'concat') {
              <div class="pl-3 border-l-2 border-green-200 ml-1">
                <tas-form-field>
                  <tas-label>Séparateur</tas-label>
                  <input
                    tasInput
                    type="text"
                    placeholder="espace"
                    [ngModel]="rule.concatSeparator"
                    (ngModelChange)="updateField(i, 'concatSeparator', $event)"
                    [disabled]="readonly()"
                  />
                </tas-form-field>
              </div>
            }
          </div>
        }
      }

      <!-- Preview section -->
      @if (!readonly()) {
        <tas-card class="block">
          <div
            class="p-4 border-b border-slate-100 flex items-center justify-between"
          >
            <div>
              <p
                class="text-sm font-semibold text-slate-700 flex items-center gap-2"
              >
                <tas-icon
                  iconName="feather:eye"
                  class="text-slate-400"
                  style="font-size:14px"
                ></tas-icon>
                Prévisualiser
              </p>
              <p class="text-xs text-slate-400 mt-0.5">
                Testez la correspondance avec un exemple de payload.
              </p>
            </div>
            <button
              tas-raised-button
              color="primary"
              type="button"
              [disabled]="isPreviewing() || !samplePayload()"
              [isLoading]="isPreviewing()"
              (click)="preview()"
            >
              <tas-icon
                iconName="feather:play"
                style="font-size:12px"
              ></tas-icon>
              Prévisualiser
            </button>
          </div>
          <div class="p-4">
            <tas-form-field>
              <tas-label>Exemple de payload (JSON)</tas-label>
              <textarea
                tasInput
                rows="5"
                placeholder='{"phone": "+2250700000000", "name": "Kouadio Jean"}'
                [ngModel]="samplePayload()"
                (ngModelChange)="samplePayload.set($event)"
                class="font-mono text-xs"
              ></textarea>
            </tas-form-field>
          </div>

          <!-- Preview result -->
          @if (previewResult()) {
            <div class="p-4 border-t border-slate-100">
              <div class="grid grid-cols-2 gap-4">
                <!-- Mapped lead -->
                <div>
                  <p class="text-xs font-medium text-slate-600 mb-2">
                    Lead résultant
                  </p>
                  <div class="bg-slate-50 rounded-lg p-3 space-y-1">
                    @for (entry of previewLeadEntries(); track entry[0]) {
                      <div class="flex items-center gap-2 text-xs">
                        <span
                          class="text-slate-500 font-medium w-28 shrink-0"
                          >{{ entry[0] }}</span
                        >
                        <span class="text-slate-800">{{ entry[1] }}</span>
                      </div>
                    }
                    @if (previewLeadEntries().length === 0) {
                      <p class="text-xs text-slate-400">Aucun champ mappé.</p>
                    }
                  </div>
                </div>

                <!-- Errors -->
                <div>
                  <p class="text-xs font-medium text-slate-600 mb-2">
                    Erreurs
                    @if (previewErrorCount() > 0) {
                      <tas-tag severity="error" class="ml-1">{{
                        previewErrorCount()
                      }}</tas-tag>
                    } @else {
                      <tas-tag severity="success" class="ml-1">0</tas-tag>
                    }
                  </p>
                  <div class="bg-slate-50 rounded-lg p-3 space-y-1">
                    @for (
                      err of previewResult()!.fieldErrors ?? [];
                      track $index
                    ) {
                      <div class="text-xs text-red-600 flex items-start gap-1">
                        <tas-icon
                          iconName="feather:x-circle"
                          class="shrink-0 mt-0.5"
                          style="font-size:10px"
                        ></tas-icon>
                        <span
                          ><strong>{{ err.jsonPath }}</strong> :
                          {{ err.message }}</span
                        >
                      </div>
                    }
                    @for (
                      err of previewResult()!.validationErrors ?? [];
                      track $index
                    ) {
                      <div
                        class="text-xs text-amber-600 flex items-start gap-1"
                      >
                        <tas-icon
                          iconName="feather:alert-triangle"
                          class="shrink-0 mt-0.5"
                          style="font-size:10px"
                        ></tas-icon>
                        <span
                          ><strong>{{ err.path }}</strong> :
                          {{ err.message }}</span
                        >
                      </div>
                    }
                    @if (
                      (previewResult()!.fieldErrors?.length ?? 0) === 0 &&
                      (previewResult()!.validationErrors?.length ?? 0) === 0
                    ) {
                      <p class="text-xs text-green-600">
                        Aucune erreur de transformation.
                      </p>
                    }
                  </div>
                </div>
              </div>
            </div>
          }
        </tas-card>
      }

      <!-- Save -->
      @if (!readonly()) {
        <div class="flex items-center justify-between">
          <div>
            @if (missingFields().length > 0) {
              <p class="text-xs text-amber-600">
                {{ missingFields().length }} champ(s) obligatoire(s) manquant(s)
              </p>
            }
          </div>
          <button
            tas-raised-button
            color="primary"
            type="button"
            [disabled]="isSaving() || missingFields().length > 0"
            [isLoading]="isSaving()"
            (click)="save()"
          >
            <tas-icon iconName="feather:save" style="font-size:14px"></tas-icon>
            Enregistrer la correspondance
          </button>
        </div>
      }
    </div>
  `,
})
export class FieldMappingEditor implements OnInit {
  private readonly _sourcesService = inject(LeadSourcesService);
  private readonly _snackbar = inject(SnackbarService);

  // Inputs
  public readonly sourceId = input.required<string>();
  public readonly mode = input<string | null>(null);
  public readonly readonly = input(false);
  public readonly initialRules = input<MappingRule[]>([]);

  // Outputs
  public readonly saved = output<MappingRule[]>();

  // State
  public rules = signal<MappingRule[]>([]);
  public samplePayload = signal('');
  public isPreviewing = signal(false);
  public isSaving = signal(false);
  public previewResult = signal<PreviewMappingResult | null>(null);

  // Options
  public readonly targetFieldOptions = LEAD_TARGET_FIELDS;
  public readonly transformationOptions = TRANSFORMATION_OPTIONS;
  public readonly e164Countries = E164_COUNTRY_OPTIONS;

  // Computed
  public readonly missingFields = computed(() =>
    missingRequiredFields(this.rules()),
  );

  public readonly isJsonPath = computed(() => {
    const m = this.mode();
    return m === 'ServerWebhook' || m === 'ScheduledPull';
  });

  public readonly previewLeadEntries = computed(() => {
    const mapped = this.previewResult()?.mappedLead;
    if (!mapped) return [];
    return Object.entries(mapped);
  });

  public readonly previewErrorCount = computed(() => {
    const r = this.previewResult();
    return (r?.fieldErrors?.length ?? 0) + (r?.validationErrors?.length ?? 0);
  });

  ngOnInit(): void {
    const initial = this.initialRules();
    if (initial.length > 0) {
      this.rules.set(initial.map((r) => ({ ...r, _uid: uid() })));
    }
  }

  // ——— Rule CRUD ———

  public addRule(): void {
    this.rules.update((list) => [...list, emptyRule()]);
  }

  public removeRule(index: number): void {
    this.rules.update((list) => list.filter((_, i) => i !== index));
  }

  public updateField(
    index: number,
    field: keyof MappingRule,
    value: any,
  ): void {
    this.rules.update((list) =>
      list.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    );
  }

  // ——— Map entries ———

  public addMapEntry(ruleIndex: number): void {
    this.rules.update((list) =>
      list.map((r, i) =>
        i === ruleIndex
          ? { ...r, mapEntries: [...r.mapEntries, { source: '', target: '' }] }
          : r,
      ),
    );
  }

  public removeMapEntry(ruleIndex: number, entryIndex: number): void {
    this.rules.update((list) =>
      list.map((r, i) =>
        i === ruleIndex
          ? {
              ...r,
              mapEntries: r.mapEntries.filter((_, j) => j !== entryIndex),
            }
          : r,
      ),
    );
  }

  public updateMapEntry(
    ruleIndex: number,
    entryIndex: number,
    field: keyof MapEntry,
    value: string,
  ): void {
    this.rules.update((list) =>
      list.map((r, i) => {
        if (i !== ruleIndex) return r;
        const entries = r.mapEntries.map((e, j) =>
          j === entryIndex ? { ...e, [field]: value } : e,
        );
        return { ...r, mapEntries: entries };
      }),
    );
  }

  public isRequiredField(key: string): boolean {
    return LEAD_TARGET_FIELDS.some((f) => f.key === key && f.required);
  }

  // ——— Preview ———

  public preview(): void {
    if (!this.samplePayload()) return;
    this.isPreviewing.set(true);
    this._sourcesService
      .previewMapping(this.sourceId(), {
        samplePayloadJson: this.samplePayload(),
      })
      .pipe(
        catchError(() => {
          this.isPreviewing.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.previewResult.set(result);
        this.isPreviewing.set(false);
      });
  }

  // ——— Save ———

  public save(): void {
    if (this.missingFields().length > 0) return;
    this.saved.emit(this.rules());
  }
}

export default FieldMappingEditor;
