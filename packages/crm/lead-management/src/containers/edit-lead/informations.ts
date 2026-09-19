import { Component, effect, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { LeadsApiService, LeadDto } from '@sankore/crm-api';

function sourceLabel(source: string | null | undefined): string {
  switch (source) {
    case 'Manual':    return 'Saisie manuelle';
    case 'Web':       return 'Site web';
    case 'Phone':     return 'Téléphone';
    case 'Referral':  return 'Parrainage';
    case 'Partner':   return 'Partenaire';
    case 'Campaign':  return 'Campagne';
    case 'Import':    return 'Import';
    case 'Api':       return 'API';
    default:          return source ?? '—';
  }
}

function pipelineLabel(stage: string | null | undefined): string {
  switch (stage) {
    case 'Captured':       return 'Capturé';
    case 'Contacted':      return 'Contacté';
    case 'Qualified':      return 'Qualifié';
    case 'ProposalSent':   return 'Proposition envoyée';
    case 'Negotiation':    return 'Négociation';
    case 'Won':            return 'Gagné';
    case 'Lost':           return 'Perdu';
    default:               return stage ?? '—';
  }
}

function prospectTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case '0': return 'Individuel';
    case '1': return 'Entreprise';
    default:  return type ?? '—';
  }
}

function intentLabel(level: string | null | undefined): string {
  switch (level) {
    case '0': return 'Froid';
    case '1': return 'Tiède';
    case '2': return 'Chaud';
    case '3': return 'Très chaud';
    default:  return level ?? '—';
  }
}

@Component({
  selector: 'lead-informations',
  imports: [DecimalPipe, TasCard, TasSpinner, TimeagoPipe],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else if (lead()) {
      <div class="pb-6 flex flex-col gap-4">

        <!-- Identity -->
        <tas-card>
          <div class="p-4">
            <p class="text-xs font-semibold text-slate-400 mb-3">Identité</p>
            <div class="grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <p class="text-xs text-slate-400 mb-1">Nom complet</p>
                <p class="text-sm font-medium text-slate-800">{{ lead()!.fullName ?? '—' }}</p>
              </div>
              <div>
                <p class="text-xs text-slate-400 mb-1">Type de prospect</p>
                <p class="text-sm font-medium text-slate-800">{{ prospectTypeLabel(lead()!.prospectType) }}</p>
              </div>
              <div>
                <p class="text-xs text-slate-400 mb-1">Téléphone</p>
                <p class="text-sm font-medium text-slate-800">{{ lead()!.phoneNumber ?? '—' }}</p>
              </div>
              <div>
                <p class="text-xs text-slate-400 mb-1">E-mail</p>
                <p class="text-sm font-medium text-slate-800 truncate">{{ lead()!.email ?? '—' }}</p>
              </div>
              @if (lead()!.dateOfBirth) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Date de naissance</p>
                  <p class="text-sm font-medium text-slate-800">{{ lead()!.dateOfBirth }}</p>
                </div>
              }
              @if (lead()!.gender) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Genre</p>
                  <p class="text-sm font-medium text-slate-800">{{ lead()!.gender }}</p>
                </div>
              }
              @if (lead()!.nationalId) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Identifiant national</p>
                  <p class="text-sm font-medium text-slate-800">{{ lead()!.nationalId }}</p>
                </div>
              }
            </div>
          </div>
        </tas-card>

        <!-- Company (if enterprise) -->
        @if (lead()!.companyName || lead()!.companyEmail || lead()!.companyPhone) {
          <tas-card>
            <div class="p-4">
              <p class="text-xs font-semibold text-slate-400 mb-3">Entreprise</p>
              <div class="grid grid-cols-2 gap-x-6 gap-y-4">
                @if (lead()!.companyName) {
                  <div>
                    <p class="text-xs text-slate-400 mb-1">Raison sociale</p>
                    <p class="text-sm font-medium text-slate-800">{{ lead()!.companyName }}</p>
                  </div>
                }
                @if (lead()!.companyEmail) {
                  <div>
                    <p class="text-xs text-slate-400 mb-1">E-mail entreprise</p>
                    <p class="text-sm font-medium text-slate-800 truncate">{{ lead()!.companyEmail }}</p>
                  </div>
                }
                @if (lead()!.companyPhone) {
                  <div>
                    <p class="text-xs text-slate-400 mb-1">Téléphone entreprise</p>
                    <p class="text-sm font-medium text-slate-800">{{ lead()!.companyPhone }}</p>
                  </div>
                }
                @if (lead()!.website) {
                  <div>
                    <p class="text-xs text-slate-400 mb-1">Site web</p>
                    <p class="text-sm font-medium text-slate-800 truncate">{{ lead()!.website }}</p>
                  </div>
                }
              </div>
            </div>
          </tas-card>
        }

        <!-- Commercial info -->
        <tas-card>
          <div class="p-4">
            <p class="text-xs font-semibold text-slate-400 mb-3">Informations commerciales</p>
            <div class="grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <p class="text-xs text-slate-400 mb-1">Source</p>
                <p class="text-sm font-medium text-slate-800">{{ sourceLabel(lead()!.source) }}</p>
              </div>
              <div>
                <p class="text-xs text-slate-400 mb-1">Étape pipeline</p>
                <p class="text-sm font-medium text-slate-800">{{ pipelineLabel(lead()!.pipelineStage) }}</p>
              </div>
              @if (lead()!.interestedProduct) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Produit d'intérêt</p>
                  <p class="text-sm font-medium text-slate-800">{{ lead()!.interestedProduct }}</p>
                </div>
              }
              @if (lead()!.desiredAmount) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Montant souhaité</p>
                  <p class="text-sm font-medium text-slate-800 tabular-nums">
                    {{ lead()!.desiredAmount!.amount | number:'1.0-0' }}
                    {{ lead()!.desiredAmount!.currency }}
                  </p>
                </div>
              }
              @if (lead()!.campaign) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Campagne</p>
                  <p class="text-sm font-medium text-slate-800">{{ lead()!.campaign }}</p>
                </div>
              }
              @if (lead()!.channel) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Canal</p>
                  <p class="text-sm font-medium text-slate-800">{{ lead()!.channel }}</p>
                </div>
              }
              @if (lead()!.intentLevel != null) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Température</p>
                  <p class="text-sm font-medium text-slate-800">{{ intentLabel(lead()!.intentLevel) }}</p>
                </div>
              }
              <div>
                <p class="text-xs text-slate-400 mb-1">Qualification</p>
                <div class="flex items-center gap-2">
                  <div class="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      class="h-full bg-primary rounded-full transition-all"
                      [style.width.%]="(lead()!.qualificationCompleteness ?? 0) * 100"
                    ></div>
                  </div>
                  <span class="text-xs text-slate-500 tabular-nums">
                    {{ ((lead()!.qualificationCompleteness ?? 0) * 100) | number:'1.0-0' }}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </tas-card>

        <!-- Metadata -->
        <tas-card>
          <div class="p-4">
            <p class="text-xs font-semibold text-slate-400 mb-3">Dates</p>
            <div class="grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <p class="text-xs text-slate-400 mb-1">Capturé le</p>
                <p class="text-sm font-medium text-slate-800">
                  {{ lead()!.capturedAt ? (lead()!.capturedAt! | dateTimeAgo) : '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-slate-400 mb-1">Dernière activité</p>
                <p class="text-sm font-medium text-slate-800">
                  {{ lead()!.lastActivityAt ? (lead()!.lastActivityAt! | dateTimeAgo) : 'Aucune' }}
                </p>
              </div>
              @if (lead()!.expiresAt) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Expire le</p>
                  <p class="text-sm font-medium text-slate-800">
                    {{ lead()!.expiresAt! | dateTimeAgo }}
                  </p>
                </div>
              }
              @if (lead()!.convertedAt) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Converti le</p>
                  <p class="text-sm font-medium text-slate-800">
                    {{ lead()!.convertedAt! | dateTimeAgo }}
                  </p>
                </div>
              }
            </div>
          </div>
        </tas-card>

        <!-- Comment -->
        @if (lead()!.comment) {
          <tas-card>
            <div class="p-4">
              <p class="text-xs font-semibold text-slate-400 mb-2">Commentaire</p>
              <p class="text-sm text-slate-600 whitespace-pre-line">{{ lead()!.comment }}</p>
            </div>
          </tas-card>
        }

      </div>
    }
  `,
})
export class LeadInformationsPage {
  private readonly _leadsApiService = inject(LeadsApiService);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public lead = signal<LeadDto | null>(null);

  public readonly sourceLabel = sourceLabel;
  public readonly pipelineLabel = pipelineLabel;
  public readonly prospectTypeLabel = prospectTypeLabel;
  public readonly intentLabel = intentLabel;

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      this._leadsApiService
        .getLead(this.id())
        .pipe(
          catchError(() => {
            this.isLoading.set(false);
            return EMPTY;
          }),
        )
        .subscribe((lead) => {
          this.lead.set(lead);
          this.isLoading.set(false);
        });
    });
  }
}

export default LeadInformationsPage;
