import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasSwitch } from '@talisoft/ui/switch';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { ScoringConfigsApiService, ScoringConfigDto } from '@sankore/crm-api';
import { BreadcrumbService, HasPermissionDirective } from '@sankore/crm/common';

type ViewState = 'list' | 'form';

interface WeightField { key: keyof Pick<ScoringConfigDto, 'weightDemographics' | 'weightEngagement' | 'weightProduct' | 'weightChannel' | 'weightRecency'>; label: string }
const WEIGHT_FIELDS: WeightField[] = [
  { key: 'weightDemographics', label: 'Données démographiques' },
  { key: 'weightEngagement',   label: 'Engagement' },
  { key: 'weightProduct',      label: 'Produit' },
  { key: 'weightChannel',      label: 'Canal' },
  { key: 'weightRecency',      label: 'Récence' },
];

@Component({
  selector: 'scoring-configs',
  imports: [
    FormsModule, TasCard, TasSpinner, TasIcon, TasTag, Button, TasSwitch,
    TasFormField, TasLabel, TasInput, HasPermissionDirective,
  ],
  template: `
    <ng-container>
      @if (isLoading()) {
        <div class="flex justify-center py-24"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
      } @else if (viewState() === 'list') {
        <div class="pb-6">
          <div class="flex items-start justify-between mb-6">
            <div>
              <h1 class="text-lg font-semibold text-slate-800">Règles de scoring</h1>
              <p class="text-sm text-slate-500 mt-0.5">Ajustez les poids et seuils du Lead Score.</p>
            </div>
            <button tas-button color="primary" type="button" (click)="startCreate()">
              <tas-icon iconName="feather:plus" style="font-size:14px"></tas-icon> Nouvelle version
            </button>
          </div>

          @if (configs().length === 0) {
            <tas-card class="block">
              <div class="flex flex-col items-center justify-center py-16 text-center">
                <tas-icon iconName="feather:bar-chart-2" class="text-slate-300 mb-2" style="font-size:28px"></tas-icon>
                <p class="text-sm text-slate-400">Aucune configuration de scoring</p>
              </div>
            </tas-card>
          } @else {
            <div class="flex flex-col gap-3">
              @for (cfg of configs(); track cfg.id) {
                <tas-card class="block">
                  <div class="p-4 flex items-center gap-4">
                    <div class="flex-1 min-w-0 cursor-pointer" (click)="startEdit(cfg)">
                      <div class="flex items-center gap-2">
                        <p class="text-sm font-semibold text-slate-800">{{ cfg.name }}</p>
                        <span class="text-[10px] text-slate-400">v{{ cfg.version }}</span>
                        @if (cfg.isActive) { <tas-tag severity="success">Active</tas-tag> }
                        @else { <tas-tag severity="neutral">Archivée</tas-tag> }
                      </div>
                      <p class="text-xs text-slate-400 mt-1">
                        Seuil : {{ cfg.qualificationThreshold }} · Démog. {{ cfg.weightDemographics }} · Engag. {{ cfg.weightEngagement }} · Prod. {{ cfg.weightProduct }}
                      </p>
                    </div>
                    @if (!cfg.isActive) {
                      <button tas-outlined-button type="button" class="text-xs shrink-0" (click)="activate(cfg)">
                        <tas-icon iconName="feather:zap" style="font-size:12px"></tas-icon> Activer
                      </button>
                    }
                    <button tas-outlined-button type="button" class="text-xs shrink-0" (click)="startEdit(cfg)">
                      <tas-icon iconName="feather:eye" style="font-size:12px"></tas-icon> {{ cfg.isActive ? 'Voir' : 'Modifier' }}
                    </button>
                  </div>
                </tas-card>
              }
            </div>
          }
        </div>
      } @else {
        <!-- FORM VIEW -->
        <div class="pb-6">
          <div class="flex items-center gap-3 mb-6">
            <button type="button" class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200"
              (click)="viewState.set('list')">
              <tas-icon iconName="feather:arrow-left" style="font-size:14px"></tas-icon>
            </button>
            <h1 class="text-lg font-semibold text-slate-800 flex-1">
              {{ editId() ? (editReadonly() ? 'Version archivée' : 'Modifier') : 'Nouvelle version' }}
            </h1>
            @if (!editReadonly()) {
              <button tas-button color="primary" type="button" [disabled]="isSaving() || !editName()" (click)="save()">
                @if (isSaving()) { <tas-spinner size="3" class="text-white"></tas-spinner> }
                Enregistrer
              </button>
            }
          </div>

          @if (editReadonly()) {
            <div class="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-2">
              <tas-icon iconName="feather:lock" class="text-slate-400" style="font-size:14px"></tas-icon>
              <p class="text-xs text-slate-500">Cette version est archivée et consultable en lecture seule.</p>
            </div>
          }

          <tas-card class="mb-4 block">
            <div class="p-4 flex flex-col gap-3">
              <tas-form-field>
                <tas-label>Nom</tas-label>
                <input tasInput type="text" placeholder="Ex : Config scoring v2" [ngModel]="editName()" (ngModelChange)="editName.set($event)" [disabled]="editReadonly()" />
              </tas-form-field>
              <tas-form-field>
                <tas-label>Seuil de qualification (0–100)</tas-label>
                <input tasInput type="number" min="0" max="100" [ngModel]="editThreshold()" (ngModelChange)="editThreshold.set($event)" [disabled]="editReadonly()" />
              </tas-form-field>
            </div>
          </tas-card>

          <tas-card class="mb-4 block">
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">Pondération des critères</p>
              <p class="text-xs text-slate-400 mt-0.5">Ajustez l'importance de chaque facteur (0–100).</p>
            </div>
            <div class="p-4 flex flex-col gap-3">
              @for (wf of weightFields; track wf.key) {
                <div class="flex items-center gap-3">
                  <span class="text-sm text-slate-700 w-44 shrink-0">{{ wf.label }}</span>
                  <input type="range" min="0" max="100" class="flex-1 accent-primary"
                    [ngModel]="editWeights()[wf.key] ?? 50" (ngModelChange)="setWeight(wf.key, $event)" [disabled]="editReadonly()" />
                  <span class="text-sm font-semibold text-slate-800 tabular-nums w-8 text-right">{{ editWeights()[wf.key] ?? 50 }}</span>
                </div>
              }
            </div>
          </tas-card>
        </div>
      }
    </ng-container>
  `,
})
export class ScoringConfigsPage implements OnInit {
  private readonly _api = inject(ScoringConfigsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public readonly weightFields = WEIGHT_FIELDS;

  public isLoading = signal(true);
  public isSaving = signal(false);
  public viewState = signal<ViewState>('list');
  public configs = signal<ScoringConfigDto[]>([]);

  // Form
  public editId = signal<string | null>(null);
  public editReadonly = signal(false);
  public editName = signal('');
  public editThreshold = signal<number>(60);
  public editWeights = signal<Record<string, number>>({
    weightDemographics: 50, weightEngagement: 50, weightProduct: 50, weightChannel: 30, weightRecency: 40,
  });

  ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Paramétrage', link: ['/settings'] }, { label: 'Scoring' }]);
    this._load();
  }

  public setWeight(key: string, value: number): void {
    this.editWeights.update((w) => ({ ...w, [key]: value }));
  }

  public startCreate(): void {
    this.editId.set(null); this.editReadonly.set(false); this.editName.set('');
    this.editThreshold.set(60);
    this.editWeights.set({ weightDemographics: 50, weightEngagement: 50, weightProduct: 50, weightChannel: 30, weightRecency: 40 });
    this.viewState.set('form');
  }

  public startEdit(cfg: ScoringConfigDto): void {
    this.editId.set(cfg.id ?? null);
    this.editReadonly.set(!cfg.isActive);
    this.editName.set(cfg.name ?? '');
    this.editThreshold.set(cfg.qualificationThreshold ?? 60);
    this.editWeights.set({
      weightDemographics: cfg.weightDemographics ?? 50,
      weightEngagement: cfg.weightEngagement ?? 50,
      weightProduct: cfg.weightProduct ?? 50,
      weightChannel: cfg.weightChannel ?? 30,
      weightRecency: cfg.weightRecency ?? 40,
    });
    this.viewState.set('form');
  }

  public activate(cfg: ScoringConfigDto): void {
    this._confirmDialog.confirm({
      title: 'Activer cette version ?',
      message: `Un recalcul de masse de tous les scores existants sera exécuté en tâche de fond. Cette opération peut prendre plusieurs minutes.`,
      closable: true, showCancelButton: true,
      acceptButtonProps: { label: 'Activer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this._api.activateScoringConfig(cfg.id!).pipe(
          catchError(() => { this._snackbar.error('Erreur', 'Activation échouée.'); return EMPTY; }),
        ).subscribe(() => {
          this._snackbar.info('Version activée', 'Un recalcul de masse sera exécuté en tâche de fond.');
          this._load();
        });
      },
    });
  }

  public save(): void {
    if (!this.editName()) return;
    this.isSaving.set(true);
    const w = this.editWeights();
    const payload = {
      name: this.editName(), qualificationThreshold: this.editThreshold(),
      weightDemographics: w['weightDemographics'], weightEngagement: w['weightEngagement'],
      weightProduct: w['weightProduct'], weightChannel: w['weightChannel'], weightRecency: w['weightRecency'],
    };
    const obs = this.editId()
      ? this._api.updateScoringConfig(this.editId()!, payload)
      : this._api.createScoringConfig(payload);
    obs.pipe(catchError(() => { this._snackbar.error('Erreur', 'Sauvegarde échouée.'); return EMPTY; }))
      .subscribe({ next: () => {
        this._snackbar.success('Enregistré', 'Configuration de scoring sauvegardée.');
        if (!this.editId()) {
          this._snackbar.info('Rappel', 'Activez cette version pour déclencher le recalcul des scores.');
        }
        this.viewState.set('list'); this._load();
      }, complete: () => this.isSaving.set(false) });
  }

  private _load(): void {
    this.isLoading.set(true);
    this._api.listScoringConfigs().pipe(catchError(() => { this.isLoading.set(false); return EMPTY; }))
      .subscribe((c) => { this.configs.set(c ?? []); this.isLoading.set(false); });
  }
}

export default ScoringConfigsPage;
