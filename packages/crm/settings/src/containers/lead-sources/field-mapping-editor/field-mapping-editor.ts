import { Component, inject, input, signal, output, OnInit, computed, effect } from '@angular/core';
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
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';

/** Empreinte d'une liste de regles, `_uid` (purement UI) exclu. */
function rulesSignature(rules: MappingRule[]): string {
  return JSON.stringify(
    rules.map(({ _uid, ...rest }) => rest),
  );
}

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
    TasHint,
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

  /**
   * Incrémenté par le parent quand le serveur refuse l'enregistrement. Sans ce signal,
   * l'enfant ne sait jamais que sa sauvegarde a échoué — le parent avale l'erreur — et
   * le bouton reste désactivé jusqu'à ce qu'un changement d'onglet détruise le composant.
   */
  public readonly saveFailedAt = input(0);
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

  /**
   * `PreviewMappingRequest` ne transporte que `samplePayloadJson` : le serveur
   * applique donc la correspondance PERSISTEE, jamais celle en cours d'edition.
   * On compare a `initialRules` (reactif : le parent recharge la source apres
   * l'enregistrement) pour prevenir l'utilisateur au lieu de lui laisser croire
   * qu'il teste ses modifications.
   */
  public readonly rulesChangedSinceSave = computed(
    () => rulesSignature(this.rules()) !== rulesSignature(this.initialRules()),
  );

  ngOnInit(): void {
    const initial = this.initialRules();
    if (initial.length > 0) {
      this.rules.set(initial.map((r) => ({ ...r, _uid: uid() })));
    }
  }

  // ——— Rule CRUD ———

  public addRule(): void {
    this.rules.update((list) => [...list, emptyRule()]);
    this._invalidatePreview();
  }

  public removeRule(index: number): void {
    this.rules.update((list) => list.filter((_, i) => i !== index));
    this._invalidatePreview();
  }

  public updateField(
    index: number,
    field: keyof MappingRule,
    value: any,
  ): void {
    this.rules.update((list) =>
      list.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    );
    this._invalidatePreview();
  }

  /**
   * Un resultat de previsualisation ne vaut que pour la correspondance qui l'a
   * produit. Le garder affiche apres une modification faisait passer l'ancienne
   * configuration pour la nouvelle.
   */
  private _invalidatePreview(): void {
    if (this.previewResult()) this.previewResult.set(null);
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
    this._invalidatePreview();
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
    this._invalidatePreview();
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
    this._invalidatePreview();
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
    // L'enregistrement est asynchrone chez le parent : sans ce verrou, un
    // double-clic envoyait deux PUT avec la meme version -> 409.
    this.isSaving.set(true);
    this.saved.emit(this.rules());
  }
}

export default FieldMappingEditor;
