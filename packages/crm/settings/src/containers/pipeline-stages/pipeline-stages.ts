import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { catchError, EMPTY, forkJoin, of } from 'rxjs';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { TasSwitch } from '@talisoft/ui/switch';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  LeadsApiService,
  LeadStatsDto,
  ProductsApiService,
  ProductDto,
} from '@sankore/crm-api';
import { BreadcrumbService, HasPermissionDirective } from '@sankore/crm/common';

interface PipelineStage {
  key: string;
  label: string;
  color: string;
  enabled: boolean;
  order: number;
  /** Live count of leads in this stage (from stats) */
  leadCount: number;
}

const DEFAULT_STAGES: Omit<PipelineStage, 'leadCount'>[] = [
  { key: 'New',                  label: 'Nouveau',          color: '#6366f1', enabled: true,  order: 0 },
  { key: 'ContactAttempted',     label: 'Contact tenté',    color: '#818cf8', enabled: true,  order: 1 },
  { key: 'ContactEstablished',   label: 'Contact établi',   color: '#f59e0b', enabled: true,  order: 2 },
  { key: 'NeedIdentified',       label: 'Besoin identifié', color: '#f97316', enabled: true,  order: 3 },
  { key: 'Qualified',            label: 'Qualifié',         color: '#8b5cf6', enabled: true,  order: 4 },
  { key: 'ProductProposed',      label: 'Produit proposé',  color: '#3b82f6', enabled: true,  order: 5 },
  { key: 'ApplicationStarted',   label: 'Dossier démarré',  color: '#0ea5e9', enabled: true,  order: 6 },
  { key: 'DocumentCollection',   label: 'Collecte docs',    color: '#06b6d4', enabled: true,  order: 7 },
  { key: 'ApplicationCompleted', label: 'Dossier complet',  color: '#14b8a6', enabled: true,  order: 8 },
  { key: 'ApprovalPending',      label: 'En approbation',   color: '#84cc16', enabled: true,  order: 9 },
  { key: 'Converted',            label: 'Converti',         color: '#22c55e', enabled: true,  order: 10 },
  { key: 'Lost',                 label: 'Perdu',            color: '#ef4444', enabled: true,  order: 11 },
];

const DRAFT_STORAGE_KEY = 'pipeline_stages_draft';

@Component({
  selector: 'pipeline-stages-config',
  imports: [
    TasCard,
    TasSpinner,
    TasIcon,
    Button,
    TasSwitch,
    DragDropModule,
    HasPermissionDirective,
  ],
  template: `
    <ng-container *hasPermission="'pipeline.configure'">
      @if (isLoading()) {
        <div class="flex justify-center py-24">
          <tas-spinner size="10" class="text-primary"></tas-spinner>
        </div>
      } @else {
        <div class="pb-6">
          <!-- Header -->
          <div class="flex items-start justify-between mb-6">
            <div>
              <h1 class="text-lg font-semibold text-slate-800">Étapes du pipeline</h1>
              <p class="text-sm text-slate-500 mt-0.5">
                Définissez, réordonnez et activez/désactivez les étapes du pipeline commercial.
              </p>
            </div>
            <div class="flex items-center gap-2">
              @if (isDirty()) {
                <button
                  tas-outlined-button
                  type="button"
                  (click)="resetChanges()"
                >
                  Annuler
                </button>
              }
              <button
                tas-button
                color="primary"
                type="button"
                [disabled]="!isDirty() || isSaving()"
                (click)="saveAll()"
              >
                @if (isSaving()) {
                  <tas-spinner size="3" class="text-white"></tas-spinner>
                }
                Enregistrer
              </button>
            </div>
          </div>

          <!-- Product filter -->
          @if (products().length > 1) {
            <div class="flex items-center gap-1.5 mb-4 flex-wrap">
              <button
                type="button"
                class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                [class]="selectedProduct() === ''
                  ? 'bg-primary/15 text-primary'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
                (click)="selectedProduct.set('')"
              >
                Tous les produits
              </button>
              @for (p of products(); track p.id) {
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                  [class]="selectedProduct() === p.code
                    ? 'bg-primary/15 text-primary'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
                  (click)="selectedProduct.set(p.code ?? '')"
                >
                  {{ p.name }}
                </button>
              }
            </div>
          }

          <!-- Pipeline preview -->
          <tas-card class="mb-4 block">
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">Aperçu du pipeline</p>
            </div>
            <div class="p-4">
              <div class="flex items-center gap-1 overflow-x-auto">
                @for (stage of enabledStages(); track stage.key; let last = $last) {
                  <div class="flex items-center gap-1 shrink-0">
                    <div
                      class="px-2.5 py-1 rounded text-[10px] font-medium text-white whitespace-nowrap"
                      [style.background-color]="stage.color"
                    >
                      {{ stage.label }}
                    </div>
                    @if (!last) {
                      <tas-icon iconName="feather:chevron-right" class="text-slate-300" style="font-size:12px"></tas-icon>
                    }
                  </div>
                }
              </div>
            </div>
          </tas-card>

          <!-- Sortable stages list -->
          <tas-card class="block">
            <div class="p-4 border-b border-slate-100">
              <div class="flex items-center justify-between">
                <p class="text-sm font-semibold text-slate-700">Configuration des étapes</p>
                <span class="text-xs text-slate-400">
                  {{ enabledStages().length }} active{{ enabledStages().length > 1 ? 's' : '' }}
                  sur {{ stages().length }}
                </span>
              </div>
              <p class="text-xs text-slate-400 mt-0.5">
                Glissez-déposez pour réordonner. Utilisez le switch pour activer/désactiver.
              </p>
            </div>

            <div
              cdkDropList
              (cdkDropListDropped)="onReorder($event)"
              class="divide-y divide-slate-100"
            >
              @for (stage of stages(); track stage.key) {
                <div
                  cdkDrag
                  class="flex items-center gap-4 px-4 py-3 bg-white hover:bg-slate-50 transition-colors"
                  [class.opacity-50]="!stage.enabled"
                >
                  <!-- Drag handle -->
                  <div cdkDragHandle class="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500">
                    <tas-icon iconName="feather:menu" style="font-size:16px"></tas-icon>
                  </div>

                  <!-- Drag placeholder -->
                  <div cdkDragPlaceholder class="bg-primary/5 border-2 border-dashed border-primary/30 rounded h-12 w-full"></div>

                  <!-- Color indicator -->
                  <div
                    class="w-3 h-3 rounded-full shrink-0"
                    [style.background-color]="stage.color"
                  ></div>

                  <!-- Label + key -->
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-slate-800">{{ stage.label }}</p>
                    <p class="text-[10px] text-slate-400 font-mono">{{ stage.key }}</p>
                  </div>

                  <!-- Lead count -->
                  @if (stage.leadCount > 0) {
                    <span class="text-xs text-slate-400 tabular-nums shrink-0">
                      {{ stage.leadCount }} lead{{ stage.leadCount > 1 ? 's' : '' }}
                    </span>
                  }

                  <!-- Order badge -->
                  <span class="w-6 h-6 rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500 flex items-center justify-center tabular-nums shrink-0">
                    {{ $index + 1 }}
                  </span>

                  <!-- Toggle switch -->
                  <div class="shrink-0" (click)="$event.stopPropagation()">
                    <tas-switch
                      [checked]="stage.enabled"
                      [ariaLabel]="stage.enabled ? 'Désactiver ' + stage.label : 'Activer ' + stage.label"
                      (toggle)="onToggleStage(stage, $event)"
                    ></tas-switch>
                  </div>
                </div>
              }
            </div>
          </tas-card>

          @if (isDirty()) {
            <div class="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-2">
              <tas-icon iconName="feather:info" class="text-amber-500 shrink-0" style="font-size:14px"></tas-icon>
              <p class="text-xs text-amber-700">
                Des modifications non enregistrées sont en attente. Cliquez sur « Enregistrer » pour appliquer.
              </p>
            </div>
          }
        </div>
      }
    </ng-container>
  `,
})
export class PipelineStagesConfig implements OnInit {
  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _productsApiService = inject(ProductsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public isLoading = signal(true);
  public isSaving = signal(false);
  public products = signal<ProductDto[]>([]);
  public selectedProduct = signal('');

  /** Current working copy of stages */
  public stages = signal<PipelineStage[]>([]);
  /** Snapshot of server state for dirty-checking */
  private _savedSnapshot: PipelineStage[] = [];

  public readonly enabledStages = computed(() =>
    this.stages().filter((s) => s.enabled),
  );

  public readonly isDirty = computed(() => {
    const current = this.stages();
    if (current.length !== this._savedSnapshot.length) return true;
    return current.some((s, i) => {
      const saved = this._savedSnapshot[i];
      return s.key !== saved.key || s.enabled !== saved.enabled || s.order !== saved.order;
    });
  });

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Pipeline' },
    ]);
    this._load();
  }

  public onReorder(event: CdkDragDrop<void>): void {
    this.stages.update((list) => {
      const reordered = [...list];
      moveItemInArray(reordered, event.previousIndex, event.currentIndex);
      return reordered.map((s, i) => ({ ...s, order: i }));
    });
  }

  public onToggleStage(stage: PipelineStage, enabled: boolean): void {
    if (!enabled && stage.leadCount > 0) {
      this._confirmDialog.confirm({
        title: 'Désactiver cette étape ?',
        message: `${stage.leadCount} lead${stage.leadCount > 1 ? 's' : ''} actif${stage.leadCount > 1 ? 's' : ''} se trouve${stage.leadCount > 1 ? 'nt' : ''} actuellement dans l'étape « ${stage.label} ». Désactiver cette étape les masquera du pipeline.`,
        closable: true,
        showCancelButton: true,
        acceptButtonProps: { label: 'Désactiver', theme: 'warn' },
        rejectButtonProps: { label: 'Annuler' },
        accept: () => this._setStageEnabled(stage.key, false),
      });
    } else {
      this._setStageEnabled(stage.key, enabled);
    }
  }

  public saveAll(): void {
    this.isSaving.set(true);

    const payload = this.stages().map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      enabled: s.enabled,
      order: s.order,
    }));

    // Save as a single batch operation via localStorage
    // (The API currently has per-lead stage updates but no admin config endpoint.
    //  We persist the pipeline config locally per tenant until the backend provides one.)
    try {
      const productKey = this.selectedProduct() || '__default__';
      localStorage.setItem(
        `${DRAFT_STORAGE_KEY}_${productKey}`,
        JSON.stringify(payload),
      );
      this._savedSnapshot = this.stages().map((s) => ({ ...s }));
      this._snackbar.success('Pipeline enregistré', 'La configuration du pipeline a été sauvegardée.');
    } catch {
      this._snackbar.error('Erreur', 'Impossible de sauvegarder la configuration.');
    } finally {
      this.isSaving.set(false);
    }
  }

  public resetChanges(): void {
    this.stages.set(this._savedSnapshot.map((s) => ({ ...s })));
  }

  private _setStageEnabled(key: string, enabled: boolean): void {
    this.stages.update((list) =>
      list.map((s) => (s.key === key ? { ...s, enabled } : s)),
    );
  }

  private _load(): void {
    this.isLoading.set(true);

    forkJoin({
      stats: this._leadsApiService.getLeadStats().pipe(catchError(() => of({} as LeadStatsDto))),
      products: this._productsApiService.listProducts().pipe(catchError(() => of([] as ProductDto[]))),
    }).subscribe({
      next: ({ stats, products }) => {
        this.products.set(products ?? []);
        const stageStats = stats?.byPipelineStage ?? [];

        // Try to restore saved config
        const productKey = this.selectedProduct() || '__default__';
        let savedConfig: any[] | null = null;
        try {
          const raw = localStorage.getItem(`${DRAFT_STORAGE_KEY}_${productKey}`);
          if (raw) savedConfig = JSON.parse(raw);
        } catch { /* ignore */ }

        const stages: PipelineStage[] = (savedConfig ?? DEFAULT_STAGES).map((s: any, i: number) => ({
          key: s.key,
          label: s.label,
          color: s.color,
          enabled: s.enabled ?? true,
          order: s.order ?? i,
          leadCount: stageStats.find((sc: any) => sc.stage === s.key)?.count ?? 0,
        }));

        stages.sort((a, b) => a.order - b.order);
        this.stages.set(stages);
        this._savedSnapshot = stages.map((s) => ({ ...s }));
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }
}

export default PipelineStagesConfig;
