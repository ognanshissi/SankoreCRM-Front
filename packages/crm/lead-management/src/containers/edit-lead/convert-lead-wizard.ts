import { Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Router } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag, Severity } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import {
  TasSideDrawer,
  TasDrawerTitle,
  TasDrawerContent,
  TasDrawerAction,
} from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  LeadsApiService,
  LeadDto,
  ConvertLeadResult,
  DuplicateMatchResult,
} from '@sankore/crm-api';

export interface ConvertLeadWizardData {
  lead: LeadDto;
}

export interface ConvertLeadWizardResult {
  customerId: string;
}

type Step = 'eligibility' | 'duplicates' | 'confirm' | 'success';

interface EligibilityCheck {
  label: string;
  passed: boolean;
  detail: string;
}

function buildEligibilityChecks(lead: LeadDto): EligibilityCheck[] {
  const checks: EligibilityCheck[] = [];

  const status = lead.status ?? '';
  const isQualified = ['Qualified', 'Contacted'].includes(status);
  checks.push({
    label: 'Statut du lead',
    passed: isQualified,
    detail: isQualified
      ? `Statut actuel : ${status}`
      : `Le lead doit être au moins « Contacté » (actuellement : ${status || '—'})`,
  });

  const completeness = lead.qualificationCompleteness ?? 0;
  const qualOk = completeness >= 50;
  checks.push({
    label: 'Qualification',
    passed: qualOk,
    detail: qualOk
      ? `Qualification à ${completeness}%`
      : `Qualification insuffisante (${completeness}% — minimum 50% requis)`,
  });

  const hasIdentity = !!(lead.fullName || (lead.firstName && lead.lastName));
  checks.push({
    label: 'Identité',
    passed: hasIdentity,
    detail: hasIdentity ? 'Nom renseigné' : 'Le nom du lead doit être renseigné',
  });

  const hasContact = !!(lead.phoneNumber || lead.email);
  checks.push({
    label: 'Coordonnées',
    passed: hasContact,
    detail: hasContact ? 'Téléphone ou email renseigné' : 'Un téléphone ou email est requis',
  });

  return checks;
}

@Component({
  selector: 'convert-lead-wizard',
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
    TasIcon, TasSpinner, TasTag, Button, TasCard, TasTitle,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Convertir en client</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <!-- Stepper indicator -->
        <div class="flex items-center gap-2 mb-6">
          @for (s of steps; track s.key; let i = $index) {
            <div class="flex items-center gap-2">
              <div
                class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                [class]="stepIndex() > i
                  ? 'bg-green-100 text-green-700'
                  : stepIndex() === i
                    ? 'bg-primary/15 text-primary'
                    : 'bg-slate-100 text-slate-400'"
              >
                @if (stepIndex() > i) {
                  <tas-icon iconName="feather:check" style="font-size:12px"></tas-icon>
                } @else {
                  {{ i + 1 }}
                }
              </div>
              <span class="text-xs font-medium"
                [class]="stepIndex() >= i ? 'text-slate-700' : 'text-slate-400'">
                {{ s.label }}
              </span>
              @if (i < steps.length - 1) {
                <div class="w-6 h-px" [class]="stepIndex() > i ? 'bg-green-300' : 'bg-slate-200'"></div>
              }
            </div>
          }
        </div>

        <!-- ===== STEP 1: Eligibility ===== -->
        @if (currentStep() === 'eligibility') {
          <tas-card class="block">
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">Vérification d'éligibilité</p>
              <p class="text-xs text-slate-400 mt-0.5">Conditions requises avant conversion.</p>
            </div>
            <div class="p-4 flex flex-col gap-3">
              @for (check of eligibilityChecks(); track check.label) {
                <div class="flex items-start gap-3">
                  <div
                    class="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    [class]="check.passed ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'"
                  >
                    <tas-icon
                      [iconName]="check.passed ? 'feather:check' : 'feather:x'"
                      style="font-size:10px"
                    ></tas-icon>
                  </div>
                  <div>
                    <p class="text-sm font-medium" [class]="check.passed ? 'text-slate-800' : 'text-red-700'">
                      {{ check.label }}
                    </p>
                    <p class="text-xs" [class]="check.passed ? 'text-slate-400' : 'text-red-500'">
                      {{ check.detail }}
                    </p>
                  </div>
                </div>
              }
            </div>
          </tas-card>

          @if (!isEligible()) {
            <div class="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2">
              <tas-icon iconName="feather:alert-circle" class="text-red-500 shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
              <p class="text-xs text-red-700">
                Ce lead ne remplit pas toutes les conditions requises pour la conversion.
                Complétez les éléments manquants avant de continuer.
              </p>
            </div>
          }
        }

        <!-- ===== STEP 2: Duplicate check ===== -->
        @if (currentStep() === 'duplicates') {
          @if (isCheckingDuplicates()) {
            <div class="flex flex-col items-center justify-center py-12">
              <tas-spinner size="8" class="text-primary mb-3"></tas-spinner>
              <p class="text-sm text-slate-500">Recherche de doublons client…</p>
            </div>
          } @else if (duplicates().length > 0) {
            <tas-card class="block mb-4">
              <div class="p-4 border-b border-slate-100">
                <div class="flex items-center gap-2">
                  <tas-icon iconName="feather:alert-triangle" class="text-amber-500" style="font-size:16px"></tas-icon>
                  <p class="text-sm font-semibold text-amber-800">{{ duplicates().length }} doublon(s) détecté(s)</p>
                </div>
                <p class="text-xs text-amber-700 mt-1">
                  Vous pouvez rattacher ce lead à un client existant ou continuer la création.
                </p>
              </div>
              <div class="divide-y divide-slate-100">
                @for (dup of duplicates(); track dup.leadId) {
                  <div class="p-4 flex items-center gap-3">
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium text-slate-800">{{ dup.fullName ?? '—' }}</p>
                      <div class="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                        @if (dup.phoneNumber) { <span>{{ dup.phoneNumber }}</span> }
                        @if (dup.email) { <span>{{ dup.email }}</span> }
                        @if (dup.confidenceScore) {
                          <tas-tag [severity]="dup.confidenceScore >= 80 ? 'error' : 'warning'">
                            {{ dup.confidenceScore }}% similaire
                          </tas-tag>
                        }
                      </div>
                    </div>
                    <button
                      tas-outlined-button
                      color="primary"
                      type="button"
                      class="text-xs shrink-0"
                      (click)="attachToExisting(dup)"
                    >
                      Rattacher
                    </button>
                  </div>
                }
              </div>
            </tas-card>
            <button
              type="button"
              class="text-xs text-primary hover:underline"
              (click)="currentStep.set('confirm')"
            >
              Ignorer les doublons et créer un nouveau client →
            </button>
          } @else {
            <tas-card class="block">
              <div class="p-4 flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center">
                  <tas-icon iconName="feather:check-circle" class="text-green-500" style="font-size:20px"></tas-icon>
                </div>
                <div>
                  <p class="text-sm font-semibold text-slate-800">Aucun doublon détecté</p>
                  <p class="text-xs text-slate-400">Vous pouvez continuer la conversion.</p>
                </div>
              </div>
            </tas-card>
          }
        }

        <!-- ===== STEP 3: Confirm ===== -->
        @if (currentStep() === 'confirm') {
          <tas-card class="block mb-4">
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">Récapitulatif</p>
            </div>
            <div class="p-4 flex flex-col gap-2">
              <div class="flex justify-between text-sm">
                <span class="text-slate-500">Nom</span>
                <span class="font-medium text-slate-800">{{ leadDisplayName() }}</span>
              </div>
              @if (data.lead.phoneNumber) {
                <div class="flex justify-between text-sm">
                  <span class="text-slate-500">Téléphone</span>
                  <span class="text-slate-800">{{ data.lead.phoneNumber }}</span>
                </div>
              }
              @if (data.lead.email) {
                <div class="flex justify-between text-sm">
                  <span class="text-slate-500">Email</span>
                  <span class="text-slate-800">{{ data.lead.email }}</span>
                </div>
              }
              @if (data.lead.nationalId) {
                <div class="flex justify-between text-sm">
                  <span class="text-slate-500">Pièce d'identité</span>
                  <span class="text-slate-800">{{ data.lead.nationalId }}</span>
                </div>
              }
              @if (attachedCustomerId()) {
                <div class="mt-2 p-2.5 rounded-lg bg-blue-50 border border-blue-200 flex items-center gap-2">
                  <tas-icon iconName="feather:link" class="text-blue-500" style="font-size:14px"></tas-icon>
                  <p class="text-xs text-blue-700">
                    Rattachement au client existant <span class="font-mono font-medium">{{ attachedCustomerId() }}</span>
                  </p>
                </div>
              } @else {
                <div class="mt-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-2">
                  <tas-icon iconName="feather:user-plus" class="text-slate-500" style="font-size:14px"></tas-icon>
                  <p class="text-xs text-slate-600">Un nouveau dossier client sera créé avec les données du lead.</p>
                </div>
              }
            </div>
          </tas-card>

          @if (conversionError()) {
            <div class="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2">
              <tas-icon iconName="feather:alert-circle" class="text-red-500 shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
              <p class="text-xs text-red-700">{{ conversionError() }}</p>
            </div>
          }
        }

        <!-- ===== STEP 4: Success ===== -->
        @if (currentStep() === 'success') {
          <div class="flex flex-col items-center justify-center py-8 text-center">
            <div class="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mb-4">
              <tas-icon iconName="feather:check-circle" class="text-green-500" style="font-size:32px"></tas-icon>
            </div>
            <h2 class="text-lg font-semibold text-slate-800 mb-1">Conversion réussie</h2>
            <p class="text-sm text-slate-500 mb-4">
              Le lead a été converti en client avec succès.
            </p>
            @if (conversionResult()?.customerId) {
              <button
                tas-button
                color="primary"
                type="button"
                (click)="goToCustomer()"
              >
                <tas-icon iconName="feather:external-link" style="font-size:14px"></tas-icon>
                Voir le dossier client
              </button>
              <button
                type="button"
                class="text-xs text-primary hover:underline mt-3"
                (click)="close()"
              >
                Retour à la fiche lead
              </button>
            }
          </div>
        }
      </tas-drawer-content>

      <tas-drawer-action>
        @if (currentStep() !== 'success') {
          <div class="flex items-center justify-between w-full">
            <button tas-outlined-button type="button" (click)="onBack()">
              {{ currentStep() === 'eligibility' ? 'Annuler' : 'Retour' }}
            </button>
            @if (currentStep() === 'confirm') {
              <button
                tas-raised-button
                color="primary"
                type="button"
                [disabled]="isConverting()"
                (click)="executeConversion()"
              >
                @if (isConverting()) {
                  <tas-spinner size="3" class="text-white"></tas-spinner>
                }
                Confirmer la conversion
              </button>
            } @else {
              <button
                tas-raised-button
                color="primary"
                type="button"
                [disabled]="!canAdvance()"
                (click)="onNext()"
              >
                Suivant
              </button>
            }
          </div>
        }
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ConvertLeadWizard {
  public readonly data: ConvertLeadWizardData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<ConvertLeadWizardResult | false>);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _router = inject(Router);
  private readonly _snackbar = inject(SnackbarService);

  public readonly steps = [
    { key: 'eligibility' as Step, label: 'Éligibilité' },
    { key: 'duplicates' as Step, label: 'Doublons' },
    { key: 'confirm' as Step, label: 'Confirmation' },
    { key: 'success' as Step, label: 'Terminé' },
  ];

  public currentStep = signal<Step>('eligibility');
  public isCheckingDuplicates = signal(false);
  public isConverting = signal(false);
  public duplicates = signal<DuplicateMatchResult[]>([]);
  public attachedCustomerId = signal<string | null>(null);
  public conversionResult = signal<ConvertLeadResult | null>(null);
  public conversionError = signal<string | null>(null);

  public readonly eligibilityChecks = computed(() => buildEligibilityChecks(this.data.lead));
  public readonly isEligible = computed(() => this.eligibilityChecks().every((c) => c.passed));

  public readonly stepIndex = computed(() => {
    const idx = this.steps.findIndex((s) => s.key === this.currentStep());
    return idx >= 0 ? idx : 0;
  });

  public readonly canAdvance = computed(() => {
    switch (this.currentStep()) {
      case 'eligibility': return this.isEligible();
      case 'duplicates':  return !this.isCheckingDuplicates();
      default: return true;
    }
  });

  public leadDisplayName(): string {
    const l = this.data.lead;
    if (l.fullName) return l.fullName;
    const parts = [l.firstName, l.lastName].filter(Boolean);
    return parts.length ? parts.join(' ') : l.phoneNumber ?? l.email ?? 'Lead';
  }

  public onNext(): void {
    switch (this.currentStep()) {
      case 'eligibility':
        if (!this.isEligible()) return;
        this.currentStep.set('duplicates');
        this._checkDuplicates();
        break;
      case 'duplicates':
        this.currentStep.set('confirm');
        break;
    }
  }

  public onBack(): void {
    switch (this.currentStep()) {
      case 'eligibility': this.close(); break;
      case 'duplicates':  this.currentStep.set('eligibility'); break;
      case 'confirm':     this.currentStep.set('duplicates'); break;
    }
  }

  public attachToExisting(dup: DuplicateMatchResult): void {
    this.attachedCustomerId.set(dup.leadId ?? null);
    this.currentStep.set('confirm');
  }

  public executeConversion(): void {
    if (this.isConverting()) return; // Prevent double submission

    this.isConverting.set(true);
    this.conversionError.set(null);

    this._leadsApi.convertLead(this.data.lead.id!, {
      customerId: this.attachedCustomerId() ?? undefined,
      force: !!this.attachedCustomerId(),
    }).pipe(
      catchError((err) => {
        const msg = err?.error?.detail ?? err?.error?.title ?? 'La conversion a échoué. Veuillez réessayer.';
        this.conversionError.set(msg);
        this.isConverting.set(false);
        return EMPTY;
      }),
    ).subscribe((result) => {
      this.isConverting.set(false);
      this.conversionResult.set(result);

      if (result.duplicateDetected && (result.potentialDuplicates?.length ?? 0) > 0) {
        // Server found duplicates — go back to duplicates step
        this.duplicates.set(result.potentialDuplicates ?? []);
        this.currentStep.set('duplicates');
        this._snackbar.info('Doublons détectés', 'Le serveur a identifié des clients similaires.');
      } else {
        this.currentStep.set('success');
        this._snackbar.success('Conversion réussie', 'Le lead a été converti en client.');
      }
    });
  }

  public goToCustomer(): void {
    const customerId = this.conversionResult()?.customerId;
    this._dialogRef.close({ customerId: customerId! });
    // Navigate — adapt route when customer module exists
    this._router.navigate(['/leads', this.data.lead.id]);
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private _checkDuplicates(): void {
    this.isCheckingDuplicates.set(true);
    this.duplicates.set([]);

    const lead = this.data.lead;
    this._leadsApi.findLeadDuplicates(
      lead.phoneNumber ?? undefined,
      lead.email ?? undefined,
      lead.nationalId ?? undefined,
      lead.customerReference ?? undefined,
      lead.fullName ?? undefined,
    ).pipe(
      catchError(() => {
        this.isCheckingDuplicates.set(false);
        return EMPTY;
      }),
    ).subscribe((results) => {
      // Exclude self
      const filtered = (results ?? []).filter((d) => d.leadId !== lead.id);
      this.duplicates.set(filtered);
      this.isCheckingDuplicates.set(false);
    });
  }
}
