import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY, of } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { SLAConfigsApiService, AgenciesApiService } from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';

function sampleDeadline(duration: string, holidays: string[]): string {
  if (!duration) return '—';
  const match = duration.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return '—';
  const hours = parseInt(match[1], 10) + parseInt(match[2], 10) / 60;
  const cursor = new Date();
  let remaining = hours;
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
  selector: 'create-sla-config',
  imports: [
    FormsModule,
    RouterLink,
    TasCard,
    TasIcon,
    Button,
    TasFormField,
    TasLabel,
    TasInput,
    TasSelect,
    Anchor,
  ],
  template: `
    <div class="max-w-3xl pb-6 flex flex-col gap-4">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <a [routerLink]="['/settings/sla-configs']" tas-button iconButton>
            <tas-icon iconName="feather:chevron-left"></tas-icon>
          </a>
          <div>
            <h1 class="text-lg font-semibold text-slate-800">
              Nouvelle configuration SLA
            </h1>
            <p class="text-xs text-slate-400 mt-0.5">
              Définissez les délais et le calendrier ouvré pour le suivi des
              leads.
            </p>
          </div>
        </div>
      </div>

      <!-- Identification -->
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100">
          <p class="text-sm font-semibold text-slate-700">Identification</p>
        </div>
        <div class="p-4 flex flex-col gap-4">
          <tas-form-field>
            <tas-label>Nom <span class="text-red-500">*</span></tas-label>
            <input
              tasInput
              type="text"
              placeholder="Ex : SLA standard"
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
            />
          </tas-form-field>
          <tas-form-field>
            <tas-label>Portée</tas-label>
            <tas-select
              [options]="scopeOptions()"
              placeholder="Global (tout le tenant)"
              [ngModel]="agencyId()"
              (ngModelChange)="agencyId.set($event)"
            ></tas-select>
          </tas-form-field>
          @if (agencyId()) {
            <div class="p-2 rounded bg-blue-50 border border-blue-200">
              <p class="text-xs text-blue-700 flex items-center gap-1">
                <tas-icon
                  iconName="feather:info"
                  style="font-size:10px"
                ></tas-icon>
                Cette configuration s'applique uniquement à l'agence
                sélectionnée.
              </p>
            </div>
          } @else {
            <div class="p-2 rounded bg-slate-50 border border-slate-200">
              <p class="text-xs text-slate-500 flex items-center gap-1">
                <tas-icon
                  iconName="feather:globe"
                  style="font-size:10px"
                ></tas-icon>
                Configuration globale — s'applique à tout le tenant.
              </p>
            </div>
          }
        </div>
      </tas-card>

      <!-- Délais SLA -->
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100">
          <p class="text-sm font-semibold text-slate-700">Délais SLA</p>
          <p class="text-xs text-slate-400 mt-0.5">
            Format HH:MM:SS (ex : 04:00:00 pour 4 heures)
          </p>
        </div>
        <div class="p-4 grid grid-cols-2 gap-4">
          <tas-form-field>
            <tas-label>Premier contact</tas-label>
            <input
              tasInput
              type="text"
              placeholder="04:00:00"
              [ngModel]="firstContact()"
              (ngModelChange)="firstContact.set($event)"
            />
            <p class="text-[10px] text-slate-400 mt-1">
              Délai maximum pour le premier contact avec le lead
            </p>
          </tas-form-field>
          <tas-form-field>
            <tas-label>Qualification</tas-label>
            <input
              tasInput
              type="text"
              placeholder="24:00:00"
              [ngModel]="qualification()"
              (ngModelChange)="qualification.set($event)"
            />
            <p class="text-[10px] text-slate-400 mt-1">
              Délai maximum pour qualifier le lead
            </p>
          </tas-form-field>
          <tas-form-field>
            <tas-label>Relance</tas-label>
            <input
              tasInput
              type="text"
              placeholder="48:00:00"
              [ngModel]="followUp()"
              (ngModelChange)="followUp.set($event)"
            />
            <p class="text-[10px] text-slate-400 mt-1">
              Délai maximum entre deux relances
            </p>
          </tas-form-field>
          <tas-form-field>
            <tas-label>Escalade</tas-label>
            <input
              tasInput
              type="text"
              placeholder="72:00:00"
              [ngModel]="escalation()"
              (ngModelChange)="escalation.set($event)"
            />
            <p class="text-[10px] text-slate-400 mt-1">
              Délai avant escalade automatique au superviseur
            </p>
          </tas-form-field>
        </div>
      </tas-card>

      <!-- Calendrier ouvré -->
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100">
          <p class="text-sm font-semibold text-slate-700">Calendrier ouvré</p>
          <p class="text-xs text-slate-400 mt-0.5">
            Jours fériés à exclure du calcul SLA (les week-ends sont exclus par
            défaut).
          </p>
        </div>
        <div class="p-4">
          <div class="flex items-end gap-2 mb-3">
            <tas-form-field class="col-span-2">
              <input
                tasInput
                type="date"
                [ngModel]="newHoliday()"
                (ngModelChange)="newHoliday.set($event)"
              />
            </tas-form-field>
            <div class="w-[200px]">
              <button
                tas-outlined-button
                type="button"
                [disabled]="!newHoliday()"
                (click)="addHoliday()"
              >
                Ajouter
              </button>
            </div>
          </div>
          @if (holidays().length > 0) {
            <div class="flex flex-wrap gap-1.5">
              @for (h of holidays(); track h) {
                <span
                  class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 text-xs text-slate-600"
                >
                  {{ h }}
                  <button
                    type="button"
                    class="text-slate-400 hover:text-red-500"
                    (click)="removeHoliday(h)"
                  >
                    <tas-icon
                      iconName="feather:x"
                      style="font-size:10px"
                    ></tas-icon>
                  </button>
                </span>
              }
            </div>
          }

          @if (firstContact()) {
            <div
              class="mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200"
            >
              <p class="text-xs text-amber-700">
                <span class="font-medium">Aperçu :</span> Un lead capturé
                maintenant aurait un SLA 1er contact expirant le
                <span class="font-semibold">{{
                  computedSampleDeadline()
                }}</span>
                (hors week-ends et {{ holidays().length }} jour(s) férié(s)
                configuré(s)).
              </p>
            </div>
          }
        </div>
      </tas-card>

      <!-- Info -->
      <div
        class="p-3 rounded-lg bg-blue-50 border border-blue-200 flex items-center gap-2"
      >
        <tas-icon
          iconName="feather:info"
          class="text-blue-500 shrink-0"
          style="font-size:14px"
        ></tas-icon>
        <p class="text-xs text-blue-700">
          La configuration sera créée en état <strong>inactif</strong>.
          Activez-la depuis la liste pour qu'elle prenne effet.
        </p>
      </div>

      <!-- Bottom action -->
      <div class="flex items-center justify-end gap-3">
        <a
          [routerLink]="['/settings/sla-configs']"
          tas-outlined-button
          color="primary"
          >Annuler</a
        >
        <button
          tas-raised-button
          color="primary"
          type="button"
          [disabled]="isSaving() || !name()"
          [isLoading]="isSaving()"
          (click)="create()"
        >
          <tas-icon iconName="feather:plus" iconSize="sm"></tas-icon>
          Créer la configuration
        </button>
      </div>
    </div>
  `,
})
export class CreateSlaConfigPage implements OnInit {
  private readonly _api = inject(SLAConfigsApiService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public name = signal('');
  public agencyId = signal('');
  public firstContact = signal('04:00:00');
  public qualification = signal('24:00:00');
  public followUp = signal('48:00:00');
  public escalation = signal('72:00:00');
  public holidays = signal<string[]>([]);
  public newHoliday = signal('');
  public isSaving = signal(false);

  public agencies = signal<{ label: string; value: string }[]>([]);
  public scopeOptions = computed(() => [
    { label: 'Global (tout le tenant)', value: 'tout' },
    ...this.agencies(),
  ]);

  public computedSampleDeadline = computed(() =>
    sampleDeadline(this.firstContact(), this.holidays()),
  );

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'SLA & Calendrier', link: ['/settings/sla-configs'] },
      { label: 'Nouvelle configuration' },
    ]);
    this._agenciesApi
      .listAgencies(false, 1, 200)
      .pipe(catchError(() => of({ items: [] as any[] })))
      .subscribe((res) => {
        this.agencies.set(
          (res.items ?? []).map((a: any) => ({
            label: a.name ?? '',
            value: a.id ?? '',
          })),
        );
      });
  }

  public addHoliday(): void {
    const d = this.newHoliday();
    if (d && !this.holidays().includes(d)) {
      this.holidays.update((h) => [...h, d].sort());
    }
    this.newHoliday.set('');
  }

  public removeHoliday(d: string): void {
    this.holidays.update((h) => h.filter((x) => x !== d));
  }

  public create(): void {
    if (!this.name()) return;
    this.isSaving.set(true);

    this._api
      .createSlaConfig({
        name: this.name(),
        agencyId: this.agencyId() == 'tous' ? null : this.agencyId(),
        firstContactDeadline: this.firstContact(),
        qualificationDeadline: this.qualification(),
        followUpDeadline: this.followUp(),
        escalationDeadline: this.escalation(),
      })
      .pipe(
        catchError(() => {
          this._snackbar.error(
            'Erreur',
            'Impossible de créer la configuration SLA.',
          );
          this.isSaving.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._snackbar.success(
          'Configuration créée',
          'La configuration SLA a été créée.',
        );
        this.isSaving.set(false);
        this._router.navigate(['/settings/sla-configs']);
      });
  }
}

export default CreateSlaConfigPage;
