import { Component, computed, input, output, signal, effect, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';

// ——— Predefined fields per category ———

interface PredefinedField {
  key: string;
  label: string;
  type: 'number' | 'text';
  placeholder: string;
  unit?: string;
}

const CATEGORY_FIELDS: Record<string, PredefinedField[]> = {
  Loan: [
    { key: 'tauxInteret', label: 'Taux d\'intérêt', type: 'number', placeholder: '5.5', unit: '%' },
    { key: 'dureeMaxMois', label: 'Durée maximale', type: 'number', placeholder: '60', unit: 'mois' },
    { key: 'montantMin', label: 'Montant minimum', type: 'number', placeholder: '50000' },
    { key: 'montantMax', label: 'Montant maximum', type: 'number', placeholder: '10000000' },
    { key: 'devise', label: 'Devise', type: 'text', placeholder: 'XOF' },
    { key: 'fraisDossier', label: 'Frais de dossier', type: 'number', placeholder: '1.5', unit: '%' },
  ],
  Savings: [
    { key: 'tauxRemuneration', label: 'Taux de rémunération', type: 'number', placeholder: '3.5', unit: '%' },
    { key: 'plafond', label: 'Plafond du compte', type: 'number', placeholder: '5000000' },
    { key: 'montantMinOuverture', label: 'Montant min. ouverture', type: 'number', placeholder: '10000' },
    { key: 'frequenceInterets', label: 'Fréquence des intérêts', type: 'text', placeholder: 'Mensuel' },
    { key: 'devise', label: 'Devise', type: 'text', placeholder: 'XOF' },
  ],
  Tontine: [
    { key: 'nombreMembres', label: 'Nombre de membres', type: 'number', placeholder: '12' },
    { key: 'cycleSemaines', label: 'Durée du cycle', type: 'number', placeholder: '4', unit: 'semaines' },
    { key: 'contributionMontant', label: 'Contribution par cycle', type: 'number', placeholder: '25000' },
    { key: 'devise', label: 'Devise', type: 'text', placeholder: 'XOF' },
    { key: 'penaliteRetard', label: 'Pénalité de retard', type: 'number', placeholder: '5', unit: '%' },
  ],
};

const TYPE_OPTIONS = [
  { label: 'Texte', value: 'text' },
  { label: 'Nombre', value: 'number' },
];

// ——— Custom key-value pair ———

interface ParamEntry {
  key: string;
  value: string;
  type: 'text' | 'number';
  isPredefined: boolean;
}

@Component({
  selector: 'product-parameters-editor',
  standalone: true,
  imports: [FormsModule, TasCard, TasIcon, TasTag, Button, TasFormField, TasLabel, TasInput, TasSelect],
  template: `
    <!-- Predefined fields for category -->
    @if (predefinedFields().length > 0) {
      <div class="mb-3">
        <p class="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
          <tas-icon iconName="feather:sliders" style="font-size:11px"></tas-icon>
          Paramètres {{ categoryLabel() }}
        </p>
        <div class="grid grid-cols-2 gap-3">
          @for (field of predefinedFields(); track field.key) {
            <tas-form-field>
              <tas-label>{{ field.label }} @if (field.unit) { <span class="text-slate-400">({{ field.unit }})</span> }</tas-label>
              <input tasInput [type]="field.type" [placeholder]="field.placeholder"
                [ngModel]="getParamValue(field.key)" (ngModelChange)="setParamValue(field.key, $event, field.type)" />
            </tas-form-field>
          }
        </div>
      </div>
    }

    <!-- Custom key-value pairs -->
    <div>
      <div class="flex items-center justify-between mb-2">
        <p class="text-xs font-semibold text-slate-500 flex items-center gap-1">
          <tas-icon iconName="feather:plus-square" style="font-size:11px"></tas-icon>
          Paramètres personnalisés
        </p>
        <button type="button" class="text-xs text-primary hover:underline flex items-center gap-1" (click)="addCustomParam()">
          <tas-icon iconName="feather:plus" style="font-size:10px"></tas-icon> Ajouter
        </button>
      </div>

      @if (customParams().length === 0) {
        <p class="text-[10px] text-slate-400 mb-2">Aucun paramètre personnalisé. Cliquez sur « Ajouter » pour en créer.</p>
      } @else {
        <div class="flex flex-col gap-2">
          @for (param of customParams(); track $index; let i = $index) {
            <div class="flex items-end gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200">
              <tas-form-field class="flex-1">
                <tas-label>Clé</tas-label>
                <input tasInput type="text" placeholder="ex : fraisAnnuels"
                  [ngModel]="param.key" (ngModelChange)="updateCustomKey(i, $event)" />
              </tas-form-field>
              <tas-form-field class="flex-1">
                <tas-label>Valeur</tas-label>
                <input tasInput [type]="param.type" [placeholder]="param.type === 'number' ? '0' : 'valeur'"
                  [ngModel]="param.value" (ngModelChange)="updateCustomValue(i, $event)" />
              </tas-form-field>
              <div class="w-24 shrink-0">
                <tas-form-field>
                  <tas-label>Type</tas-label>
                  <tas-select [options]="typeOptions" optionLabel="label" optionValue="value"
                    [ngModel]="param.type" (ngModelChange)="updateCustomType(i, $event)"></tas-select>
                </tas-form-field>
              </div>
              <button type="button" class="text-slate-400 hover:text-red-500 transition-colors p-1 mb-1 shrink-0"
                (click)="removeCustomParam(i)">
                <tas-icon iconName="feather:trash-2" style="font-size:14px"></tas-icon>
              </button>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class ProductParametersEditor implements OnInit {
  /** Product category — drives predefined fields */
  public readonly category = input<string>('');
  /** Initial parametersJson string to parse */
  public readonly initialJson = input<string>('');
  /** Emitted whenever params change — serialized JSON string */
  public readonly parametersJsonChange = output<string>();

  public readonly typeOptions = TYPE_OPTIONS;

  // Internal state: all params as flat entries
  private _params = signal<ParamEntry[]>([]);

  public readonly predefinedFields = computed(() => CATEGORY_FIELDS[this.category()] ?? []);

  public readonly categoryLabel = computed(() => {
    switch (this.category()) {
      case 'Loan': return 'Prêt';
      case 'Savings': return 'Épargne';
      case 'Tontine': return 'Tontine';
      default: return '';
    }
  });

  public readonly customParams = computed(() => this._params().filter((p) => !p.isPredefined));

  constructor() {
    // Re-emit JSON whenever params change
    effect(() => {
      const params = this._params();
      const obj: Record<string, any> = {};
      for (const p of params) {
        if (!p.key.trim()) continue;
        obj[p.key] = p.type === 'number' && p.value !== '' ? Number(p.value) : p.value;
      }
      const json = Object.keys(obj).length > 0 ? JSON.stringify(obj) : '';
      this.parametersJsonChange.emit(json);
    });
  }

  ngOnInit(): void {
    this._parseInitialJson();
  }

  // ——— Predefined field accessors ———

  public getParamValue(key: string): string {
    return this._params().find((p) => p.key === key)?.value ?? '';
  }

  public setParamValue(key: string, value: string, type: 'text' | 'number'): void {
    this._params.update((list) => {
      const existing = list.find((p) => p.key === key);
      if (existing) {
        return list.map((p) => p.key === key ? { ...p, value } : p);
      }
      return [...list, { key, value, type, isPredefined: true }];
    });
  }

  // ——— Custom param CRUD ———

  public addCustomParam(): void {
    this._params.update((list) => [...list, { key: '', value: '', type: 'text', isPredefined: false }]);
  }

  public removeCustomParam(index: number): void {
    const customs = this._params().filter((p) => !p.isPredefined);
    const target = customs[index];
    if (!target) return;
    this._params.update((list) => list.filter((p) => p !== target));
  }

  public updateCustomKey(index: number, key: string): void {
    this._updateCustomAt(index, (p) => ({ ...p, key }));
  }

  public updateCustomValue(index: number, value: string): void {
    this._updateCustomAt(index, (p) => ({ ...p, value }));
  }

  public updateCustomType(index: number, type: string): void {
    this._updateCustomAt(index, (p) => ({ ...p, type: type as 'text' | 'number' }));
  }

  // ——— Private ———

  private _updateCustomAt(customIndex: number, fn: (p: ParamEntry) => ParamEntry): void {
    let ci = 0;
    this._params.update((list) =>
      list.map((p) => {
        if (p.isPredefined) return p;
        if (ci++ === customIndex) return fn(p);
        return p;
      }),
    );
  }

  private _parseInitialJson(): void {
    const json = this.initialJson();
    const predefinedKeys = new Set(this.predefinedFields().map((f) => f.key));
    let parsed: Record<string, any> = {};

    if (json) {
      try { parsed = JSON.parse(json); } catch { /* ignore */ }
    }

    const entries: ParamEntry[] = [];

    // Predefined fields first
    for (const field of this.predefinedFields()) {
      const val = parsed[field.key];
      entries.push({
        key: field.key,
        value: val != null ? String(val) : '',
        type: field.type,
        isPredefined: true,
      });
    }

    // Custom entries (keys not in predefined)
    for (const [key, val] of Object.entries(parsed)) {
      if (predefinedKeys.has(key)) continue;
      entries.push({
        key,
        value: val != null ? String(val) : '',
        type: typeof val === 'number' ? 'number' : 'text',
        isPredefined: false,
      });
    }

    this._params.set(entries);
  }
}
