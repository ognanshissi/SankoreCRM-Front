import { Component, effect, inject, input, signal } from '@angular/core';
import { catchError, EMPTY, switchMap } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import {
  LeadsApiService,
  LeadDto,
  DuplicateMatchResult,
} from '@sankore/crm-api';

function statusMeta(status: string | null | undefined): { label: string; severity: Severity } {
  switch (status) {
    case 'New':         return { label: 'Nouveau',    severity: 'info' };
    case 'Open':        return { label: 'Ouvert',     severity: 'info' };
    case 'Qualifying':  return { label: 'En cours',   severity: 'warning' };
    case 'Qualified':   return { label: 'Qualifié',   severity: 'warning' };
    case 'Converted':   return { label: 'Converti',   severity: 'success' };
    case 'Lost':        return { label: 'Perdu',      severity: 'error' };
    case 'Archived':    return { label: 'Archivé',    severity: 'neutral' };
    default:            return { label: status ?? '—', severity: 'neutral' };
  }
}

function confidenceColor(score: number | undefined): string {
  if (!score) return 'bg-slate-200';
  if (score >= 0.8) return 'bg-red-500';
  if (score >= 0.5) return 'bg-amber-500';
  return 'bg-slate-300';
}

@Component({
  selector: 'lead-doublons',
  imports: [TasCard, TasSpinner, TasIcon, Button, TasTag, TimeagoPipe],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="pb-6 flex flex-col gap-4">

        @if (duplicates().length === 0) {
          <tas-card>
            <div class="p-6 flex flex-col items-center text-center">
              <div class="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mb-3">
                <tas-icon iconName="feather:check" class="text-green-600"></tas-icon>
              </div>
              <p class="text-sm font-medium text-slate-700">Aucun doublon détecté</p>
              <p class="text-xs text-slate-400 mt-1">
                La recherche s'appuie sur le téléphone, l'e-mail et l'identifiant national.
              </p>
            </div>
          </tas-card>
        } @else {
          <div class="flex items-center justify-between">
            <p class="text-sm text-slate-500">
              {{ duplicates().length }} doublon(s) potentiel(s) détecté(s)
            </p>
          </div>

          @for (dup of duplicates(); track dup.leadId) {
            <tas-card>
              <div class="p-4">
                <div class="flex items-start justify-between gap-4">
                  <!-- Lead info -->
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                      <p class="text-sm font-medium text-slate-800 truncate">
                        {{ dup.fullName ?? '—' }}
                      </p>
                      <tas-tag [severity]="statusMeta(dup.status).severity">
                        {{ statusMeta(dup.status).label }}
                      </tas-tag>
                    </div>

                    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-1">
                      @if (dup.phoneNumber) {
                        <span class="flex items-center gap-1">
                          <tas-icon iconName="feather:phone" class="w-3 h-3"></tas-icon>
                          {{ dup.phoneNumber }}
                        </span>
                      }
                      @if (dup.email) {
                        <span class="flex items-center gap-1">
                          <tas-icon iconName="feather:mail" class="w-3 h-3"></tas-icon>
                          {{ dup.email }}
                        </span>
                      }
                      @if (dup.nationalId) {
                        <span class="flex items-center gap-1">
                          <tas-icon iconName="feather:credit-card" class="w-3 h-3"></tas-icon>
                          {{ dup.nationalId }}
                        </span>
                      }
                      @if (dup.capturedAt) {
                        <span class="flex items-center gap-1">
                          <tas-icon iconName="feather:clock" class="w-3 h-3"></tas-icon>
                          {{ dup.capturedAt | dateTimeAgo }}
                        </span>
                      }
                    </div>

                    <!-- Match reasons -->
                    @if (dup.matchReasons?.length) {
                      <div class="flex flex-wrap gap-1.5 mt-2.5">
                        @for (reason of dup.matchReasons; track reason.key) {
                          <span
                            class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                            [class]="reason.isExact
                              ? 'bg-red-50 text-red-700'
                              : 'bg-amber-50 text-amber-700'"
                          >
                            @if (reason.isExact) {
                              <tas-icon iconName="feather:check-circle" class="w-3 h-3"></tas-icon>
                            }
                            {{ reason.description ?? reason.key }}
                          </span>
                        }
                      </div>
                    }

                    <!-- Confidence -->
                    @if (dup.confidenceScore != null) {
                      <div class="flex items-center gap-2 mt-2.5">
                        <div class="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            class="h-full rounded-full transition-all"
                            [class]="confidenceColor(dup.confidenceScore)"
                            [style.width.%]="(dup.confidenceScore ?? 0) * 100"
                          ></div>
                        </div>
                        <span class="text-xs text-slate-500 tabular-nums">
                          {{ ((dup.confidenceScore ?? 0) * 100).toFixed(0) }}%
                        </span>
                        @if (dup.confidenceLabel) {
                          <span class="text-xs text-slate-400">{{ dup.confidenceLabel }}</span>
                        }
                      </div>
                    }
                  </div>

                  <!-- Actions -->
                  <div class="flex flex-col gap-1.5 flex-shrink-0">
                    <button
                      tas-outlined-button
                      color="primary"
                      (click)="merge(dup)"
                      [disabled]="actionInProgress()"
                    >
                      <tas-icon iconName="feather:git-merge"></tas-icon>
                      Fusionner
                    </button>
                    <button
                      tas-outlined-button
                      (click)="dismiss(dup)"
                      [disabled]="actionInProgress()"
                    >
                      <tas-icon iconName="feather:x"></tas-icon>
                      Ignorer
                    </button>
                  </div>
                </div>
              </div>
            </tas-card>
          }
        }

        <!-- Dismissed duplicates -->
        @if (dismissals().length > 0) {
          <tas-card>
            <div class="p-4 border-b border-slate-100">
              <p class="font-semibold text-slate-800">Doublons écartés</p>
              <p class="text-sm text-slate-500 mt-0.5">{{ dismissals().length }} doublon(s) précédemment écarté(s)</p>
            </div>
            <div class="divide-y divide-slate-100">
              @for (d of dismissals(); track d.leadId) {
                <div class="p-4 flex items-center gap-3 opacity-60">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm text-slate-600">{{ d.fullName ?? '—' }}</p>
                    <div class="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                      @if (d.phoneNumber) { <span>{{ d.phoneNumber }}</span> }
                      @if (d.email) { <span>{{ d.email }}</span> }
                    </div>
                  </div>
                  <tas-tag severity="neutral">Écarté</tas-tag>
                </div>
              }
            </div>
          </tas-card>
        }

      </div>
    }
  `,
})
export class LeadDoublonsPage {
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public lead = signal<LeadDto | null>(null);
  public duplicates = signal<DuplicateMatchResult[]>([]);
  public dismissals = signal<DuplicateMatchResult[]>([]);
  public actionInProgress = signal(false);

  public readonly statusMeta = statusMeta;
  public readonly confidenceColor = confidenceColor;

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      this._leadsApi
        .getLead(this.id())
        .pipe(
          switchMap((lead) => {
            this.lead.set(lead);
            return this._leadsApi.findLeadDuplicates(
              lead.phoneNumber ?? undefined,
              lead.email ?? undefined,
              lead.nationalId ?? undefined,
              lead.customerReference ?? undefined,
              lead.fullName ?? undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              lead.id,
            );
          }),
          catchError(() => {
            this.isLoading.set(false);
            return EMPTY;
          }),
        )
        .subscribe((dups) => {
          this.duplicates.set(dups);
          this.isLoading.set(false);
        });
      // Load dismissed duplicates
      this._leadsApi.listDismissals(this.id()).pipe(catchError(() => EMPTY))
        .subscribe((d) => this.dismissals.set(d ?? []));
    });
  }

  public dismiss(dup: DuplicateMatchResult): void {
    this.actionInProgress.set(true);
    this._leadsApi
      .dismissDuplicate(this.id(), { candidateLeadId: dup.leadId })
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible d\'ignorer ce doublon.');
          this.actionInProgress.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.duplicates.update((list) => list.filter((d) => d.leadId !== dup.leadId));
        this._snackbar.success('Doublon ignoré', 'Ce candidat a été écarté.');
        this.actionInProgress.set(false);
      });
  }

  public merge(dup: DuplicateMatchResult): void {
    this.actionInProgress.set(true);
    this._leadsApi
      .mergeLeads(this.id(), { sourceLeadId: dup.leadId })
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'La fusion a échoué.');
          this.actionInProgress.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.duplicates.update((list) => list.filter((d) => d.leadId !== dup.leadId));
        this._snackbar.success(
          'Fusion effectuée',
          `Les données ont été fusionnées dans le lead courant.`,
        );
        this.actionInProgress.set(false);
      });
  }
}

export default LeadDoublonsPage;
