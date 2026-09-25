import { Component, computed, inject, input, output, signal, OnInit, OnDestroy } from '@angular/core';
import { catchError, EMPTY, Observable } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { IngestionDto, IngestionsApiService, LeadSourceDetailDto } from '@sankore/crm-api';
import { LeadSourcesService } from './lead-sources.service';

/**
 * FE-12 — Vérifier l'installation et envoyer un lead de test
 */

type DetectionStatus = 'waiting' | 'detected' | 'error' | 'idle';

@Component({
  selector: 'script-verifier',
  standalone: true,
  imports: [TasCard, TasSpinner, TasIcon, TasTag, Button],
  template: `
    <div class="max-w-3xl flex flex-col gap-4">
      <!-- Detection status -->
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100">
          <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <tas-icon iconName="feather:wifi" class="text-slate-400" style="font-size:14px"></tas-icon>
            Détection du script
          </p>
        </div>
        <div class="p-4">
          @switch (detectionStatus()) {
            @case ('waiting') {
              <div class="flex items-center gap-3">
                <tas-spinner size="5" class="text-primary"></tas-spinner>
                <div>
                  <p class="text-sm font-medium text-slate-700">En attente de détection…</p>
                  <p class="text-xs text-slate-400 mt-0.5">
                    Installez le script sur votre site puis rechargez la page. Vérification automatique
                    @if (autoRefreshActive()) {
                      toutes les 10 secondes ({{ remainingChecks() }} vérifications restantes).
                    } @else {
                      arrêtée.
                    }
                  </p>
                </div>
              </div>
              @if (!autoRefreshActive()) {
                <button tas-outlined-button type="button" class="mt-3" (click)="startPolling()">
                  <tas-icon iconName="feather:refresh-cw" style="font-size:12px"></tas-icon>
                  Vérifier maintenant
                </button>
              }
            }
            @case ('detected') {
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <tas-icon iconName="feather:check" class="text-green-600" style="font-size:18px"></tas-icon>
                </div>
                <div>
                  <p class="text-sm font-medium text-green-700">Script détecté</p>
                  <p class="text-xs text-slate-400 mt-0.5">
                    @if (detectedOrigin()) {
                      Détecté sur <strong>{{ detectedOrigin() }}</strong>.
                    }
                    La source est passée en mode Test.
                  </p>
                </div>
              </div>
            }
            @case ('error') {
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <tas-icon iconName="feather:x" class="text-red-600" style="font-size:18px"></tas-icon>
                </div>
                <div>
                  <p class="text-sm font-medium text-red-700">Erreur de détection</p>
                  <p class="text-xs text-slate-400 mt-0.5">Impossible de vérifier l'installation du script.</p>
                </div>
              </div>
              <button tas-outlined-button type="button" class="mt-3" (click)="checkOnce()">
                <tas-icon iconName="feather:refresh-cw" style="font-size:12px"></tas-icon>
                Réessayer
              </button>
            }
            @case ('idle') {
              <div class="flex items-center gap-3">
                <tas-icon iconName="feather:info" class="text-slate-400" style="font-size:16px"></tas-icon>
                <p class="text-sm text-slate-600">
                  @if (sourceStatus() === 'Active') {
                    Le script est actif. Les soumissions créent des leads réels.
                  } @else if (sourceStatus() === 'Testing') {
                    Le script est en mode test.
                  } @else {
                    Installez le script puis cliquez « Vérifier ».
                  }
                </p>
              </div>
              @if (sourceStatus() !== 'Active') {
                <button tas-outlined-button type="button" class="mt-3" (click)="checkOnce()">
                  <tas-icon iconName="feather:refresh-cw" style="font-size:12px"></tas-icon>
                  Vérifier l'installation
                </button>
              }
            }
          }
        </div>
      </tas-card>

      <!-- Test leads panel -->
      @if (sourceStatus() === 'Testing' || sourceStatus() === 'Active') {
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100 flex items-center justify-between">
            <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <tas-icon iconName="feather:users" class="text-slate-400" style="font-size:14px"></tas-icon>
              Leads de test
            </p>
            <button tas-outlined-button type="button" class="text-xs" (click)="refreshTestLeads()">
              <tas-icon iconName="feather:refresh-cw" style="font-size:10px"></tas-icon>
              Rafraîchir
            </button>
          </div>
          <div class="p-4">
            @if (isLoadingLeads()) {
              <div class="flex justify-center py-6">
                <tas-spinner size="5"></tas-spinner>
              </div>
            } @else if (testLeads().length === 0) {
              <div class="flex flex-col items-center py-8 text-center">
                <tas-icon iconName="feather:inbox" class="text-slate-300 mb-2" style="font-size:24px"></tas-icon>
                <p class="text-sm text-slate-500">Aucun lead de test reçu</p>
                <p class="text-xs text-slate-400 mt-1">Soumettez le formulaire de votre site pour tester la chaîne complète.</p>
              </div>
            } @else {
              <div class="space-y-2">
                @for (ing of testLeads(); track ing.id) {
                  <div class="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
                    <tas-icon iconName="feather:user" class="text-slate-400" style="font-size:14px"></tas-icon>
                    <div class="flex-1 min-w-0">
                      <p class="text-xs font-medium text-slate-700 truncate">
                        {{ ing.externalId || 'Soumission ' + (ing.id ?? '').slice(0, 8) }}
                      </p>
                      <p class="text-[10px] text-slate-400">{{ ing.ingestedAt }}</p>
                      @if (ing.rejectionReason) {
                        <p class="text-[10px] text-red-500">{{ ing.rejectionReason }}</p>
                      }
                    </div>
                    <tas-tag severity="info">Test</tas-tag>
                    @if (ing.status !== 'Accepted') {
                      <tas-tag severity="error">{{ ing.status }}</tas-tag>
                    }
                  </div>
                }
              </div>
            }
          </div>
        </tas-card>

        <!-- Activate button -->
        @if (sourceStatus() === 'Testing' && acceptedCount() > 0) {
          <div class="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-green-800">Prêt pour l'activation</p>
              <p class="text-xs text-green-600 mt-0.5">
                {{ acceptedCount() }} lead(s) de test reçu(s) sans erreur. Vous pouvez activer la source.
              </p>
            </div>
            <button tas-raised-button color="primary" type="button"
                    [disabled]="isActivating()"
                    [isLoading]="isActivating()"
                    (click)="activate()">
              <tas-icon iconName="feather:play" style="font-size:14px"></tas-icon>
              Activer la source
            </button>
          </div>
        }
      }
    </div>
  `,
})
export class ScriptVerifier implements OnInit, OnDestroy {
  private readonly _sourcesService = inject(LeadSourcesService);
  private readonly _ingestionsApi = inject(IngestionsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public readonly sourceId = input.required<string>();
  public readonly sourceStatus = input<string | null>(null);
  public readonly activated = output<void>();

  // Detection
  public detectionStatus = signal<DetectionStatus>('idle');
  public detectedOrigin = signal<string | null>(null);
  public autoRefreshActive = signal(false);
  public remainingChecks = signal(0);
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  // Test leads
  /**
   * FE-12 AC3 — vraies receptions de la source, et non les leads simules du
   * dry-run : l'ecran doit prouver que la chaine complete fonctionne.
   */
  public testLeads = signal<IngestionDto[]>([]);

  public readonly acceptedCount = computed(
    () => this.testLeads().filter((i) => i.status === 'Accepted').length,
  );
  public isLoadingLeads = signal(false);
  public isActivating = signal(false);

  ngOnInit(): void {
    const status = this.sourceStatus();
    if (status === 'Draft') {
      this.detectionStatus.set('waiting');
      this.startPolling();
    } else if (status === 'Testing') {
      this.detectionStatus.set('detected');
      this.refreshTestLeads();
    } else if (status === 'Active') {
      this.detectionStatus.set('idle');
    }
  }

  ngOnDestroy(): void {
    this._stopPolling();
  }

  public startPolling(): void {
    this._stopPolling();
    this.autoRefreshActive.set(true);
    this.remainingChecks.set(30); // 5 minutes at 10s intervals
    this._pollTimer = setInterval(() => {
      this.remainingChecks.update((n) => n - 1);
      if (this.remainingChecks() <= 0) {
        this._stopPolling();
        return;
      }
      this.checkOnce();
    }, 10_000);
  }

  public checkOnce(): void {
    // Reload the source to check if status changed to Testing (ping was detected server-side)
    this._sourcesService.get(this.sourceId()).pipe(
      catchError(() => {
        this.detectionStatus.set('error');
        return EMPTY;
      }),
    ).subscribe((detail) => {
      if (detail.status === 'Testing' || detail.status === 'Active') {
        this.detectionStatus.set('detected');
        this._stopPolling();
        this.refreshTestLeads();
      }
    });
  }

  public refreshTestLeads(): void {
    this.isLoadingLeads.set(true);
    this._ingestionsApi.listIngestions(this.sourceId(), undefined, 1, 20).pipe(
      catchError(() => {
        this.isLoadingLeads.set(false);
        return EMPTY;
      }),
    ).subscribe((result) => {
      this.testLeads.set(result.items ?? []);
      this.isLoadingLeads.set(false);
    });
  }

  public activate(): void {
    this._confirm.confirm({
      title: 'Activer la source ?',
      message: 'Les soumissions suivantes créeront des leads réels et seront dispatchées selon les règles configurées.',
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Activer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isActivating.set(true);
        this._sourcesService.activate(this.sourceId()).pipe(
          catchError(() => {
            this.isActivating.set(false);
            return EMPTY;
          }),
        ).subscribe(() => {
          this._snackbar.success('Source activée', 'Les leads réels seront désormais créés.');
          this.isActivating.set(false);
          this.activated.emit();
        });
      },
    });
  }

  private _stopPolling(): void {
    this.autoRefreshActive.set(false);
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }
}

export default ScriptVerifier;
