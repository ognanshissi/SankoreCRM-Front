import { Component, inject, input, output, signal, computed, OnInit, OnChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';

/**
 * FE-08 — Consent policy types
 */
export type ConsentPolicy = 'CollectedByForm' | 'ProviderAttested' | 'LegitimateInterest' | 'None';

export interface ConsentConfig {
  policy: ConsentPolicy;
  consentFieldPath: string;
  consentTextVersion: string;
  providerContractRef: string;
}

export function emptyConsentConfig(): ConsentConfig {
  return {
    policy: 'None',
    consentFieldPath: '',
    consentTextVersion: '',
    providerContractRef: '',
  };
}

const POLICY_OPTIONS: { label: string; value: ConsentPolicy }[] = [
  { value: 'CollectedByForm', label: 'Collecté par le formulaire' },
  { value: 'ProviderAttested', label: 'Attesté par le fournisseur' },
  { value: 'LegitimateInterest', label: 'Intérêt légitime' },
  { value: 'None', label: 'Aucun' },
];

const POLICY_DESCRIPTIONS: Record<ConsentPolicy, string> = {
  CollectedByForm: 'Le consentement est obtenu via une case à cocher dans le formulaire.',
  ProviderAttested: 'Le fournisseur atteste avoir obtenu le consentement du prospect.',
  LegitimateInterest: 'Le traitement est fondé sur l\'intérêt légitime de l\'organisation.',
  None: 'Aucune politique de consentement configurée.',
};

@Component({
  selector: 'consent-policy-editor',
  standalone: true,
  imports: [
    FormsModule, TasCard, TasIcon, TasTag, Button,
    TasFormField, TasLabel, TasInput, TasSelect,
  ],
  template: `
    <div class="flex flex-col gap-4 max-w-3xl">
      <!-- Info banner -->
      <div class="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2">
        <tas-icon iconName="feather:shield" class="text-blue-500 shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
        <div>
          <p class="text-xs font-medium text-blue-800">Obligation de consentement explicite</p>
          <p class="text-xs text-blue-600 mt-0.5">
            Chaque lead doit disposer d'une base légale pour le traitement de ses données personnelles.
          </p>
        </div>
      </div>

      <!-- Policy selection -->
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100">
          <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <tas-icon iconName="feather:check-square" class="text-slate-400" style="font-size:14px"></tas-icon>
            Politique de consentement
          </p>
        </div>
        <div class="p-4">
          @if (isEmbeddedScript()) {
            <div class="p-3 bg-slate-50 rounded-lg mb-4">
              <p class="text-xs text-slate-600">
                <tas-icon iconName="feather:info" class="text-slate-400 inline-block mr-1" style="font-size:12px"></tas-icon>
                En mode <strong>Script embarqué</strong>, la politique est fixée à
                <strong>Collecté par le formulaire</strong>.
              </p>
            </div>
          } @else {
            <tas-form-field>
              <tas-label>Politique</tas-label>
              <tas-select
                [options]="policyOptions"
                optionLabel="label" optionValue="value"
                placeholder="Sélectionnez une politique"
                [ngModel]="config().policy"
                (ngModelChange)="updatePolicy($event)"
                [disabled]="readonly()"
              ></tas-select>
            </tas-form-field>
            @if (selectedPolicyDescription()) {
              <p class="text-xs text-slate-400 mt-2">{{ selectedPolicyDescription() }}</p>
            }
          }
        </div>
      </tas-card>

      <!-- CollectedByForm fields -->
      @if (config().policy === 'CollectedByForm') {
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700">Configuration du consentement formulaire</p>
          </div>
          <div class="p-4 flex flex-col gap-4">
            <tas-form-field>
              <tas-label>Champ de consentement <span class="text-red-500">*</span></tas-label>
              <input tasInput type="text"
                     [placeholder]="isJsonPath() ? '$.consent' : 'consent_given'"
                     [ngModel]="config().consentFieldPath"
                     (ngModelChange)="updateField('consentFieldPath', $event)"
                     [disabled]="readonly()" />
              <p class="text-xs text-slate-400 mt-1">
                Nom ou chemin du champ indiquant que le prospect a donné son consentement.
              </p>
            </tas-form-field>

            <tas-form-field>
              <tas-label>Version du texte de consentement</tas-label>
              <input tasInput type="text" placeholder="Ex : v2.1 — Sept. 2026"
                     [ngModel]="config().consentTextVersion"
                     (ngModelChange)="updateField('consentTextVersion', $event)"
                     [disabled]="readonly()" />
              <p class="text-xs text-slate-400 mt-1">
                Référence du texte présenté au prospect lors de la collecte.
              </p>
            </tas-form-field>

            @if (!config().consentFieldPath && !readonly()) {
              <div class="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                <tas-icon iconName="feather:alert-triangle" class="text-amber-500 shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
                <p class="text-xs text-amber-700">
                  Le champ de consentement est obligatoire. Sans lui, la source ne pourra pas être activée.
                </p>
              </div>
            }
          </div>
        </tas-card>
      }

      <!-- ProviderAttested fields -->
      @if (config().policy === 'ProviderAttested') {
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700">Attestation fournisseur</p>
          </div>
          <div class="p-4 flex flex-col gap-4">
            <tas-form-field>
              <tas-label>Référence du contrat fournisseur <span class="text-red-500">*</span></tas-label>
              <input tasInput type="text" placeholder="Ex : CTR-2026-042"
                     [ngModel]="config().providerContractRef"
                     (ngModelChange)="updateField('providerContractRef', $event)"
                     [disabled]="readonly()" />
              <p class="text-xs text-slate-400 mt-1">
                Numéro du contrat attestant que le fournisseur a obtenu le consentement.
              </p>
            </tas-form-field>

            @if (!config().providerContractRef && !readonly()) {
              <div class="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                <tas-icon iconName="feather:alert-triangle" class="text-amber-500 shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
                <p class="text-xs text-amber-700">
                  La référence du contrat est obligatoire pour cette politique.
                </p>
              </div>
            }
          </div>
        </tas-card>
      }

      <!-- Activation check -->
      @if (!readonly() && !canActivate()) {
        <div class="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <tas-icon iconName="feather:x-circle" class="text-red-500 shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
          <div>
            <p class="text-xs font-medium text-red-800">Activation impossible</p>
            <p class="text-xs text-red-600 mt-0.5">{{ activationBlockReason() }}</p>
          </div>
        </div>
      }

      <!-- Save -->
      @if (!readonly()) {
        <div class="flex justify-end">
          <button tas-raised-button color="primary" type="button"
                  [disabled]="isSaving()"
                  [isLoading]="isSaving()"
                  (click)="save()">
            <tas-icon iconName="feather:save" style="font-size:14px"></tas-icon>
            Enregistrer
          </button>
        </div>
      }
    </div>
  `,
})
export class ConsentPolicyEditor implements OnInit {
  // Inputs
  public readonly mode = input<string | null>(null);
  public readonly readonly = input(false);
  public readonly initialConfig = input<ConsentConfig | null>(null);

  // Outputs
  public readonly configSaved = output<ConsentConfig>();

  // State
  public config = signal<ConsentConfig>(emptyConsentConfig());
  public isSaving = signal(false);

  // Options
  public readonly policyOptions = POLICY_OPTIONS;

  // Computed
  public readonly isEmbeddedScript = computed(() => this.mode() === 'EmbeddedScript');
  public readonly isJsonPath = computed(() => {
    const m = this.mode();
    return m === 'ServerWebhook' || m === 'ScheduledPull';
  });

  public readonly selectedPolicyDescription = computed(() => {
    return POLICY_DESCRIPTIONS[this.config().policy] ?? '';
  });

  public readonly canActivate = computed(() => {
    const c = this.config();
    if (c.policy === 'None') return true;
    if (c.policy === 'CollectedByForm' && !c.consentFieldPath) return false;
    if (c.policy === 'ProviderAttested' && !c.providerContractRef) return false;
    return true;
  });

  public readonly activationBlockReason = computed(() => {
    const c = this.config();
    if (c.policy === 'CollectedByForm' && !c.consentFieldPath) {
      return 'Le champ de consentement doit être renseigné pour activer la source.';
    }
    if (c.policy === 'ProviderAttested' && !c.providerContractRef) {
      return 'La référence du contrat fournisseur est obligatoire pour activer la source.';
    }
    return '';
  });

  ngOnInit(): void {
    const initial = this.initialConfig();
    if (initial) {
      this.config.set({ ...initial });
    }
    // Force CollectedByForm for EmbeddedScript
    if (this.isEmbeddedScript()) {
      this.config.update((c) => ({ ...c, policy: 'CollectedByForm' }));
    }
  }

  public updatePolicy(policy: ConsentPolicy): void {
    this.config.update((c) => ({
      ...c,
      policy,
      consentFieldPath: policy !== 'CollectedByForm' ? '' : c.consentFieldPath,
      providerContractRef: policy !== 'ProviderAttested' ? '' : c.providerContractRef,
    }));
  }

  public updateField(field: keyof ConsentConfig, value: string): void {
    this.config.update((c) => ({ ...c, [field]: value }));
  }

  public save(): void {
    this.configSaved.emit(this.config());
  }
}

export default ConsentPolicyEditor;
