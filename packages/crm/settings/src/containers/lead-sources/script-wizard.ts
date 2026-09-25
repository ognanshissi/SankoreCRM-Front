import { Component, computed, input, output, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSwitch } from '@talisoft/ui/switch';

/**
 * FE-10 — Assistant « Formulaire de mon site »
 * Multi-step wizard: Site → Formulaire → Protection → Après envoi
 */

import { isValidOrigin, originHint } from './lead-source-validators';
import {
  CaptchaProvider,
  ScriptConfig,
  defaultScriptConfig,
} from './lead-source-settings.types';

// FE-01 : la forme de `settings.script` vit dans le module de settings.
export type { ScriptConfig, CaptchaProvider };
export { defaultScriptConfig };

const CAPTCHA_OPTIONS: { label: string; value: CaptchaProvider }[] = [

  { label: 'Aucun', value: 'None' },
  { label: 'Cloudflare Turnstile', value: 'Turnstile' },
  { label: 'hCaptcha', value: 'HCaptcha' },
  { label: 'reCAPTCHA v3', value: 'RecaptchaV3' },
];

const AFTER_SUBMIT_OPTIONS = [
  { label: 'Afficher un message', value: 'message' },
  { label: 'Rediriger vers une URL', value: 'redirect' },
];

@Component({
  selector: 'script-wizard',
  standalone: true,
  imports: [
    FormsModule, TasCard, TasIcon, TasTag, Button,
    TasFormField, TasLabel, TasInput, TasSelect, TasSwitch,
  ],
  template: `
    <div class="max-w-3xl flex flex-col gap-4">
      <!-- Step indicator -->
      <div class="flex items-center gap-2 mb-2">
        @for (s of steps; track s.id; let i = $index) {
          <button class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                  [class]="currentStep() === i
                    ? 'bg-primary text-white'
                    : i < currentStep() ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'"
                  (click)="currentStep.set(i)">
            @if (i < currentStep()) {
              <tas-icon iconName="feather:check" style="font-size:10px"></tas-icon>
            }
            {{ s.label }}
          </button>
          @if (i < steps.length - 1) {
            <div class="w-6 h-px bg-slate-300"></div>
          }
        }
      </div>

      <!-- Step 1: Site -->
      @if (currentStep() === 0) {
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <tas-icon iconName="feather:globe" class="text-slate-400" style="font-size:14px"></tas-icon>
              Domaines autorisés
            </p>
            <p class="text-xs text-slate-400 mt-0.5">
              Seules les origines listées pourront utiliser le script. Format : https://www.exemple.ci
            </p>
          </div>
          <div class="p-4 flex flex-col gap-3">
            @for (origin of config().allowedOrigins; track $index; let i = $index) {
              <div class="flex items-center gap-2">
                <tas-form-field class="flex-1">
                  <input tasInput type="url" placeholder="https://www.exemple.ci"
                         [ngModel]="origin" (ngModelChange)="updateOrigin(i, $event)"
                         [disabled]="readonly()" />
                </tas-form-field>
                @if (!readonly() && config().allowedOrigins.length > 1) {
                  <button tas-icon-button type="button" (click)="removeOrigin(i)">
                    <tas-icon iconName="feather:x" class="text-red-400" style="font-size:12px"></tas-icon>
                  </button>
                }
              </div>
            }
            @if (!readonly()) {
              <button tas-outlined-button type="button" class="self-start text-xs" (click)="addOrigin()">
                <tas-icon iconName="feather:plus" style="font-size:10px"></tas-icon>
                Ajouter un domaine
              </button>
            }
            @if (invalidOrigins().length > 0) {
              <p class="text-xs text-red-500">
                {{ originHintText() }}
              </p>
            }
          </div>
        </tas-card>
      }

      <!-- Step 2: Formulaire -->
      @if (currentStep() === 1) {
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <tas-icon iconName="feather:layout" class="text-slate-400" style="font-size:14px"></tas-icon>
              Formulaire
            </p>
          </div>
          <div class="p-4 flex flex-col gap-4">
            <div class="flex gap-3">
              <button class="flex-1 p-3 rounded-lg border-2 text-left transition-colors"
                      [class]="config().formMode === 'existing' ? 'border-primary bg-primary/5' : 'border-slate-200'"
                      (click)="updateConfig('formMode', 'existing')">
                <p class="text-sm font-medium text-slate-800">J'ai déjà un formulaire</p>
                <p class="text-xs text-slate-400 mt-0.5">Je veux capter les soumissions d'un formulaire existant.</p>
              </button>
              <button class="flex-1 p-3 rounded-lg border-2 text-left transition-colors"
                      [class]="config().formMode === 'hosted' ? 'border-primary bg-primary/5' : 'border-slate-200'"
                      (click)="updateConfig('formMode', 'hosted')">
                <p class="text-sm font-medium text-slate-800">Créer le formulaire pour moi</p>
                <p class="text-xs text-slate-400 mt-0.5">Le script affichera un formulaire défini dans le CRM.</p>
              </button>
            </div>

            @if (config().formMode === 'existing') {
              <tas-form-field>
                <tas-label>Sélecteur CSS du formulaire <span class="text-red-500">*</span></tas-label>
                <input tasInput type="text" placeholder="#contact-form, .lead-form, form[name='contact']"
                       [ngModel]="config().formSelector"
                       (ngModelChange)="updateConfig('formSelector', $event)"
                       [disabled]="readonly()" />
                <p class="text-xs text-slate-400 mt-1">
                  Exemples : <code class="bg-slate-100 px-1 rounded">#contact-form</code>,
                  <code class="bg-slate-100 px-1 rounded">.lead-form</code>,
                  <code class="bg-slate-100 px-1 rounded">form[name="contact"]</code>
                </p>
              </tas-form-field>

              <!-- FE-10 AC2 — noms des champs du formulaire existant -->
              <tas-form-field>
                <tas-label>Noms des champs du formulaire</tas-label>
                <input tasInput type="text" placeholder="nom, email, telephone, message"
                       [ngModel]="config().formFieldNames"
                       (ngModelChange)="updateConfig('formFieldNames', $event)"
                       [disabled]="readonly()" />
                <p class="text-xs text-slate-400 mt-1">
                  Attribut <code class="bg-slate-100 px-1 rounded">name</code> de chaque champ, séparés par des virgules.
                  Ils alimentent la correspondance des champs ; laissez vide pour envoyer tout le formulaire.
                </p>
              </tas-form-field>
            }
          </div>
        </tas-card>
      }

      <!-- Step 3: Protection -->
      @if (currentStep() === 2) {
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <tas-icon iconName="feather:shield" class="text-slate-400" style="font-size:14px"></tas-icon>
              Protection anti-robot
            </p>
          </div>
          <div class="p-4 flex flex-col gap-4">
            <tas-form-field>
              <tas-label>Captcha</tas-label>
              <tas-select
                [options]="captchaOptions"
                optionLabel="label" optionValue="value"
                [ngModel]="config().captchaProvider"
                (ngModelChange)="updateConfig('captchaProvider', $event)"
                [disabled]="readonly()"
              ></tas-select>
            </tas-form-field>

            @if (config().captchaProvider !== 'None') {
              <tas-form-field>
                <tas-label>Clé de site (site key)</tas-label>
                <input tasInput type="text" placeholder="Clé publique du captcha"
                       [ngModel]="config().captchaSiteKey"
                       (ngModelChange)="updateConfig('captchaSiteKey', $event)"
                       [disabled]="readonly()" />
              </tas-form-field>
            }

            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-slate-700">Honeypot</p>
                <p class="text-xs text-slate-400">Champ invisible pour piéger les bots. Activé par défaut.</p>
              </div>
              <tas-switch
                [checked]="config().honeypot"
                (toggle)="updateConfig('honeypot', $event)"
                [disabled]="readonly()"
              ></tas-switch>
            </div>

            <tas-form-field>
              <tas-label>Délai minimal de saisie (secondes)</tas-label>
              <input tasInput type="number" placeholder="3"
                     [ngModel]="config().minFillTimeSeconds"
                     (ngModelChange)="updateConfig('minFillTimeSeconds', $event)"
                     [disabled]="readonly()" />
              <p class="text-xs text-slate-400 mt-1">Soumissions plus rapides seront rejetées. 3 secondes par défaut.</p>
            </tas-form-field>
          </div>
        </tas-card>
      }

      <!-- Step 4: Après envoi -->
      @if (currentStep() === 3) {
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <tas-icon iconName="feather:check-circle" class="text-slate-400" style="font-size:14px"></tas-icon>
              Après envoi
            </p>
          </div>
          <div class="p-4 flex flex-col gap-4">
            <tas-form-field>
              <tas-label>Comportement après envoi</tas-label>
              <tas-select
                [options]="afterSubmitOptions"
                optionLabel="label" optionValue="value"
                [ngModel]="config().afterSubmit"
                (ngModelChange)="updateConfig('afterSubmit', $event)"
                [disabled]="readonly()"
              ></tas-select>
            </tas-form-field>

            @if (config().afterSubmit === 'message') {
              <tas-form-field>
                <tas-label>Message de confirmation</tas-label>
                <input tasInput type="text"
                       [ngModel]="config().successMessage"
                       (ngModelChange)="updateConfig('successMessage', $event)"
                       [disabled]="readonly()" />
              </tas-form-field>
            }

            @if (config().afterSubmit === 'redirect') {
              <tas-form-field>
                <tas-label>URL de redirection</tas-label>
                <input tasInput type="url" placeholder="https://www.exemple.ci/merci"
                       [ngModel]="config().redirectUrl"
                       (ngModelChange)="updateConfig('redirectUrl', $event)"
                       [disabled]="readonly()" />
              </tas-form-field>
            }

            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-slate-700">Conserver le comportement d'origine</p>
                <p class="text-xs text-slate-400">Le formulaire effectue aussi son envoi natif (action HTTP).</p>
              </div>
              <tas-switch
                [checked]="!config().preventDefaultSubmit"
                (toggle)="updateConfig('preventDefaultSubmit', !$event)"
                [disabled]="readonly()"
              ></tas-switch>
            </div>
          </div>
        </tas-card>
      }

      <!-- Navigation -->
      <div class="flex items-center justify-between">
        <div>
          @if (currentStep() > 0) {
            <button tas-outlined-button type="button" (click)="currentStep.update(s => s - 1)">
              <tas-icon iconName="feather:arrow-left" style="font-size:12px"></tas-icon>
              Précédent
            </button>
          }
        </div>
        <div class="flex items-center gap-2">
          @if (currentStep() < steps.length - 1) {
            <button tas-raised-button color="primary" type="button"
                    [disabled]="!canProceed()"
                    (click)="currentStep.update(s => s + 1)">
              Suivant
              <tas-icon iconName="feather:arrow-right" style="font-size:12px"></tas-icon>
            </button>
          } @else if (!readonly()) {
            <button tas-raised-button color="primary" type="button"
                    [disabled]="!canProceed()"
                    (click)="onSave()">
              <tas-icon iconName="feather:save" style="font-size:14px"></tas-icon>
              Enregistrer
            </button>
          }
        </div>
      </div>
    </div>
  `,
})
export class ScriptWizard implements OnInit {
  public readonly initialConfig = input<ScriptConfig | null>(null);
  public readonly readonly = input(false);
  public readonly saved = output<ScriptConfig>();

  public config = signal<ScriptConfig>(defaultScriptConfig());
  public currentStep = signal(0);

  public readonly steps = [
    { id: 'site', label: 'Site' },
    { id: 'form', label: 'Formulaire' },
    { id: 'protection', label: 'Protection' },
    { id: 'after', label: 'Après envoi' },
  ];

  public readonly captchaOptions = CAPTCHA_OPTIONS;
  /** Statut de la source : conditionne l'acceptation de http://localhost. */
  public readonly sourceStatus = input<string | null>(null);
  public readonly afterSubmitOptions = AFTER_SUBMIT_OPTIONS;

  ngOnInit(): void {
    const initial = this.initialConfig();
    if (initial) this.config.set({ ...initial });
  }

  public updateConfig(field: keyof ScriptConfig, value: any): void {
    this.config.update((c) => ({ ...c, [field]: value }));
  }

  public addOrigin(): void {
    this.config.update((c) => ({ ...c, allowedOrigins: [...c.allowedOrigins, ''] }));
  }

  public removeOrigin(index: number): void {
    this.config.update((c) => ({
      ...c,
      allowedOrigins: c.allowedOrigins.filter((_, i) => i !== index),
    }));
  }

  public updateOrigin(index: number, value: string): void {
    this.config.update((c) => ({
      ...c,
      allowedOrigins: c.allowedOrigins.map((o, i) => i === index ? value : o),
    }));
  }

  /**
   * FE-10 AC1 — `http://localhost` n'est accepte qu'en statut « Test » : une
   * source active ne doit pas accepter de soumissions depuis un poste de dev.
   */
  public readonly allowsLocalhost = computed(() => this.sourceStatus() === 'Testing');

  public readonly originHintText = computed(() =>
    originHint({ allowLocalhost: this.allowsLocalhost() }),
  );

  public invalidOrigins(): string[] {
    const rules = { allowLocalhost: this.allowsLocalhost() };
    return this.config().allowedOrigins.filter(
      (o) => !!o && !isValidOrigin(o, rules),
    );
  }

  public canProceed(): boolean {
    const c = this.config();
    switch (this.currentStep()) {
      case 0:
        return c.allowedOrigins.some((o) => !!o) && this.invalidOrigins().length === 0;
      case 1:
        return c.formMode === 'hosted' || !!c.formSelector;
      case 2:
        return c.captchaProvider === 'None' || !!c.captchaSiteKey;
      case 3:
        return c.afterSubmit === 'message' ? !!c.successMessage : !!c.redirectUrl;
      default:
        return true;
    }
  }

  public onSave(): void {
    this.saved.emit(this.config());
  }
}

export default ScriptWizard;
