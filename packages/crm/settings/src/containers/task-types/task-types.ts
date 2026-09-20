import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasSwitch } from '@talisoft/ui/switch';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TaskTypesApiService, TaskTypeDto } from '@sankore/crm-api';
import { BreadcrumbService, HasPermissionDirective } from '@sankore/crm/common';

@Component({
  selector: 'task-types-config',
  imports: [
    FormsModule, TasCard, TasSpinner, TasIcon, TasTag, Button, TasSwitch,
    TasFormField, TasLabel, TasError, TasInput, HasPermissionDirective,
  ],
  template: `
    <ng-container>
      @if (isLoading()) {
        <div class="flex justify-center py-24"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
      } @else {
        <div class="pb-6">
          <div class="flex items-start justify-between mb-6">
            <div>
              <h1 class="text-lg font-semibold text-slate-800">Types de tâches</h1>
              <p class="text-sm text-slate-500 mt-0.5">Définissez les types disponibles dans les formulaires de tâches.</p>
            </div>
          </div>

          <!-- Create form -->
          <tas-card class="mb-4 block">
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">Ajouter un type</p>
            </div>
            <div class="p-4">
              <div class="grid grid-cols-3 gap-3">
                <tas-form-field>
                  <tas-label>Code <span class="text-red-500">*</span></tas-label>
                  <input tasInput type="text" placeholder="Ex : VISITE_TERRAIN" [ngModel]="newCode()" (ngModelChange)="newCode.set($event)" />
                </tas-form-field>
                <tas-form-field>
                  <tas-label>Libellé <span class="text-red-500">*</span></tas-label>
                  <input tasInput type="text" placeholder="Ex : Visite terrain" [ngModel]="newLabel()" (ngModelChange)="newLabel.set($event)" />
                </tas-form-field>
                <div class="flex items-end">
                  <button tas-button color="primary" type="button" [disabled]="isCreating() || !newCode() || !newLabel()" (click)="create()">
                    @if (isCreating()) { <tas-spinner size="3" class="text-white"></tas-spinner> }
                    Ajouter
                  </button>
                </div>
              </div>
              <div class="mt-2">
                <tas-form-field>
                  <tas-label>Description</tas-label>
                  <input tasInput type="text" placeholder="Description optionnelle" [ngModel]="newDescription()" (ngModelChange)="newDescription.set($event)" />
                </tas-form-field>
              </div>
            </div>
          </tas-card>

          <!-- Info -->
          <div class="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 flex items-center gap-2">
            <tas-icon iconName="feather:info" class="text-blue-500 shrink-0" style="font-size:14px"></tas-icon>
            <p class="text-xs text-blue-700">
              Les nouveaux types sont immédiatement disponibles dans les formulaires de clôture de tâche, sans redéploiement.
            </p>
          </div>

          <!-- Types list -->
          <tas-card class="block">
            <div class="p-4 border-b border-slate-100 flex items-center justify-between">
              <p class="text-sm font-semibold text-slate-700">Types configurés</p>
              <span class="text-xs text-slate-400">{{ taskTypes().length }} type(s)</span>
            </div>
            @if (taskTypes().length === 0) {
              <div class="flex flex-col items-center justify-center py-12 text-center">
                <tas-icon iconName="feather:check-square" class="text-slate-300 mb-2" style="font-size:28px"></tas-icon>
                <p class="text-sm text-slate-400">Aucun type de tâche configuré</p>
              </div>
            } @else {
              <div class="divide-y divide-slate-100">
                @for (tt of taskTypes(); track tt.id) {
                  <div class="flex items-center gap-4 px-4 py-3" [class.opacity-50]="!tt.isActive">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <p class="text-sm font-medium text-slate-800">{{ tt.label }}</p>
                        <span class="text-[10px] text-slate-400 font-mono bg-slate-50 px-1.5 py-0.5 rounded">{{ tt.code }}</span>
                        @if (tt.isSystem) { <tas-tag severity="neutral">Système</tas-tag> }
                        @if (!tt.isActive) { <tas-tag severity="warning">Désactivé</tas-tag> }
                      </div>
                      @if (tt.description) { <p class="text-xs text-slate-400 mt-0.5">{{ tt.description }}</p> }
                    </div>
                    @if (!tt.isSystem) {
                      <tas-switch
                        [checked]="tt.isActive ?? false"
                        [ariaLabel]="(tt.isActive ? 'Désactiver' : 'Activer') + ' ' + (tt.label ?? '')"
                        [isLoading]="togglingId() === tt.id"
                        (toggle)="toggleActive(tt, $event)"
                      ></tas-switch>
                    }
                  </div>
                }
              </div>
            }
          </tas-card>
        </div>
      }
    </ng-container>
  `,
})
export class TaskTypesConfig implements OnInit {
  private readonly _api = inject(TaskTypesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public isLoading = signal(true);
  public isCreating = signal(false);
  public togglingId = signal<string | null>(null);
  public taskTypes = signal<TaskTypeDto[]>([]);
  public newCode = signal('');
  public newLabel = signal('');
  public newDescription = signal('');

  ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Paramétrage', link: ['/settings'] }, { label: 'Types de tâches' }]);
    this._load();
  }

  public create(): void {
    if (!this.newCode() || !this.newLabel()) return;
    this.isCreating.set(true);
    this._api.createTaskType({
      code: this.newCode(), label: this.newLabel(),
      description: this.newDescription() || undefined,
    }).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Impossible de créer le type.'); return EMPTY; }),
    ).subscribe(() => {
      this._snackbar.success('Type créé', `« ${this.newLabel()} » est immédiatement disponible.`);
      this.newCode.set(''); this.newLabel.set(''); this.newDescription.set('');
      this.isCreating.set(false);
      this._load();
    });
  }

  public toggleActive(tt: TaskTypeDto, active: boolean): void {
    if (!active) {
      this._confirmDialog.confirm({
        title: 'Désactiver ce type ?',
        message: `Le type « ${tt.label} » ne sera plus proposé dans les formulaires. Les tâches existantes de ce type ne sont pas impactées.`,
        closable: true, showCancelButton: true,
        acceptButtonProps: { label: 'Désactiver', theme: 'warn' },
        rejectButtonProps: { label: 'Annuler' },
        accept: () => this._toggle(tt, false),
      });
    } else {
      this._toggle(tt, true);
    }
  }

  private _toggle(tt: TaskTypeDto, active: boolean): void {
    this.togglingId.set(tt.id ?? null);
    const obs = active ? this._api.activateTaskType(tt.id!) : this._api.deactivateTaskType(tt.id!);
    obs.pipe(catchError(() => { this._snackbar.error('Erreur', 'Opération échouée.'); return EMPTY; }))
      .subscribe({ next: () => {
        this.taskTypes.update((l) => l.map((t) => t.id === tt.id ? { ...t, isActive: active } : t));
        this._snackbar.success('Succès', `Type ${active ? 'activé' : 'désactivé'}.`);
      }, complete: () => this.togglingId.set(null) });
  }

  private _load(): void {
    this.isLoading.set(true);
    this._api.listTaskTypes().pipe(catchError(() => { this.isLoading.set(false); return EMPTY; }))
      .subscribe((t) => { this.taskTypes.set(t ?? []); this.isLoading.set(false); });
  }
}

export default TaskTypesConfig;
