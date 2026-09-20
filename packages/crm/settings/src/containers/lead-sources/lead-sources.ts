import { Component, computed, inject, signal, OnInit } from '@angular/core';
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
import { LeadSourcesApiService, LeadSourceDto } from '@sankore/crm-api';
import { BreadcrumbService, HasPermissionDirective } from '@sankore/crm/common';

@Component({
  selector: 'lead-sources-config',
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
              <h1 class="text-lg font-semibold text-slate-800">Sources & Campagnes</h1>
              <p class="text-sm text-slate-500 mt-0.5">Gérez les sources d'acquisition et campagnes de leads.</p>
            </div>
          </div>

          <!-- Create form -->
          <tas-card class="mb-4 block">
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">Ajouter une source</p>
            </div>
            <div class="p-4">
              <div class="grid grid-cols-3 gap-3">
                <tas-form-field>
                  <tas-label>Code <span class="text-red-500">*</span></tas-label>
                  <input tasInput type="text" placeholder="Ex : PARTNER_X" [ngModel]="newCode()" (ngModelChange)="newCode.set($event)" />
                </tas-form-field>
                <tas-form-field>
                  <tas-label>Libellé <span class="text-red-500">*</span></tas-label>
                  <input tasInput type="text" placeholder="Ex : Partenaire X" [ngModel]="newLabel()" (ngModelChange)="newLabel.set($event)" />
                </tas-form-field>
                <div class="flex items-end">
                  <button tas-button color="primary" type="button" [disabled]="isCreating() || !newCode() || !newLabel()" (click)="create()">
                    @if (isCreating()) { <tas-spinner size="3" class="text-white"></tas-spinner> }
                    Ajouter
                  </button>
                </div>
              </div>
            </div>
          </tas-card>

          <!-- Sources list -->
          <tas-card class="block">
            <div class="p-4 border-b border-slate-100 flex items-center justify-between">
              <p class="text-sm font-semibold text-slate-700">Sources existantes</p>
              <span class="text-xs text-slate-400">{{ sources().length }} source(s)</span>
            </div>
            @if (sources().length === 0) {
              <div class="flex flex-col items-center justify-center py-12 text-center">
                <tas-icon iconName="feather:globe" class="text-slate-300 mb-2" style="font-size:28px"></tas-icon>
                <p class="text-sm text-slate-400">Aucune source configurée</p>
              </div>
            } @else {
              <div class="divide-y divide-slate-100">
                @for (src of sources(); track src.id) {
                  <div class="flex items-center gap-4 px-4 py-3" [class.opacity-50]="!src.isActive">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <p class="text-sm font-medium text-slate-800">{{ src.label }}</p>
                        <span class="text-[10px] text-slate-400 font-mono bg-slate-50 px-1.5 py-0.5 rounded">{{ src.code }}</span>
                        @if (src.isSystem) { <tas-tag severity="neutral">Système</tas-tag> }
                        @if (!src.isActive) { <tas-tag severity="warning">Désactivée</tas-tag> }
                      </div>
                      @if (src.description) { <p class="text-xs text-slate-400 mt-0.5">{{ src.description }}</p> }
                    </div>
                    @if (!src.isSystem) {
                      <tas-switch
                        [checked]="src.isActive ?? false"
                        [ariaLabel]="(src.isActive ? 'Désactiver' : 'Activer') + ' ' + (src.label ?? '')"
                        [isLoading]="togglingId() === src.id"
                        (toggle)="toggleActive(src, $event)"
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
export class LeadSourcesConfig implements OnInit {
  private readonly _api = inject(LeadSourcesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public isLoading = signal(true);
  public isCreating = signal(false);
  public togglingId = signal<string | null>(null);
  public sources = signal<LeadSourceDto[]>([]);
  public newCode = signal('');
  public newLabel = signal('');

  ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Paramétrage', link: ['/settings'] }, { label: 'Sources & Campagnes' }]);
    this._load();
  }

  public create(): void {
    if (!this.newCode() || !this.newLabel()) return;
    this.isCreating.set(true);
    this._api.createLeadSource({ code: this.newCode(), label: this.newLabel() }).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Impossible de créer la source.'); return EMPTY; }),
    ).subscribe(() => {
      this._snackbar.success('Source créée', `« ${this.newLabel()} » ajoutée.`);
      this.newCode.set(''); this.newLabel.set('');
      this.isCreating.set(false);
      this._load();
    });
  }

  public toggleActive(src: LeadSourceDto, active: boolean): void {
    if (!active) {
      this._confirmDialog.confirm({
        title: 'Désactiver cette source ?',
        message: `La source « ${src.label} » ne sera plus disponible pour les nouveaux leads. Les leads existants utilisant cette source ne sont pas impactés.`,
        closable: true, showCancelButton: true,
        acceptButtonProps: { label: 'Désactiver', theme: 'warn' },
        rejectButtonProps: { label: 'Annuler' },
        accept: () => this._toggle(src, false),
      });
    } else {
      this._toggle(src, true);
    }
  }

  private _toggle(src: LeadSourceDto, active: boolean): void {
    this.togglingId.set(src.id ?? null);
    const obs = active ? this._api.activateLeadSource(src.id!) : this._api.deactivateLeadSource(src.id!);
    obs.pipe(catchError(() => { this._snackbar.error('Erreur', 'Opération échouée.'); return EMPTY; }))
      .subscribe({ next: () => {
        this.sources.update((l) => l.map((s) => s.id === src.id ? { ...s, isActive: active } : s));
        this._snackbar.success('Succès', `Source ${active ? 'activée' : 'désactivée'}.`);
      }, complete: () => this.togglingId.set(null) });
  }

  private _load(): void {
    this.isLoading.set(true);
    this._api.listLeadSources().pipe(catchError(() => { this.isLoading.set(false); return EMPTY; }))
      .subscribe((s) => { this.sources.set(s ?? []); this.isLoading.set(false); });
  }
}

export default LeadSourcesConfig;
