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
  templateUrl: 'consent-policy-editor.html',
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
