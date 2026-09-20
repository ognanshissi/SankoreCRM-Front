import {
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  OnDestroy,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { TasFormField, TasLabel, TasError, TasHint } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasMultiSelect } from '@talisoft/ui/multi-select';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';

export interface DynamicFormSection {
  id: string;
  title: string;
  description?: string | null;
  order: number;
}

export interface DynamicFormQuestion {
  id: string;
  sectionId?: string | null;
  label: string;
  helpText?: string | null;
  placeholderText?: string | null;
  type: 'YesNo' | 'SingleChoice' | 'MultiChoice' | 'Numeric' | 'Text';
  options?: string[] | null;
  isRequired: boolean;
  order: number;
  minValue?: number | null;
  maxValue?: number | null;
  rules?: DynamicFormRule[] | null;
}

export interface DynamicFormRule {
  triggerQuestionId: string;
  triggerValue: string;
  action: 'Show' | 'Hide' | 'Require';
}

export interface DynamicFormSchema {
  sections: DynamicFormSection[];
  questions: DynamicFormQuestion[];
}

export interface DynamicFormAnswers {
  [questionId: string]: string | null;
}

interface SectionView {
  section: DynamicFormSection;
  questions: DynamicFormQuestion[];
}

@Component({
  selector: 'dynamic-form-renderer',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    TasMultiSelect,
    TasCheckbox,
    TasCard,
    TasIcon,
  ],
  template: `
    @for (sv of sectionViews(); track sv.section.id) {
      <tas-card class="mb-4 block">
        <div class="p-4 border-b border-slate-100">
          <p class="font-semibold text-slate-800">{{ sv.section.title }}</p>
          @if (sv.section.description) {
            <p class="text-sm text-slate-500 mt-0.5">{{ sv.section.description }}</p>
          }
        </div>
        <div class="p-4 flex flex-col gap-4">
          @for (q of sv.questions; track q.id) {
            @if (isVisible(q)) {
              <div>
                @switch (q.type) {
                  @case ('YesNo') {
                    <div class="flex items-center gap-3">
                      <tas-checkbox
                        [checked]="formGroup.get(q.id)?.value === 'true'"
                        (valueChange)="onCheckboxChange(q.id, $event)"
                      >
                        {{ q.label }}
                        @if (isFieldRequired(q)) {
                          <span class="text-red-500 ml-0.5">*</span>
                        }
                      </tas-checkbox>
                    </div>
                    @if (q.helpText) {
                      <p class="text-xs text-slate-400 mt-1 ml-6">{{ q.helpText }}</p>
                    }
                  }
                  @case ('SingleChoice') {
                    <tas-form-field appearance="outline">
                      <tas-label>
                        {{ q.label }}
                        @if (isFieldRequired(q)) {
                          <span class="text-red-500 ml-0.5">*</span>
                        }
                      </tas-label>
                      <tas-select
                        [options]="choiceOptions(q)"
                        optionLabel="label"
                        optionValue="value"
                        [placeholder]="q.placeholderText ?? 'Sélectionnez'"
                        [formControl]="$any(formGroup.get(q.id))"
                      ></tas-select>
                      @if (q.helpText) {
                        <tas-hint>{{ q.helpText }}</tas-hint>
                      }
                      @if (formGroup.get(q.id)?.touched && formGroup.get(q.id)?.hasError('required')) {
                        <tas-error>Ce champ est obligatoire</tas-error>
                      }
                    </tas-form-field>
                  }
                  @case ('MultiChoice') {
                    <tas-form-field appearance="outline">
                      <tas-label>
                        {{ q.label }}
                        @if (isFieldRequired(q)) {
                          <span class="text-red-500 ml-0.5">*</span>
                        }
                      </tas-label>
                      <tas-multi-select
                        [options]="choiceOptions(q)"
                        optionLabel="label"
                        optionValue="value"
                        [placeholder]="q.placeholderText ?? 'Sélectionnez'"
                        (click)="$event.stopPropagation()"
                        [formControl]="$any(formGroup.get(q.id))"
                      ></tas-multi-select>
                      @if (q.helpText) {
                        <tas-hint>{{ q.helpText }}</tas-hint>
                      }
                      @if (formGroup.get(q.id)?.touched && formGroup.get(q.id)?.hasError('required')) {
                        <tas-error>Ce champ est obligatoire</tas-error>
                      }
                    </tas-form-field>
                  }
                  @case ('Numeric') {
                    <tas-form-field appearance="outline">
                      <tas-label>
                        {{ q.label }}
                        @if (isFieldRequired(q)) {
                          <span class="text-red-500 ml-0.5">*</span>
                        }
                      </tas-label>
                      <input
                        tasInput
                        type="number"
                        [formControl]="$any(formGroup.get(q.id))"
                        [placeholder]="q.placeholderText ?? ''"
                        [min]="q.minValue ?? ''"
                        [max]="q.maxValue ?? ''"
                      />
                      @if (q.helpText) {
                        <tas-hint>{{ q.helpText }}</tas-hint>
                      }
                      @if (formGroup.get(q.id)?.touched && formGroup.get(q.id)?.hasError('required')) {
                        <tas-error>Ce champ est obligatoire</tas-error>
                      }
                      @if (formGroup.get(q.id)?.touched && formGroup.get(q.id)?.hasError('min')) {
                        <tas-error>La valeur minimale est {{ q.minValue }}</tas-error>
                      }
                      @if (formGroup.get(q.id)?.touched && formGroup.get(q.id)?.hasError('max')) {
                        <tas-error>La valeur maximale est {{ q.maxValue }}</tas-error>
                      }
                    </tas-form-field>
                  }
                  @default {
                    <!-- Text -->
                    <tas-form-field appearance="outline">
                      <tas-label>
                        {{ q.label }}
                        @if (isFieldRequired(q)) {
                          <span class="text-red-500 ml-0.5">*</span>
                        }
                      </tas-label>
                      <input
                        tasInput
                        type="text"
                        [formControl]="$any(formGroup.get(q.id))"
                        [placeholder]="q.placeholderText ?? ''"
                      />
                      @if (q.helpText) {
                        <tas-hint>{{ q.helpText }}</tas-hint>
                      }
                      @if (formGroup.get(q.id)?.touched && formGroup.get(q.id)?.hasError('required')) {
                        <tas-error>Ce champ est obligatoire</tas-error>
                      }
                    </tas-form-field>
                  }
                }
              </div>
            }
          }
        </div>
      </tas-card>
    }

    <!-- Unsectioned questions -->
    @if (unsectionedQuestions().length > 0) {
      <tas-card class="mb-4 block">
        <div class="p-4 flex flex-col gap-4">
          @for (q of unsectionedQuestions(); track q.id) {
            @if (isVisible(q)) {
              <div>
                @switch (q.type) {
                  @case ('YesNo') {
                    <div class="flex items-center gap-3">
                      <tas-checkbox
                        [checked]="formGroup.get(q.id)?.value === 'true'"
                        (valueChange)="onCheckboxChange(q.id, $event)"
                      >
                        {{ q.label }}
                        @if (isFieldRequired(q)) {
                          <span class="text-red-500 ml-0.5">*</span>
                        }
                      </tas-checkbox>
                    </div>
                    @if (q.helpText) {
                      <p class="text-xs text-slate-400 mt-1 ml-6">{{ q.helpText }}</p>
                    }
                  }
                  @case ('SingleChoice') {
                    <tas-form-field appearance="outline">
                      <tas-label>
                        {{ q.label }}
                        @if (isFieldRequired(q)) {
                          <span class="text-red-500 ml-0.5">*</span>
                        }
                      </tas-label>
                      <tas-select
                        [options]="choiceOptions(q)"
                        optionLabel="label"
                        optionValue="value"
                        [placeholder]="q.placeholderText ?? 'Sélectionnez'"
                        [formControl]="$any(formGroup.get(q.id))"
                      ></tas-select>
                      @if (q.helpText) {
                        <tas-hint>{{ q.helpText }}</tas-hint>
                      }
                      @if (formGroup.get(q.id)?.touched && formGroup.get(q.id)?.hasError('required')) {
                        <tas-error>Ce champ est obligatoire</tas-error>
                      }
                    </tas-form-field>
                  }
                  @case ('MultiChoice') {
                    <tas-form-field appearance="outline">
                      <tas-label>
                        {{ q.label }}
                        @if (isFieldRequired(q)) {
                          <span class="text-red-500 ml-0.5">*</span>
                        }
                      </tas-label>
                      <tas-multi-select
                        [options]="choiceOptions(q)"
                        optionLabel="label"
                        optionValue="value"
                        [placeholder]="q.placeholderText ?? 'Sélectionnez'"
                        (click)="$event.stopPropagation()"
                        [formControl]="$any(formGroup.get(q.id))"
                      ></tas-multi-select>
                      @if (q.helpText) {
                        <tas-hint>{{ q.helpText }}</tas-hint>
                      }
                      @if (formGroup.get(q.id)?.touched && formGroup.get(q.id)?.hasError('required')) {
                        <tas-error>Ce champ est obligatoire</tas-error>
                      }
                    </tas-form-field>
                  }
                  @case ('Numeric') {
                    <tas-form-field appearance="outline">
                      <tas-label>
                        {{ q.label }}
                        @if (isFieldRequired(q)) {
                          <span class="text-red-500 ml-0.5">*</span>
                        }
                      </tas-label>
                      <input
                        tasInput
                        type="number"
                        [formControl]="$any(formGroup.get(q.id))"
                        [placeholder]="q.placeholderText ?? ''"
                        [min]="q.minValue ?? ''"
                        [max]="q.maxValue ?? ''"
                      />
                      @if (q.helpText) {
                        <tas-hint>{{ q.helpText }}</tas-hint>
                      }
                      @if (formGroup.get(q.id)?.touched && formGroup.get(q.id)?.hasError('required')) {
                        <tas-error>Ce champ est obligatoire</tas-error>
                      }
                    </tas-form-field>
                  }
                  @default {
                    <tas-form-field appearance="outline">
                      <tas-label>
                        {{ q.label }}
                        @if (isFieldRequired(q)) {
                          <span class="text-red-500 ml-0.5">*</span>
                        }
                      </tas-label>
                      <input
                        tasInput
                        type="text"
                        [formControl]="$any(formGroup.get(q.id))"
                        [placeholder]="q.placeholderText ?? ''"
                      />
                      @if (q.helpText) {
                        <tas-hint>{{ q.helpText }}</tas-hint>
                      }
                      @if (formGroup.get(q.id)?.touched && formGroup.get(q.id)?.hasError('required')) {
                        <tas-error>Ce champ est obligatoire</tas-error>
                      }
                    </tas-form-field>
                  }
                }
              </div>
            }
          }
        </div>
      </tas-card>
    }
  `,
})
export class DynamicFormRendererComponent implements OnDestroy {
  public readonly schema = input.required<DynamicFormSchema>();
  public readonly initialAnswers = input<DynamicFormAnswers>({});

  public readonly answersChanged = output<DynamicFormAnswers>();

  public formGroup = new FormGroup<Record<string, FormControl>>({});

  /** Current answers derived from form state, updated reactively */
  public readonly currentAnswers = signal<DynamicFormAnswers>({});

  private _formSub: Subscription | null = null;
  private _choiceOptionsCache = new Map<string, { label: string; value: string }[]>();

  public readonly sectionViews = computed<SectionView[]>(() => {
    const s = this.schema();
    if (!s) return [];
    const sorted = [...(s.sections ?? [])].sort((a, b) => a.order - b.order);
    return sorted.map((section) => ({
      section,
      questions: (s.questions ?? [])
        .filter((q) => q.sectionId === section.id)
        .sort((a, b) => a.order - b.order),
    }));
  });

  public readonly unsectionedQuestions = computed<DynamicFormQuestion[]>(() => {
    const s = this.schema();
    if (!s) return [];
    const sectionIds = new Set((s.sections ?? []).map((sec) => sec.id));
    return (s.questions ?? [])
      .filter((q) => !q.sectionId || !sectionIds.has(q.sectionId))
      .sort((a, b) => a.order - b.order);
  });

  constructor() {
    effect(() => {
      const schema = this.schema();
      const initial = this.initialAnswers();
      this._buildFormGroup(schema, initial);
    });
  }

  ngOnDestroy(): void {
    this._formSub?.unsubscribe();
  }

  public isVisible(question: DynamicFormQuestion): boolean {
    const rules = question.rules;
    if (!rules?.length) return true;

    const answers = this.currentAnswers();

    for (const rule of rules) {
      const triggerVal = answers[rule.triggerQuestionId] ?? null;
      const matches = triggerVal === rule.triggerValue;

      if (rule.action === 'Show' && !matches) return false;
      if (rule.action === 'Hide' && matches) return false;
    }

    return true;
  }

  public isFieldRequired(question: DynamicFormQuestion): boolean {
    if (question.isRequired) return true;

    const rules = question.rules;
    if (!rules?.length) return false;

    const answers = this.currentAnswers();
    for (const rule of rules) {
      if (rule.action !== 'Require') continue;
      const triggerVal = answers[rule.triggerQuestionId] ?? null;
      if (triggerVal === rule.triggerValue) return true;
    }
    return false;
  }

  public choiceOptions(question: DynamicFormQuestion): { label: string; value: string }[] {
    const cached = this._choiceOptionsCache.get(question.id);
    if (cached) return cached;
    const opts = (question.options ?? []).map((o) => ({ label: o, value: o }));
    this._choiceOptionsCache.set(question.id, opts);
    return opts;
  }

  public onCheckboxChange(questionId: string, checked: boolean): void {
    this.formGroup.get(questionId)?.setValue(checked ? 'true' : 'false');
  }

  public getAnswers(): DynamicFormAnswers {
    const answers: DynamicFormAnswers = {};
    const schema = this.schema();
    for (const q of schema.questions ?? []) {
      if (!this.isVisible(q)) continue;
      const val = this.formGroup.get(q.id)?.value;
      if (val != null && val !== '') {
        answers[q.id] = Array.isArray(val) ? val.join(',') : String(val);
      }
    }
    return answers;
  }

  public isValid(): boolean {
    const schema = this.schema();
    for (const q of schema.questions ?? []) {
      if (!this.isVisible(q)) continue;
      if (this.isFieldRequired(q)) {
        const val = this.formGroup.get(q.id)?.value;
        if (val == null || val === '' || val === 'false') return false;
      }
      const ctrl = this.formGroup.get(q.id);
      if (ctrl?.invalid) return false;
    }
    return true;
  }

  public markAllTouched(): void {
    Object.values(this.formGroup.controls).forEach((c) => c.markAsTouched());
  }

  private _buildFormGroup(schema: DynamicFormSchema, initial: DynamicFormAnswers): void {
    this._formSub?.unsubscribe();
    this._choiceOptionsCache.clear();

    const controls: Record<string, FormControl> = {};
    for (const q of schema.questions ?? []) {
      const initVal = initial[q.id] ?? (q.type === 'MultiChoice' ? [] : '');
      const validators = [];

      if (q.isRequired) validators.push(Validators.required);
      if (q.type === 'Numeric') {
        if (q.minValue != null) validators.push(Validators.min(q.minValue));
        if (q.maxValue != null) validators.push(Validators.max(q.maxValue));
      }

      controls[q.id] = new FormControl(initVal, validators);
    }

    this.formGroup = new FormGroup(controls);
    this.currentAnswers.set(this._snapshotAnswers());

    this._formSub = this.formGroup.valueChanges.subscribe(() => {
      const snap = this._snapshotAnswers();
      this.currentAnswers.set(snap);
      this.answersChanged.emit(snap);
    });
  }

  private _snapshotAnswers(): DynamicFormAnswers {
    const snap: DynamicFormAnswers = {};
    const raw = this.formGroup.getRawValue();
    for (const [key, val] of Object.entries(raw)) {
      if (val != null && val !== '') {
        snap[key] = Array.isArray(val) ? val.join(',') : String(val);
      }
    }
    return snap;
  }
}
