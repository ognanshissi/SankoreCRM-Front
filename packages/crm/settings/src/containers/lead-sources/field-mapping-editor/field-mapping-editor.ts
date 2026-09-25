import { Component, inject, input, signal, output, OnInit, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { LeadSourcesService } from '../lead-sources.service';
import {
  MappingRule, MapEntry,
  LEAD_TARGET_FIELDS, TRANSFORMATION_OPTIONS, E164_COUNTRY_OPTIONS,
  emptyRule, missingRequiredFields, isRequiredTargetField, uid,
} from '../field-mapping.types';
import { PreviewMappingResult } from '@sankore/crm-api';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';

@Component({
  selector: 'field-mapping-editor',
  standalone: true,
  imports: [
    FormsModule,
    TasCard,
    TasIcon,
    TasTag,
    Button,
    TasFormField,
    TasLabel,
    TasInput,
    TasSelect,
  ],
  templateUrl: './field-mapping-editor.html',
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
  public readonly missingFields = computed(() => missingRequiredFields(this.rules()));

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
    return isRequiredTargetField(key);
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
