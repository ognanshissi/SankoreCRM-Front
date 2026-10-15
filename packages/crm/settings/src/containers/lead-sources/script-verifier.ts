import { Component, computed, inject, input, output, signal, OnInit, OnDestroy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { IngestionDto, IngestionsApiService } from '@sankore/crm-api';
import { LeadSourcesService } from './lead-sources.service';
import { openIngestionDetail } from './ingestion-detail-drawer';
import { INGESTION_AUTO_REFRESH_MS, ingestionStatusLabel, ingestionStatusSeverity } from './ingestion.types';

/**
 * FE-12 — Vérifier l'installation et envoyer un lead de test
 */

type DetectionStatus = 'waiting' | 'detected' | 'error' | 'idle';

@Component({
  selector: 'script-verifier',
  standalone: true,
  imports: [DatePipe, TasCard, TasTable, TasSpinner, TasIcon, TasTag, Button, TimeagoPipe],
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
                <div class="flex items-center gap-2 mt-3">
                  <button tas-outlined-button type="button" (click)="checkOnce()">
                    <tas-icon iconName="feather:refresh-cw" style="font-size:12px"></tas-icon>
                    Vérifier maintenant
                  </button>
                  <button tas-text-button type="button" (click)="startPolling()">
                    <tas-icon iconName="feather:repeat" style="font-size:12px"></tas-icon>
                    Relancer la vérification automatique
                  </button>
                </div>
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
                    La source est passée en mode Test.
                    @if (lastReceivedAt()) {
                      Dernière réception <strong>{{ lastReceivedAt() | dateTimeAgo }}</strong>.
                    }
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

      <!-- Test leads panel — FE-12 AC3 : reserve au statut « Test ». Sur une source
           active, ces receptions sont de vrais leads : les etiqueter « Test » induisait
           en erreur, et le contrat ne porte aucun drapeau de test (cf. IngestionDto). -->
      @if (sourceStatus() === 'Testing') {
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <tas-icon iconName="feather:users" class="text-slate-400" style="font-size:14px"></tas-icon>
                Leads de test
              </p>
              <p class="text-xs text-slate-400 mt-0.5">
                Ces soumissions ne sont pas dispatchées : aucune règle d'affectation ne s'applique
                tant que la source reste en mode Test.
              </p>
            </div>
            <div class="flex items-center gap-3 shrink-0">
              @if (leadsRefreshedAt()) {
                <span class="text-[10px] text-slate-400 tabular-nums">
                  Mis à jour à {{ leadsRefreshedAt() | date:'HH:mm:ss' }}
                </span>
              }
              <button tas-outlined-button type="button" class="text-xs" (click)="refreshTestLeads()">
                <tas-icon iconName="feather:refresh-cw" style="font-size:10px"></tas-icon>
                Rafraîchir
              </button>
            </div>
          </div>
          @if (leadsError()) {
            <div class="flex flex-col items-center py-8 text-center">
              <tas-icon iconName="feather:alert-triangle" class="text-red-400 mb-2" style="font-size:24px"></tas-icon>
              <p class="text-sm text-red-600">Chargement impossible</p>
              <p class="text-xs text-slate-400 mt-1">
                Nous n'avons pas pu lire les réceptions de cette source. Réessayez avec « Rafraîchir ».
              </p>
            </div>
          } @else if (!isLoadingLeads() && testLeads().length === 0) {
            <div class="flex flex-col items-center py-8 text-center">
              <tas-icon iconName="feather:inbox" class="text-slate-300 mb-2" style="font-size:24px"></tas-icon>
              <p class="text-sm text-slate-500">Aucun lead de test reçu</p>
              <p class="text-xs text-slate-400 mt-1">
                Soumettez le formulaire de votre site pour tester la chaîne complète : la liste se met à jour toute seule.
              </p>
            </div>
          } @else {
            <tas-table [data]="testLeads()" identifierField="id" [config]="testLeadsTableConfig"
                       [isLoading]="isLoadingLeads()">
              <ng-template #header>
                <tr class="text-left text-xs font-medium text-slate-500 border-b border-slate-200">
                  <th class="py-2 px-4 font-medium">Reçu</th>
                  <th class="py-2 px-3 font-medium">Statut</th>
                  <th class="py-2 px-3 font-medium">Motif</th>
                  <th class="py-2 px-4 font-medium text-right"></th>
                </tr>
              </ng-template>
              <ng-template #body let-ing>
                <tr class="cursor-pointer align-middle transition-colors hover:bg-slate-50"
                    [class.bg-blue-50]="isNewLead(ing)"
                    (click)="openDetail(ing)">
                  <td class="py-2.5 px-4 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                    {{ ing.ingestedAt | date:'dd/MM HH:mm:ss' }}
                    <span class="text-slate-400">· {{ ing.ingestedAt | dateTimeAgo }}</span>
                    @if (isNewLead(ing)) {
                      <span class="ml-1 text-[10px] font-medium text-blue-600">Nouveau</span>
                    }
                  </td>
                  <td class="py-2.5 px-3">
                    <tas-tag [severity]="statusSeverity(ing.status)">{{ statusLabel(ing.status) }}</tas-tag>
                  </td>
                  <td class="py-2.5 px-3 max-w-[14rem]">
                    @if (ing.rejectionReason) {
                      <p class="text-xs text-red-500 truncate" [title]="ing.rejectionReason">{{ ing.rejectionReason }}</p>
                    } @else {
                      <span class="text-xs text-slate-400">—</span>
                    }
                  </td>
                  <td class="py-2.5 px-4 text-right">
                    <button tas-icon-button type="button" title="Voir le détail" (click)="$event.stopPropagation(); openDetail(ing)">
                      <tas-icon iconName="feather:eye" style="font-size:12px" class="text-slate-400"></tas-icon>
                    </button>
                  </td>
                </tr>
              </ng-template>
            </tas-table>
          }
        </tas-card>

        <!-- Activate button -->
        @if (sourceStatus() === 'Testing' && acceptedCount() > 0 && !readonly()) {
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
  private readonly _sideDrawer = inject(SideDrawerService);

  public readonly sourceId = input.required<string>();
  public readonly sourceStatus = input<string | null>(null);
  /** Masque « Activer la source » quand l'utilisateur n'a pas le droit d'agir. */
  public readonly readonly = input(false);
  public readonly activated = output<void>();
  /**
   * FE-12 — `sourceStatus` est une entree du parent : sans cette sortie, le
   * passage en « Test » constate ici ne remontait jamais, et le panneau des
   * leads de test comme le bouton d'activation restaient invisibles.
   */
  public readonly detected = output<void>();

  // Detection
  public detectionStatus = signal<DetectionStatus>('idle');
  /** FE-12 AC2 — date de la derniere reception. L'origine n'existe nulle part au contrat. */
  public lastReceivedAt = signal<string | null>(null);
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
  public leadsError = signal(false);
  public isActivating = signal(false);
  public leadsRefreshedAt = signal<Date | null>(null);
  /** Soumissions arrivées par l'actualisation automatique, mises en évidence. */
  public newLeadIds = signal<ReadonlySet<string>>(new Set<string>());
  private _knownLeadIds = new Set<string>();
  private _leadsTimer: ReturnType<typeof setInterval> | null = null;
  private _silentLeadsInFlight = false;

  public readonly testLeadsTableConfig: TableConfig = {
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 20] },
  };

  public readonly statusLabel = ingestionStatusLabel;
  public readonly statusSeverity = ingestionStatusSeverity;

  ngOnInit(): void {
    const status = this.sourceStatus();
    if (status === 'Draft') {
      this.detectionStatus.set('waiting');
      this.startPolling();
    } else if (status === 'Testing') {
      this.detectionStatus.set('detected');
      // `checkOnce()` recharge le detail (donc `lastReceivedAt`) et enchaine sur les leads.
      this.checkOnce();
    } else if (status === 'Active') {
      this.detectionStatus.set('idle');
    }
  }

  ngOnDestroy(): void {
    this._stopPolling();
    this._stopLeadsPolling();
  }

  public isNewLead(ing: IngestionDto): boolean {
    return !!ing.id && this.newLeadIds().has(ing.id);
  }

  public openDetail(ing: IngestionDto): void {
    if (ing.id && this.newLeadIds().has(ing.id)) {
      const next = new Set(this.newLeadIds());
      next.delete(ing.id);
      this.newLeadIds.set(next);
    }
    openIngestionDetail(this._sideDrawer, {
      ingestion: ing,
      // Le rejeu se pilote depuis l'onglet « Réceptions », qui suit son état.
      canReplay: false,
      isScript: true,
    });
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
    // Sans cet appel, la premiere verification n'avait lieu qu'a t+10 s : le bouton
    // « Verifier maintenant » ne verifiait rien pendant dix secondes. Il vient apres
    // l'armement du timer, pour que `_stopPolling()` puisse l'annuler.
    this.checkOnce();
  }

  public checkOnce(): void {
    // Reload the source to check if status changed to Testing (ping was detected server-side)
    this._sourcesService.get(this.sourceId()).pipe(
      catchError(() => {
        this.detectionStatus.set('error');
        return EMPTY;
      }),
    ).subscribe((detail) => {
      // L'appel a abouti : rien ne levait l'etat « Erreur de detection », et une
      // coupure reseau d'une seconde laissait le panneau rouge affiche pour de bon
      // alors que le sondage continuait derriere.
      if (this.detectionStatus() === 'error') {
        this.detectionStatus.set(this.autoRefreshActive() ? 'waiting' : 'idle');
      }

      this.lastReceivedAt.set(detail.lastReceivedAt ?? null);
      const statusChanged = detail.status !== this.sourceStatus();

      if (detail.status === 'Testing' || detail.status === 'Active') {
        this.detectionStatus.set('detected');
        this._stopPolling();
        this.refreshTestLeads();
        // Le sondage de détection s'arrête dès le passage en Test : sans ce
        // second sondage, une soumission faite ensuite sur le site n'apparaissait
        // qu'après un clic sur « Rafraîchir ».
        if (detail.status === 'Testing') this._startLeadsPolling();
        else this._stopLeadsPolling();
      }

      // Le parent recharge la source, ce qui rafraichit l'entree `sourceStatus`.
      if (statusChanged) this.detected.emit();
    });
  }

  public refreshTestLeads(silent = false): void {
    if (silent) {
      this._silentLeadsInFlight = true;
    } else {
      this.isLoadingLeads.set(true);
      this.leadsError.set(false);
    }
    // Cet appel passe en direct par l'API generee, donc sans la gestion d'erreur
    // de `LeadSourcesService` : un 500 s'affichait comme « Aucun lead de test recu ».
    this._ingestionsApi.listIngestions(this.sourceId(), undefined, 1, 20).pipe(
      catchError(() => {
        this._silentLeadsInFlight = false;
        // Une actualisation automatique ratée garde la liste affichée, sans toast.
        if (silent) return EMPTY;
        this.leadsError.set(true);
        this.isLoadingLeads.set(false);
        this._snackbar.error(
          'Erreur',
          'Impossible de charger les leads de test de cette source.',
        );
        return EMPTY;
      }),
    ).subscribe((result) => {
      const items = result.items ?? [];
      if (silent) {
        const fresh = items.filter((i) => i.id && !this._knownLeadIds.has(i.id)).map((i) => i.id!);
        if (fresh.length) this.newLeadIds.set(new Set([...this.newLeadIds(), ...fresh]));
      }
      for (const item of items) if (item.id) this._knownLeadIds.add(item.id);

      this.testLeads.set(items);
      this.leadsError.set(false);
      this.isLoadingLeads.set(false);
      this._silentLeadsInFlight = false;
      this.leadsRefreshedAt.set(new Date());
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
          this._stopLeadsPolling();
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

  private _startLeadsPolling(): void {
    if (this._leadsTimer) return;
    this._leadsTimer = setInterval(() => {
      if (document.hidden || this.isLoadingLeads() || this._silentLeadsInFlight) return;
      this.refreshTestLeads(true);
    }, INGESTION_AUTO_REFRESH_MS);
  }

  private _stopLeadsPolling(): void {
    if (this._leadsTimer) {
      clearInterval(this._leadsTimer);
      this._leadsTimer = null;
    }
  }
}

export default ScriptVerifier;
