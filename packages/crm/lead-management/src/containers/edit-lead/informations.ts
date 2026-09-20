import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { TasInput } from '@talisoft/ui/input';
import { TasFormField } from '@talisoft/ui/form-field';
import { Button } from '@talisoft/ui/button';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { LeadsApiService, LeadDto, TagDto } from '@sankore/crm-api';
import { AuthenticationService } from '@sankore/crm/common';

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
  imports: [FormsModule, DecimalPipe, TasCard, TasSpinner, TasIcon, TasTag, TasInput, TasFormField, Button, TimeagoPipe],
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
                  @if (!showQualOverride()) {
                    <button type="button" class="text-[10px] text-primary hover:underline" (click)="showQualOverride.set(true)">
                      Modifier
                    </button>
                  }
                </div>
                @if (showQualOverride()) {
                  <div class="flex items-center gap-2 mt-2">
                    <input type="range" min="0" max="100" class="flex-1 accent-primary"
                      [ngModel]="qualOverrideValue()" (ngModelChange)="qualOverrideValue.set($event)" />
                    <span class="text-xs text-slate-600 tabular-nums w-8 text-right">{{ qualOverrideValue() }}%</span>
                    <button tas-button color="primary" type="button" class="text-[10px]"
                      [disabled]="isSavingQual()" (click)="saveQualificationCompleteness()">
                      @if (isSavingQual()) { <tas-spinner size="2" class="text-white"></tas-spinner> }
                      OK
                    </button>
                    <button type="button" class="text-[10px] text-slate-400" (click)="showQualOverride.set(false)">Annuler</button>
                  </div>
                }
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

        <!-- Tags -->
        <tas-card>
          <div class="p-4">
            <p class="text-xs font-semibold text-slate-400 mb-3">Tags</p>
            <div class="flex flex-wrap gap-1.5 mb-3">
              @for (tag of tags(); track tag.id) {
                <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                  {{ tag.tag }}
                  <button type="button" class="hover:text-red-500 transition-colors" (click)="removeTag(tag)">
                    <tas-icon iconName="feather:x" style="font-size:10px"></tas-icon>
                  </button>
                </span>
              }
              @if (tags().length === 0 && !showTagInput()) {
                <span class="text-xs text-slate-400">Aucun tag</span>
              }
            </div>
            @if (showTagInput()) {
              <div class="flex items-center gap-2">
                <tas-form-field>
                  <input tasInput type="text" placeholder="Nouveau tag…"
                    [ngModel]="newTag()" (ngModelChange)="newTag.set($event)"
                    (keydown.enter)="addTag()" />
                </tas-form-field>
                <button tas-button color="primary" type="button" class="text-xs shrink-0" [disabled]="!newTag().trim() || isAddingTag()" (click)="addTag()">
                  @if (isAddingTag()) { <tas-spinner size="3" class="text-white"></tas-spinner> }
                  Ajouter
                </button>
                <button type="button" class="text-xs text-slate-400 hover:text-slate-600" (click)="showTagInput.set(false)">Annuler</button>
              </div>
            } @else {
              <button type="button" class="text-xs text-primary hover:underline flex items-center gap-1" (click)="showTagInput.set(true)">
                <tas-icon iconName="feather:plus" style="font-size:10px"></tas-icon> Ajouter un tag
              </button>
            }
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
  private readonly _snackbar = inject(SnackbarService);
  private readonly _auth = inject(AuthenticationService);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public lead = signal<LeadDto | null>(null);
  public tags = signal<TagDto[]>([]);
  public newTag = signal('');
  public showTagInput = signal(false);
  public isAddingTag = signal(false);
  public showQualOverride = signal(false);
  public qualOverrideValue = signal(50);
  public isSavingQual = signal(false);

  public readonly sourceLabel = sourceLabel;
  public readonly pipelineLabel = pipelineLabel;
  public readonly prospectTypeLabel = prospectTypeLabel;
  public readonly intentLabel = intentLabel;

  constructor() {
    effect(() => {
      const leadId = this.id();
      this.isLoading.set(true);
      this._leadsApiService.getLead(leadId).pipe(
        catchError(() => { this.isLoading.set(false); return EMPTY; }),
      ).subscribe((lead) => {
        this.lead.set(lead);
        this.isLoading.set(false);
      });
      this._leadsApiService.listLeadTags(leadId).pipe(
        catchError(() => EMPTY),
      ).subscribe((t) => this.tags.set(t ?? []));
    });
  }

  public saveQualificationCompleteness(): void {
    this.isSavingQual.set(true);
    this._leadsApiService.setLeadQualificationCompleteness(this.id(), {
      completeness: this.qualOverrideValue() / 100,
    }).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Mise à jour échouée.'); return EMPTY; }),
    ).subscribe(() => {
      this.lead.update((l) => l ? { ...l, qualificationCompleteness: this.qualOverrideValue() / 100 } : l);
      this._snackbar.success('Qualification mise à jour', `Progression définie à ${this.qualOverrideValue()}%.`);
      this.showQualOverride.set(false);
      this.isSavingQual.set(false);
    });
  }

  public addTag(): void {
    const tag = this.newTag().trim();
    if (!tag) return;
    this.isAddingTag.set(true);
    this._leadsApiService.addLeadTag(this.id(), {
      tag,
      addedBy: this._auth.connectedUser()?.id,
    }).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Impossible d\'ajouter le tag.'); return EMPTY; }),
    ).subscribe((added) => {
      this.tags.update((list) => [...list, added]);
      this.newTag.set('');
      this.showTagInput.set(false);
      this.isAddingTag.set(false);
    });
  }

  public removeTag(tag: TagDto): void {
    this._leadsApiService.removeLeadTag(this.id(), tag.id!).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Impossible de retirer le tag.'); return EMPTY; }),
    ).subscribe(() => {
      this.tags.update((list) => list.filter((t) => t.id !== tag.id));
    });
  }
}

export default LeadInformationsPage;
