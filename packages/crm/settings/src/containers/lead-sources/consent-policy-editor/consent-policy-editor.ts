import { Component, inject, input, output, signal, computed, OnInit, OnChanges, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';

import {
  ConsentConfig,
  ConsentPolicy,
  emptyConsentConfig,
} from '../lead-source-settings.types';

// FE-01 : les types de consentement vivent dans le module de settings.
// Reexportes ici pour les consommateurs historiques de ce composant.
export type { ConsentConfig, ConsentPolicy };
export { emptyConsentConfig };

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
    TasFormField, TasLabel, TasHint, TasInput, TasSelect,
  ],
  templateUrl: 'consent-policy-editor.html',
})
export class ConsentPolicyEditor implements OnInit {
  // Inputs
  public readonly mode = input<string | null>(null);
  public readonly readonly = input(false);
  public readonly initialConfig = input<ConsentConfig | null>(null);
  /**
   * FE-08 AC3 — vrai s'il existe une regle de correspondance vers la cible
   * `consentGiven` avec un champ source renseigne. Le parent la calcule : en
   * mode pull ou webhook, le chemin saisi ici ne suffit pas, le consentement
   * doit reellement etre extrait du payload.
   */
  public readonly hasConsentMapping = input(false);

  // Outputs
  public readonly configSaved = output<ConsentConfig>();

  // State
  public config = signal<ConsentConfig>(emptyConsentConfig());
  public isSaving = signal(false);

  /**
   * Incrémenté par le parent quand le serveur refuse l'enregistrement. Sans ce signal,
   * l'enfant ne sait jamais que sa sauvegarde a échoué — le parent avale l'erreur — et
   * le bouton reste désactivé jusqu'à ce qu'un changement d'onglet détruise le composant.
   */
  public readonly saveFailedAt = input(0);

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
    // `None` decrit l'ABSENCE de base legale : la traiter comme un consentement
    // valide laissait activer une source sans aucune politique, d'autant que
    // c'est la valeur par defaut de `emptyConsentConfig()`.
    if (c.policy === 'None') return false;
    if (c.policy === 'CollectedByForm' && this.isJsonPath()) {
      // L'AC restreint l'exigence aux modes pull et webhook : en script
      // embarque, le SDK porte la case a cocher.
      if (!c.consentFieldPath?.trim()) return false;
      if (!this.hasConsentMapping()) return false;
    }
    if (c.policy === 'ProviderAttested' && !c.providerContractRef?.trim()) return false;
    return true;
  });

  /** Ce qui bloque l'activation bloque l'enregistrement (FE-08 AC3). */
  public readonly canSave = computed(() => this.canActivate());

  public readonly activationBlockReason = computed(() => {
    const c = this.config();
    if (c.policy === 'None') {
      return 'Aucune politique de consentement n\'est configurée : choisissez une base légale avant d\'enregistrer.';
    }
    if (c.policy === 'CollectedByForm' && this.isJsonPath()) {
      if (!c.consentFieldPath?.trim()) {
        return 'Le champ de consentement doit être renseigné pour activer la source.';
      }
      if (!this.hasConsentMapping()) {
        return 'Aucune règle ne mappe le consentement : ajoutez une correspondance vers « Consentement » dans l\'onglet « Correspondance des champs ».';
      }
    }
    if (c.policy === 'ProviderAttested' && !c.providerContractRef?.trim()) {
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
    // Le bouton desactive est une ergonomie, pas une securite : la garde reste
    // indispensable (clic clavier, changement d'etat entre-temps).
    if (!this.canSave()) return;
    // L'enregistrement est asynchrone chez le parent : sans ce verrou, un
    // double-clic envoyait deux PUT avec la meme version -> 409.
    this.isSaving.set(true);
    this.configSaved.emit(this.config());
  }
}

export default ConsentPolicyEditor;
