import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY, of } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasSwitch } from '@talisoft/ui/switch';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  SLAConfigsApiService, SlaConfigDto,
  AgenciesApiService,
} from '@sankore/crm-api';
import { BreadcrumbService, HasPermissionDirective } from '@sankore/crm/common';

type ViewState = 'list' | 'form';

/** Parse an ISO 8601 duration like "04:00:00" or "PT4H" to human-readable */
function formatDeadline(val: string | undefined): string {
  if (!val) return '—';
  const match = val.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (match) {
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  }
  return val;
}

/** Compute a sample SLA deadline from a duration and a set of working days */
function sampleDeadline(duration: string, holidays: string[]): string {
  if (!duration) return '—';
  const match = duration.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return '—';
  const hours = parseInt(match[1], 10) + parseInt(match[2], 10) / 60;
  const now = new Date();
  let remaining = hours;
  const cursor = new Date(now);
  while (remaining > 0) {
    cursor.setHours(cursor.getHours() + 1);
    const day = cursor.getDay();
    const dateStr = cursor.toISOString().slice(0, 10);
    if (day === 0 || day === 6 || holidays.includes(dateStr)) continue;
    remaining -= 1;
  }
  return cursor.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

@Component({
  selector: 'sla-configs',
  imports: [
    FormsModule, TasCard, TasSpinner, TasIcon, TasTag, Button, TasSwitch,
    TasFormField, TasLabel, TasInput, TasSelect, HasPermissionDirective,
  ],
  template: `
    <ng-container>
      @if (isLoading()) {
        <div class="flex justify-center py-24"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
      } @else if (viewState() === 'list') {
        <div class="pb-6">
          <div class="flex items-start justify-between mb-6">
            <div>
              <h1 class="text-lg font-semibold text-slate-800">SLA & Calendrier ouvré</h1>
              <p class="text-sm text-slate-500 mt-0.5">Délais SLA par agence et jours fériés.</p>
            </div>
            <button tas-raised-button color="primary" type="button" (click)="navigateToCreate()">
              <tas-icon iconName="feather:plus" style="font-size:14px"></tas-icon> Nouvelle config SLA
            </button>
          </div>

          @if (configs().length === 0) {
            <tas-card class="block">
              <div class="flex flex-col items-center justify-center py-16 text-center">
                <tas-icon iconName="feather:clock" class="text-slate-300 mb-2" style="font-size:28px"></tas-icon>
                <p class="text-sm text-slate-400">Aucune configuration SLA</p>
              </div>
            </tas-card>
          } @else {
            <div class="flex flex-col gap-3">
              @for (cfg of configs(); track cfg.id) {
                <tas-card class="block">
                  <div class="p-4 flex items-center gap-4">
                    <tas-switch [checked]="cfg.isActive ?? false" [isLoading]="togglingId() === cfg.id"
                      (toggle)="toggleActive(cfg, $event)"></tas-switch>
                    <div class="flex-1 min-w-0 cursor-pointer" (click)="startEdit(cfg)">
                      <div class="flex items-center gap-2">
                        <p class="text-sm font-semibold text-slate-800">{{ cfg.name }}</p>
                        @if (cfg.isActive) { <tas-tag severity="success">Active</tas-tag> }
                        @if (cfg.agencyId) { <tas-tag severity="info">Agence</tas-tag> }
                        @else { <tas-tag severity="neutral">Global</tas-tag> }
                      </div>
                      <div class="flex items-center gap-4 mt-1 text-xs text-slate-400">
                        <span>1er contact : {{ formatDeadline(cfg.firstContactDeadline) }}</span>
                        <span>Qualification : {{ formatDeadline(cfg.qualificationDeadline) }}</span>
                        <span>Relance : {{ formatDeadline(cfg.followUpDeadline) }}</span>
                      </div>
                    </div>
                    <button tas-outlined-button type="button" class="text-xs shrink-0" (click)="startEdit(cfg)">
                      <tas-icon iconName="feather:edit-2" style="font-size:12px"></tas-icon> Modifier
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
            <h1 class="text-lg font-semibold text-slate-800 flex-1">Modifier la config SLA</h1>
            <button tas-button color="primary" type="button" [disabled]="isSaving() || !editName()" (click)="save()">
              @if (isSaving()) { <tas-spinner size="3" class="text-white"></tas-spinner> }
              Enregistrer
            </button>
          </div>

          <tas-card class="mb-4 block">
            <div class="p-4 flex flex-col gap-3">
              <tas-form-field>
                <tas-label>Nom <span class="text-red-500">*</span></tas-label>
                <input tasInput type="text" placeholder="Ex : SLA standard" [ngModel]="editName()" (ngModelChange)="editName.set($event)" />
              </tas-form-field>
              <tas-form-field>
                <tas-label>Portée</tas-label>
                <tas-select [options]="scopeOptions()" optionLabel="label" optionValue="value" placeholder="Global (tout le tenant)"
                  [ngModel]="editAgencyId()" (ngModelChange)="editAgencyId.set($event)"></tas-select>
              </tas-form-field>
              @if (editAgencyId()) {
                <div class="p-2 rounded bg-blue-50 border border-blue-200">
                  <p class="text-xs text-blue-700 flex items-center gap-1">
                    <tas-icon iconName="feather:info" style="font-size:10px"></tas-icon>
                    Cette configuration s'applique uniquement à l'agence sélectionnée.
                  </p>
                </div>
              } @else {
                <div class="p-2 rounded bg-slate-50 border border-slate-200">
                  <p class="text-xs text-slate-500 flex items-center gap-1">
                    <tas-icon iconName="feather:globe" style="font-size:10px"></tas-icon>
                    Configuration globale — s'applique à tout le tenant.
                  </p>
                </div>
              }
            </div>
          </tas-card>

          <tas-card class="mb-4 block">
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">Délais SLA</p>
              <p class="text-xs text-slate-400 mt-0.5">Format HH:MM:SS (ex : 04:00:00 pour 4 heures)</p>
            </div>
            <div class="p-4 grid grid-cols-2 gap-3">
              <tas-form-field>
                <tas-label>Premier contact</tas-label>
                <input tasInput type="text" placeholder="04:00:00" [ngModel]="editFirstContact()" (ngModelChange)="editFirstContact.set($event)" />
              </tas-form-field>
              <tas-form-field>
                <tas-label>Qualification</tas-label>
                <input tasInput type="text" placeholder="24:00:00" [ngModel]="editQualification()" (ngModelChange)="editQualification.set($event)" />
              </tas-form-field>
              <tas-form-field>
                <tas-label>Relance</tas-label>
                <input tasInput type="text" placeholder="48:00:00" [ngModel]="editFollowUp()" (ngModelChange)="editFollowUp.set($event)" />
              </tas-form-field>
              <tas-form-field>
                <tas-label>Escalade</tas-label>
                <input tasInput type="text" placeholder="72:00:00" [ngModel]="editEscalation()" (ngModelChange)="editEscalation.set($event)" />
              </tas-form-field>
            </div>
          </tas-card>

          <!-- Calendar / Holiday -->
          <tas-card class="mb-4 block">
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">Calendrier ouvré</p>
              <p class="text-xs text-slate-400 mt-0.5">Jours fériés à exclure du calcul SLA.</p>
            </div>
            <div class="p-4">
              <div class="flex gap-2 mb-3">
                <tas-form-field>
                  <input tasInput type="date" [ngModel]="newHoliday()" (ngModelChange)="newHoliday.set($event)" />
                </tas-form-field>
                <button tas-outlined-button type="button" [disabled]="!newHoliday()" (click)="addHoliday()">Ajouter</button>
              </div>
              @if (holidays().length > 0) {
                <div class="flex flex-wrap gap-1.5">
                  @for (h of holidays(); track h) {
                    <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 text-xs text-slate-600">
                      {{ h }}
                      <button type="button" class="text-slate-400 hover:text-red-500" (click)="removeHoliday(h)">
                        <tas-icon iconName="feather:x" style="font-size:10px"></tas-icon>
                      </button>
                    </span>
                  }
                </div>
              }

              <!-- Live preview -->
              @if (editFirstContact()) {
                <div class="mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                  <p class="text-xs text-amber-700">
                    <span class="font-medium">Aperçu :</span> Un lead capturé maintenant aurait un SLA 1er contact expirant le
                    <span class="font-semibold">{{ sampleDeadline(editFirstContact()) }}</span>
                    (hors week-ends et {{ holidays().length }} jour(s) férié(s) configuré(s)).
                  </p>
                </div>
              }
            </div>
          </tas-card>
        </div>
      }
    </ng-container>
  `,
})
export class SlaConfigsPage implements OnInit {
  private readonly _api = inject(SLAConfigsApiService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _router = inject(Router);

  public readonly formatDeadline = formatDeadline;

  public isLoading = signal(true);
  public isSaving = signal(false);
  public togglingId = signal<string | null>(null);
  public viewState = signal<ViewState>('list');
  public configs = signal<SlaConfigDto[]>([]);
  public agencies = signal<{ label: string; value: string }[]>([]);

  // Form
  public editId = signal<string | null>(null);
  public editName = signal('');
  public editAgencyId = signal('');
  public editFirstContact = signal('');
  public editQualification = signal('');
  public editFollowUp = signal('');
  public editEscalation = signal('');
  public holidays = signal<string[]>([]);
  public newHoliday = signal('');

  public readonly scopeOptions = computed(() => [
    { label: 'Global (tout le tenant)', value: '' },
    ...this.agencies(),
  ]);

  ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Paramétrage', link: ['/settings'] }, { label: 'SLA & Calendrier' }]);
    this._load();
    this._agenciesApi.listAgencies(false, 1, 200).pipe(catchError(() => of({ items: [] }))).subscribe((res) => {
      this.agencies.set((res.items ?? []).map((a) => ({ label: a.name ?? '', value: a.id ?? '' })));
    });
  }

  public sampleDeadline(duration: string): string { return sampleDeadline(duration, this.holidays()); }

  public addHoliday(): void {
    const d = this.newHoliday();
    if (d && !this.holidays().includes(d)) { this.holidays.update((h) => [...h, d].sort()); }
    this.newHoliday.set('');
  }

  public removeHoliday(d: string): void { this.holidays.update((h) => h.filter((x) => x !== d)); }

  public navigateToCreate(): void {
    this._router.navigate(['/settings/sla-configs/create']);
  }

  public startEdit(cfg: SlaConfigDto): void {
    this.editId.set(cfg.id ?? null); this.editName.set(cfg.name ?? '');
    this.editAgencyId.set(cfg.agencyId ?? '');
    this.editFirstContact.set(cfg.firstContactDeadline ?? '');
    this.editQualification.set(cfg.qualificationDeadline ?? '');
    this.editFollowUp.set(cfg.followUpDeadline ?? '');
    this.editEscalation.set(cfg.escalationDeadline ?? '');
    this.holidays.set([]); this.viewState.set('form');
  }

  public toggleActive(cfg: SlaConfigDto, active: boolean): void {
    this.togglingId.set(cfg.id ?? null);
    const obs = active ? this._api.activateSlaConfig(cfg.id!) : this._api.deactivateSlaConfig(cfg.id!);
    obs.pipe(catchError(() => { this._snackbar.error('Erreur', 'Opération échouée.'); return EMPTY; }))
      .subscribe({ next: () => {
        this.configs.update((l) => l.map((c) => c.id === cfg.id ? { ...c, isActive: active } : c));
      }, complete: () => this.togglingId.set(null) });
  }

  public save(): void {
    if (!this.editName()) return;
    this.isSaving.set(true);
    const payload = {
      name: this.editName(), agencyId: this.editAgencyId() || null,
      firstContactDeadline: this.editFirstContact(), qualificationDeadline: this.editQualification(),
      followUpDeadline: this.editFollowUp(), escalationDeadline: this.editEscalation(),
    };
    this._api.updateSlaConfig(this.editId()!, payload).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Sauvegarde échouée.'); return EMPTY; }))
      .subscribe({ next: () => {
        this._snackbar.success('Enregistré', 'Configuration SLA sauvegardée.');
        this.viewState.set('list'); this._load();
      }, complete: () => this.isSaving.set(false) });
  }

  private _load(): void {
    this.isLoading.set(true);
    this._api.listSlaConfigs().pipe(catchError(() => { this.isLoading.set(false); return EMPTY; }))
      .subscribe((c: any) => { this.configs.set(c ?? []); this.isLoading.set(false); });
  }
}

export default SlaConfigsPage;
