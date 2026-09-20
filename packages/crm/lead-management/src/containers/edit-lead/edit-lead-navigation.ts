import { Component, computed, effect, inject, input, signal, OnDestroy } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Anchor, Button } from '@talisoft/ui/button';
import { LeadsApiService, LeadDto, NextActionDto, LeadIntentLevelDto, CloseLeadRequestReasonEnum } from '@sankore/crm-api';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { BreadcrumbService } from '@sankore/crm/common';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { ReassignLeadDrawer } from './reassign-lead-drawer';
import { ConvertLeadWizard } from './convert-lead-wizard';
import { NurtureRecycleDrawer } from './nurture-recycle-drawer';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { catchError, EMPTY } from 'rxjs';

interface LeadMenuItem {
  label: string;
  icon: string;
  route: string;
}

function leadStatusMeta(status: string | null | undefined): { label: string; severity: Severity } {
  switch (status) {
    case 'New':       return { label: 'Nouveau',  severity: 'info' };
    case 'Contacted': return { label: 'Contacté', severity: 'warning' };
    case 'Qualified': return { label: 'Qualifié', severity: 'warning' };
    case 'Converted': return { label: 'Converti', severity: 'success' };
    case 'Lost':      return { label: 'Perdu',     severity: 'error' };
    case 'Expired':   return { label: 'Expiré',    severity: 'neutral' };
    case 'Nurturing': return { label: 'Nurturing', severity: 'accent' };
    case 'Recycled':  return { label: 'Recyclé',   severity: 'secondary' };
    default:          return { label: status ?? '—', severity: 'neutral' };
  }
}

interface TemperatureMeta {
  label: string;
  key: string;
  colorClasses: string;
  dotClass: string;
}

function temperatureMeta(intentLevel: string | null | undefined): TemperatureMeta {
  switch (String(intentLevel)) {
    case '0': return { label: 'Froid',      key: 'COLD',    colorClasses: 'bg-slate-100 text-slate-700 border-slate-300',   dotClass: 'bg-slate-400' };
    case '1': return { label: 'Tiède',      key: 'WARM',    colorClasses: 'bg-blue-50 text-blue-700 border-blue-300',       dotClass: 'bg-blue-500' };
    case '2': return { label: 'Chaud',      key: 'HOT',     colorClasses: 'bg-amber-50 text-amber-700 border-amber-300',    dotClass: 'bg-amber-500' };
    case '3': return { label: 'Très chaud', key: 'VERY HOT', colorClasses: 'bg-red-50 text-red-700 border-red-300',         dotClass: 'bg-red-500' };
    default:  return { label: 'Inconnu',    key: 'UNKNOWN', colorClasses: 'bg-gray-50 text-gray-500 border-gray-300',       dotClass: 'bg-gray-400' };
  }
}

function scoreColor(score: number): { bg: string; text: string; bar: string } {
  if (score >= 70) return { bg: 'bg-green-50',  text: 'text-green-700', bar: 'bg-green-500' };
  if (score >= 40) return { bg: 'bg-amber-50',  text: 'text-amber-700', bar: 'bg-amber-500' };
  return               { bg: 'bg-red-50',    text: 'text-red-700',   bar: 'bg-red-400' };
}

interface ScoreFactor {
  label: string;
  value: string;
  impact: string;
}

function parseFactors(factorsJson: string | null | undefined): ScoreFactor[] {
  if (!factorsJson) return [];
  try {
    const parsed = JSON.parse(factorsJson);
    if (Array.isArray(parsed)) return parsed;
    return Object.entries(parsed).map(([key, val]: [string, any]) => ({
      label: key,
      value: typeof val === 'object' ? (val.value ?? val.detail ?? JSON.stringify(val)) : String(val),
      impact: typeof val === 'object' ? (val.impact ?? '') : '',
    }));
  } catch {
    return [];
  }
}

@Component({
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    TasIcon,
    TasCard,
    TasSpinner,
    Anchor,
    Button,
    TasTag,
    TimeagoPipe,
  ],
  template: `
    @if (notFound()) {
      <!-- 404 screen -->
      <div class="flex flex-col items-center justify-center py-32 text-center">
        <div class="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <tas-icon iconName="feather:alert-circle" class="text-slate-400" style="font-size:28px"></tas-icon>
        </div>
        <h2 class="text-lg font-semibold text-slate-800 mb-1">Lead introuvable</h2>
        <p class="text-sm text-slate-500 mb-6 max-w-sm">
          Ce lead n'existe pas ou vous n'avez pas les droits pour y accéder.
        </p>
        <a [routerLink]="['/leads']" tas-button iconButton class="inline-flex items-center gap-2 text-sm">
          <tas-icon iconName="feather:arrow-left" style="font-size:14px"></tas-icon>
          Retour aux leads
        </a>
      </div>
    } @else {
      <!-- Header -->
      <div class="flex items-center gap-3 mb-4">
        <a [routerLink]="['/leads']" tas-button iconButton>
          <tas-icon iconName="feather:chevron-left"></tas-icon>
        </a>
        <div class="flex-1 min-w-0">
          @if (isLoading()) {
            <div class="h-5 w-48 bg-slate-200 rounded animate-pulse"></div>
          } @else {
            <h1 class="text-lg font-semibold text-slate-900 truncate">
              {{ displayName() }}
            </h1>
          }
        </div>
        @if (!isLoading() && lead()) {
          <tas-tag [severity]="statusMeta().severity">{{ statusMeta().label }}</tas-tag>
          <button
            tas-outlined-button
            color="primary"
            type="button"
            (click)="openReassignDrawer()"
            class="text-xs"
          >
            <tas-icon iconName="feather:user-plus" style="font-size:14px"></tas-icon>
            Réassigner
          </button>
          @if (lead()!.status === 'Lost' || lead()!.status === 'Expired' || lead()!.status === 'Recycled') {
            <button
              tas-outlined-button
              type="button"
              (click)="reopenLead()"
              class="text-xs"
              [disabled]="isReopening()"
            >
              @if (isReopening()) { <tas-spinner size="3" class="text-primary"></tas-spinner> }
              <tas-icon iconName="feather:rotate-ccw" style="font-size:14px"></tas-icon>
              Réouvrir
            </button>
          }
          @if (lead()!.status !== 'Converted') {
            <button
              tas-button
              color="primary"
              type="button"
              (click)="openConvertWizard()"
              class="text-xs"
            >
              <tas-icon iconName="feather:user-check" style="font-size:14px"></tas-icon>
              Convertir
            </button>
            <button
              tas-outlined-button
              type="button"
              (click)="openNurtureRecycleDrawer()"
              class="text-xs"
            >
              <tas-icon iconName="feather:refresh-cw" style="font-size:14px"></tas-icon>
              Nurturing / Recycler
            </button>
            <button
              tas-outlined-button
              type="button"
              (click)="closeLead()"
              class="text-xs"
            >
              <tas-icon iconName="feather:x-square" style="font-size:14px"></tas-icon>
              Clôturer
            </button>
          }
          @if (lead()!.status === 'New' && !lead()!.lastActivityAt) {
            <button
              tas-outlined-button
              color="primary"
              type="button"
              (click)="recordFirstContact()"
              class="text-xs"
              [disabled]="isRecordingFirstContact()"
            >
              @if (isRecordingFirstContact()) { <tas-spinner size="3" class="text-primary"></tas-spinner> }
              <tas-icon iconName="feather:phone-forwarded" style="font-size:14px"></tas-icon>
              1er contact
            </button>
          }
          <button
            tas-outlined-button
            type="button"
            (click)="returnToQueue()"
            class="text-xs"
            [disabled]="isReturningToQueue()"
          >
            @if (isReturningToQueue()) { <tas-spinner size="3" class="text-primary"></tas-spinner> }
            <tas-icon iconName="feather:corner-down-left" style="font-size:14px"></tas-icon>
            Remettre en file
          </button>
        }
      </div>

      <!-- Grid: sidebar + content -->
      <div class="grid grid-cols-4 gap-4">

        <!-- Sidebar -->
        <div class="col-span-1">
          <tas-card>
            <!-- Lead summary -->
            @if (isLoading()) {
              <div class="p-4 flex justify-center">
                <tas-spinner size="5" class="text-primary"></tas-spinner>
              </div>
            } @else if (lead()) {
              <div class="p-4 border-b border-gray-100">
                <p class="text-sm font-medium text-slate-800 truncate">{{ displayName() }}</p>
                @if (lead()!.email) {
                  <p class="text-xs text-slate-500 mt-0.5 truncate">{{ lead()!.email }}</p>
                }
                @if (lead()!.phoneNumber) {
                  <p class="text-xs text-slate-400 mt-1 flex items-center gap-1">
                    <tas-icon iconName="feather:phone" class="inline-block w-3 h-3"></tas-icon>
                    {{ lead()!.phoneNumber }}
                  </p>
                }
                @if (lead()!.source) {
                  <p class="text-xs text-slate-400 mt-1 flex items-center gap-1">
                    <tas-icon iconName="feather:globe" class="inline-block w-3 h-3"></tas-icon>
                    {{ lead()!.source }}
                  </p>
                }
                <!-- Score & Temperature badge -->
                @if (lead()!.score != null || lead()!.intentLevel != null) {
                  <div class="mt-3 relative">
                    <button
                      type="button"
                      class="w-full flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      [class]="scoreBadgeClasses()"
                      (click)="toggleFactorsPanel()"
                      (keydown.enter)="toggleFactorsPanel()"
                      (keydown.space)="toggleFactorsPanel(); $event.preventDefault()"
                      [attr.aria-expanded]="showFactors()"
                      aria-controls="score-factors-panel"
                    >
                      <!-- Score circle -->
                      <div
                        class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold tabular-nums shrink-0"
                        [class]="scoreCircleClasses()"
                      >
                        {{ lead()!.score ?? '—' }}
                      </div>
                      <div class="flex-1 min-w-0 text-left">
                        <div class="flex items-center gap-1">
                          <span class="w-2 h-2 rounded-full shrink-0" [class]="tempMeta().dotClass"></span>
                          <span class="text-xs font-semibold truncate">{{ tempMeta().label }}</span>
                        </div>
                        <span class="text-[10px] opacity-70">Score {{ lead()!.score ?? 0 }}/100</span>
                      </div>
                      <tas-icon
                        [iconName]="showFactors() ? 'feather:chevron-up' : 'feather:chevron-down'"
                        class="shrink-0 opacity-50"
                        style="font-size:14px"
                      ></tas-icon>
                    </button>

                    <!-- Factors detail panel -->
                    @if (showFactors()) {
                      <div
                        id="score-factors-panel"
                        class="mt-2 rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden"
                        role="region"
                        aria-label="Détail du score"
                      >
                        <div class="px-3 py-2 border-b border-slate-100 bg-slate-50">
                          <p class="text-xs font-semibold text-slate-700">Facteurs du score</p>
                        </div>
                        @if (scoreFactors().length === 0) {
                          <div class="px-3 py-4 text-center">
                            <p class="text-xs text-slate-400">Aucun détail disponible</p>
                          </div>
                        } @else {
                          <div class="divide-y divide-slate-100">
                            @for (factor of scoreFactors(); track factor.label) {
                              <div class="px-3 py-2 flex items-start justify-between gap-2">
                                <div class="min-w-0">
                                  <p class="text-xs font-medium text-slate-700 truncate">{{ factor.label }}</p>
                                  <p class="text-[10px] text-slate-500 truncate">{{ factor.value }}</p>
                                </div>
                                @if (factor.impact) {
                                  <span
                                    class="text-[10px] font-semibold tabular-nums shrink-0"
                                    [class]="factor.impact.startsWith('-') ? 'text-red-600' : 'text-green-600'"
                                  >
                                    {{ factor.impact.startsWith('-') ? '' : '+' }}{{ factor.impact }}
                                  </span>
                                }
                              </div>
                            }
                          </div>
                        }
                        <!-- Intent level detail (from getLeadIntentLevel) -->
                        @if (intentLevelDetail()) {
                          <div class="px-3 py-2 border-t border-slate-100 flex items-center justify-between">
                            <span class="text-[10px] text-slate-400">Score d'intention</span>
                            <span class="text-xs font-semibold tabular-nums text-slate-700">{{ intentLevelDetail()!.score ?? '—' }}</span>
                          </div>
                          @if (intentLevelDetail()!.updatedAt) {
                            <div class="px-3 pb-1 flex items-center justify-between">
                              <span class="text-[10px] text-slate-400">Mis à jour</span>
                              <span class="text-[10px] text-slate-400">{{ intentLevelDetail()!.updatedAt | dateTimeAgo }}</span>
                            </div>
                          }
                        }
                        <div class="px-3 py-2 border-t border-slate-100 bg-slate-50">
                          <p class="text-[10px] text-slate-400 mb-1.5">Température</p>
                          <div class="flex items-center gap-1">
                            @for (lvl of intentLevels; track lvl.value) {
                              <button
                                type="button"
                                class="flex-1 py-1 rounded text-[10px] font-medium transition-colors"
                                [class]="lead()!.intentLevel === lvl.value
                                  ? lvl.activeClass
                                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200'"
                                (click)="setIntentLevel(lvl.value); $event.stopPropagation()"
                              >
                                {{ lvl.label }}
                              </button>
                            }
                          </div>
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>
            }

            <!-- Next action widget -->
            @if (nextAction()) {
              <div class="p-3 border-b border-gray-100">
                <div class="p-2.5 rounded-lg border border-primary/20 bg-primary/5">
                  <div class="flex items-center gap-1.5 mb-1">
                    <tas-icon iconName="feather:zap" class="text-primary" style="font-size:12px"></tas-icon>
                    <p class="text-[10px] font-semibold text-primary">Action recommandée</p>
                  </div>
                  <p class="text-xs font-medium text-slate-800">{{ nextAction()!.title }}</p>
                  @if (nextAction()!.detail) {
                    <p class="text-[10px] text-slate-500 mt-0.5">{{ nextAction()!.detail }}</p>
                  }
                  @if (nextAction()!.urgency) {
                    <p class="text-[10px] text-amber-600 mt-0.5">{{ nextAction()!.urgency }}</p>
                  }
                  <div class="flex items-center gap-1 mt-2">
                    <button
                      type="button"
                      class="text-[10px] px-2 py-0.5 rounded bg-primary text-white hover:bg-primary/90"
                      (click)="acknowledgeNextAction('Accept')"
                    >Accepter</button>
                    <button
                      type="button"
                      class="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200"
                      (click)="acknowledgeNextAction('Ignore')"
                    >Ignorer</button>
                  </div>
                </div>
              </div>
            }

            <!-- Menu items -->
            @for (item of menuItems; track item.route) {
              <a
                class="px-4 py-3 hover:bg-gray-200 flex items-center gap-2 text-sm"
                [routerLink]="item.route"
                [routerLinkActive]="'is-link-active'"
              >
                <tas-icon [iconName]="item.icon"></tas-icon>
                <span>{{ item.label }}</span>
              </a>
            }
          </tas-card>
        </div>

        <!-- Page content -->
        <div class="col-span-3 h-[calc(100vh_-_130px)] overflow-y-auto">
          <router-outlet></router-outlet>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .is-link-active {
        background-color: rgba(var(--tas-color-primary), 0.2);
        color: var(--tas-color-primary);
      }
    `,
  ],
})
export class EditLeadNavigation implements OnDestroy {
  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _router = inject(Router);
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public lead = signal<LeadDto | null>(null);
  public notFound = signal(false);
  public showFactors = signal(false);
  public isReopening = signal(false);
  public isRecordingFirstContact = signal(false);
  public isReturningToQueue = signal(false);
  public nextAction = signal<NextActionDto | null>(null);
  public intentLevelDetail = signal<LeadIntentLevelDto | null>(null);
  public latestFactorsJson = signal<string | null>(null);

  public readonly scoreFactors = computed(() => parseFactors(this.latestFactorsJson()));

  public readonly intentLevels = [
    { value: '0', label: 'Froid',  activeClass: 'bg-slate-200 text-slate-700' },
    { value: '1', label: 'Tiède',  activeClass: 'bg-blue-100 text-blue-700' },
    { value: '2', label: 'Chaud',  activeClass: 'bg-amber-100 text-amber-700' },
    { value: '3', label: 'Très chaud', activeClass: 'bg-red-100 text-red-700' },
  ];

  public readonly menuItems: LeadMenuItem[] = [
    { label: 'Informations',  icon: 'feather:user',        route: 'informations' },
    { label: 'Qualification', icon: 'feather:clipboard',    route: 'qualification' },
    { label: 'Score',         icon: 'feather:bar-chart-2',  route: 'score' },
    { label: 'Timeline',      icon: 'feather:clock',        route: 'timeline' },
    { label: 'Tâches',        icon: 'feather:check-square', route: 'taches' },
    { label: 'Activités',     icon: 'feather:activity',     route: 'activites' },
    { label: 'Rappels',      icon: 'feather:bell',         route: 'rappels' },
    { label: 'Opportunités', icon: 'feather:briefcase',    route: 'opportunites' },
    { label: 'Doublons',      icon: 'feather:copy',         route: 'doublons' },
    { label: 'Consentement',  icon: 'feather:shield',       route: 'consentement' },
  ];

  constructor() {
    effect(() => {
      const id = this.id();
      this.isLoading.set(true);
      this.notFound.set(false);
      this._stopPolling();

      this._leadsApiService.getLead(id).pipe(
        catchError((err) => {
          this.isLoading.set(false);
          if (err.status === 404 || err.status === 403) {
            this.notFound.set(true);
          }
          return EMPTY;
        }),
      ).subscribe((lead) => {
        this.lead.set(lead);
        this.isLoading.set(false);
        this._breadcrumbService.set([
          { label: 'Leads', link: ['/leads'] },
          { label: this._displayName(lead) },
        ]);
        this._loadScoreFactors(id);
        this._loadNextAction(id);
        this._loadIntentLevel(id);
        this._startPolling(id);
      });
    });
  }

  ngOnDestroy(): void {
    this._stopPolling();
  }

  public displayName(): string {
    return this._displayName(this.lead());
  }

  public statusMeta(): { label: string; severity: Severity } {
    return leadStatusMeta(this.lead()?.status);
  }

  public tempMeta(): TemperatureMeta {
    return temperatureMeta(this.lead()?.intentLevel);
  }

  public scoreBadgeClasses(): string {
    return temperatureMeta(this.lead()?.intentLevel).colorClasses;
  }

  public scoreCircleClasses(): string {
    const s = this.lead()?.score ?? 0;
    const c = scoreColor(s);
    return `${c.bg} ${c.text}`;
  }

  public closeLead(): void {
    this._confirmDialog.confirm({
      title: 'Clôturer ce lead ?',
      message: 'Le lead sera marqué comme perdu. Cette action peut être annulée via « Réouvrir ».',
      closable: true, showCancelButton: true,
      acceptButtonProps: { label: 'Clôturer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this._leadsApiService.closeLead(this.id(), {
          reason: CloseLeadRequestReasonEnum.Lost,
          detail: 'Clôturé manuellement par l\'agent',
        }).pipe(catchError(() => { this._snackbar.error('Erreur', 'Clôture échouée.'); return EMPTY; }))
          .subscribe(() => {
            this._snackbar.success('Lead clôturé', 'Le lead a été marqué comme perdu.');
            this._leadsApiService.getLead(this.id()).pipe(catchError(() => EMPTY))
              .subscribe((lead) => this.lead.set(lead));
          });
      },
    });
  }

  public recordFirstContact(): void {
    this.isRecordingFirstContact.set(true);
    this._leadsApiService.recordFirstContact(this.id(), { contactedAt: new Date().toISOString() }).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Enregistrement échoué.'); return EMPTY; }),
    ).subscribe(() => {
      this._snackbar.success('Premier contact', 'Le premier contact a été enregistré.');
      this.isRecordingFirstContact.set(false);
      this._leadsApiService.getLead(this.id()).pipe(catchError(() => EMPTY))
        .subscribe((lead) => this.lead.set(lead));
    });
  }

  public returnToQueue(): void {
    this._confirmDialog.confirm({
      title: 'Remettre en file d\'attente ?',
      message: 'Le lead sera retiré de votre portefeuille et redistribué automatiquement.',
      closable: true, showCancelButton: true,
      acceptButtonProps: { label: 'Confirmer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isReturningToQueue.set(true);
        this._leadsApiService.returnLeadToQueue(this.id()).pipe(
          catchError(() => { this._snackbar.error('Erreur', 'Opération échouée.'); return EMPTY; }),
        ).subscribe(() => {
          this._snackbar.success('Lead en file', 'Le lead a été remis en file d\'attente.');
          this.isReturningToQueue.set(false);
          this._leadsApiService.getLead(this.id()).pipe(catchError(() => EMPTY))
            .subscribe((lead) => this.lead.set(lead));
        });
      },
    });
  }

  public acknowledgeNextAction(action: string): void {
    this._leadsApiService.acknowledgeLeadNextAction(this.id(), { action: action as any }).pipe(
      catchError(() => EMPTY),
    ).subscribe(() => {
      this.nextAction.set(null);
      if (action === 'Accept') {
        this._snackbar.success('Action acceptée', 'L\'action recommandée a été prise en charge.');
      }
    });
  }

  public setIntentLevel(level: string): void {
    const intentMap: Record<string, string> = { '0': 'Cold', '1': 'Warm', '2': 'Hot', '3': 'Hot' };
    this._leadsApiService.setLeadIntentLevel(this.id(), {
      intentLevel: intentMap[level] as any,
    }).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Impossible de modifier la température.'); return EMPTY; }),
    ).subscribe(() => {
      this.lead.update((l) => l ? { ...l, intentLevel: level } : l);
      this._snackbar.success('Température mise à jour', `Température modifiée.`);
    });
  }

  public reopenLead(): void {
    this.isReopening.set(true);
    this._leadsApiService.reopenLead(this.id()).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de réouvrir le lead.');
        this.isReopening.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this._snackbar.success('Lead réouvert', 'Le lead est de nouveau actif.');
      this.isReopening.set(false);
      this._leadsApiService.getLead(this.id()).pipe(catchError(() => EMPTY))
        .subscribe((lead) => this.lead.set(lead));
    });
  }

  public openNurtureRecycleDrawer(): void {
    const currentLead = this.lead();
    if (!currentLead) return;

    const ref = this._sideDrawerService.open(NurtureRecycleDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { lead: currentLead },
    });

    ref.closed.subscribe((result: any) => {
      if (result === 'nurtured' || result === 'recycled') {
        this._leadsApiService.getLead(this.id()).pipe(
          catchError(() => EMPTY),
        ).subscribe((lead) => this.lead.set(lead));
      }
    });
  }

  public openConvertWizard(): void {
    const currentLead = this.lead();
    if (!currentLead) return;

    const ref = this._sideDrawerService.open(ConvertLeadWizard, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { lead: currentLead },
    });

    ref.closed.subscribe((result: any) => {
      if (result && typeof result === 'object' && result.customerId) {
        // Reload lead to reflect converted status
        this._leadsApiService.getLead(this.id()).pipe(
          catchError(() => EMPTY),
        ).subscribe((lead) => this.lead.set(lead));
      }
    });
  }

  public openReassignDrawer(): void {
    const currentLead = this.lead();
    if (!currentLead) return;

    const ref = this._sideDrawerService.open(ReassignLeadDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { lead: currentLead },
    });

    ref.closed.subscribe((reassigned) => {
      if (reassigned) {
        // Reload lead to reflect new assignment
        this._leadsApiService.getLead(this.id()).pipe(
          catchError(() => EMPTY),
        ).subscribe((lead) => {
          this.lead.set(lead);
        });
      }
    });
  }

  public toggleFactorsPanel(): void {
    this.showFactors.update((v) => !v);
  }

  private _loadIntentLevel(leadId: string): void {
    this._leadsApiService.getLeadIntentLevel(leadId).pipe(
      catchError(() => EMPTY),
    ).subscribe((detail) => this.intentLevelDetail.set(detail ?? null));
  }

  private _loadNextAction(leadId: string): void {
    this._leadsApiService.getLeadNextAction(leadId).pipe(
      catchError(() => EMPTY),
    ).subscribe((action) => this.nextAction.set(action ?? null));
  }

  private _loadScoreFactors(leadId: string): void {
    this._leadsApiService.getLeadScoreHistory(leadId).pipe(
      catchError(() => EMPTY),
    ).subscribe((history) => {
      const latest = history?.[0];
      this.latestFactorsJson.set(latest?.factorsJson ?? null);
    });
  }

  /** Poll every 30s to pick up real-time score recalculations */
  private _startPolling(leadId: string): void {
    this._pollTimer = setInterval(() => {
      this._leadsApiService.getLead(leadId).pipe(
        catchError(() => EMPTY),
      ).subscribe((lead) => {
        const current = this.lead();
        if (current && (current.score !== lead.score || current.intentLevel !== lead.intentLevel)) {
          this.lead.set(lead);
          this._loadScoreFactors(leadId);
        }
      });
    }, 30_000);
  }

  private _stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private _displayName(lead: LeadDto | null | undefined): string {
    if (!lead) return 'Lead';
    if (lead.fullName) return lead.fullName;
    const parts = [lead.firstName, lead.lastName].filter(Boolean);
    return parts.length ? parts.join(' ') : lead.phoneNumber ?? lead.email ?? 'Lead';
  }
}

export default EditLeadNavigation;
