import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY, of } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Severity } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import {
  TasSideDrawer,
  TasDrawerTitle,
  TasDrawerContent,
  TasDrawerAction,
} from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  LeadsApiService,
  LogActivityRequestTypeEnum,
  LogActivityRequestOutcomeEnum,
  ActivityDto,
  ActivityDtoTypeEnum,
  ConsentDto,
} from '@sankore/crm-api';
import { AuthenticationService } from '@sankore/crm/common';

export interface LogActivityDrawerData {
  leadId: string;
  leadName: string;
}

export interface LogActivityDrawerResult {
  activity: ActivityDto;
}

// ——— Type metadata ———

interface TypeOption {
  value: LogActivityRequestTypeEnum;
  label: string;
  icon: string;
  severity: Severity;
  fields: Set<'duration' | 'outcome' | 'scheduledAt' | 'geolocation' | 'photo'>;
}

const ACTIVITY_TYPES: TypeOption[] = [
  {
    value: LogActivityRequestTypeEnum.Call,
    label: 'Appel',
    icon: 'feather:phone',
    severity: 'info',
    fields: new Set(['duration', 'outcome']),
  },
  {
    value: LogActivityRequestTypeEnum.Meeting,
    label: 'Rendez-vous',
    icon: 'feather:users',
    severity: 'warning',
    fields: new Set(['duration', 'outcome', 'scheduledAt']),
  },
  {
    value: LogActivityRequestTypeEnum.Email,
    label: 'E-mail',
    icon: 'feather:mail',
    severity: 'info',
    fields: new Set(['outcome']),
  },
  {
    value: LogActivityRequestTypeEnum.Visit,
    label: 'Visite',
    icon: 'feather:map-pin',
    severity: 'success',
    fields: new Set(['duration', 'outcome', 'scheduledAt', 'geolocation', 'photo']),
  },
  {
    value: LogActivityRequestTypeEnum.Sms,
    label: 'SMS',
    icon: 'feather:message-square',
    severity: 'info',
    fields: new Set([]),
  },
  {
    value: LogActivityRequestTypeEnum.WhatsApp,
    label: 'WhatsApp',
    icon: 'feather:message-circle',
    severity: 'success',
    fields: new Set([]),
  },
  {
    value: LogActivityRequestTypeEnum.Note,
    label: 'Note',
    icon: 'feather:file-text',
    severity: 'neutral',
    fields: new Set([]),
  },
];

const OUTCOME_OPTIONS = [
  { label: 'Contacté avec succès',       value: String(LogActivityRequestOutcomeEnum.NUMBER_0) },
  { label: 'Injoignable',                value: String(LogActivityRequestOutcomeEnum.NUMBER_1) },
  { label: 'Messagerie vocale',          value: String(LogActivityRequestOutcomeEnum.NUMBER_2) },
  { label: 'Rappel demandé',             value: String(LogActivityRequestOutcomeEnum.NUMBER_3) },
  { label: 'Intéressé',                  value: String(LogActivityRequestOutcomeEnum.NUMBER_4) },
  { label: 'Pas intéressé',              value: String(LogActivityRequestOutcomeEnum.NUMBER_5) },
  { label: 'Faux numéro',               value: String(LogActivityRequestOutcomeEnum.NUMBER_6) },
  { label: 'Autre',                      value: String(LogActivityRequestOutcomeEnum.NUMBER_7) },
];

type GeoStatus = 'idle' | 'acquiring' | 'acquired' | 'denied' | 'error' | 'manual';

@Component({
  selector: 'log-activity-drawer',
  imports: [
    FormsModule,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasIcon,
    TasSpinner,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasInput,
    TasSelect,
    TasTitle,
    DecimalPipe,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Enregistrer une activité</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <!-- Lead context -->
        <div class="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
          <p class="text-sm font-medium text-slate-800">{{ data.leadName }}</p>
        </div>

        <!-- Activity type selector -->
        <p class="text-xs font-semibold text-slate-600 mb-2">Type d'activité</p>
        <div class="grid grid-cols-4 gap-1.5 mb-4">
          @for (t of activityTypes; track t.value) {
            <button
              type="button"
              class="flex flex-col items-center gap-1 p-2 rounded-lg border transition-all text-center"
              [class]="selectedType() === t.value
                ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                : 'border-slate-200 hover:border-slate-300'"
              (click)="onTypeChange(t.value)"
            >
              <div
                class="w-7 h-7 rounded-full flex items-center justify-center"
                [class]="selectedType() === t.value
                  ? 'bg-primary/15 text-primary'
                  : 'bg-slate-100 text-slate-400'"
              >
                <tas-icon [iconName]="t.icon" style="font-size:12px"></tas-icon>
              </div>
              <span class="text-[10px] font-medium truncate w-full">{{ t.label }}</span>
            </button>
          }
        </div>

        @if (submitted() && !selectedType()) {
          <p class="text-xs text-red-500 mb-3">Veuillez sélectionner un type d'activité.</p>
        }

        <!-- Subject -->
        <tas-form-field>
          <tas-label>
            Sujet
            <span class="text-red-500 ml-0.5">*</span>
          </tas-label>
          <input
            tasInput
            type="text"
            [placeholder]="subjectPlaceholder()"
            [ngModel]="subject()"
            (ngModelChange)="subject.set($event)"
          />
          @if (submitted() && !subject().trim()) {
            <tas-error>Le sujet est obligatoire.</tas-error>
          }
        </tas-form-field>

        <!-- Polymorphic fields -->

        @if (activeFields().has('scheduledAt')) {
          <div class="mt-3">
            <tas-form-field>
              <tas-label>Date/heure prévue</tas-label>
              <input
                tasInput
                type="datetime-local"
                [ngModel]="scheduledAt()"
                (ngModelChange)="scheduledAt.set($event)"
              />
            </tas-form-field>
          </div>
        }

        @if (activeFields().has('duration')) {
          <div class="mt-3">
            <tas-form-field>
              <tas-label>Durée (minutes)</tas-label>
              <input
                tasInput
                type="number"
                placeholder="Ex : 15"
                min="1"
                [ngModel]="durationMinutes()"
                (ngModelChange)="durationMinutes.set($event)"
              />
            </tas-form-field>
          </div>
        }

        @if (activeFields().has('outcome')) {
          <div class="mt-3">
            <tas-form-field>
              <tas-label>Résultat</tas-label>
              <tas-select
                [options]="outcomeOptions"
                optionLabel="label"
                optionValue="value"
                placeholder="Sélectionnez un résultat"
                [ngModel]="outcome()"
                (ngModelChange)="outcome.set($event)"
              ></tas-select>
            </tas-form-field>
          </div>
        }

        <!-- ——— VISIT: Geolocation ——— -->
        @if (activeFields().has('geolocation')) {
          <div class="mt-4">
            <div class="flex items-center gap-2 mb-2">
              <tas-icon iconName="feather:map-pin" class="text-slate-500" style="font-size:14px"></tas-icon>
              <p class="text-xs font-semibold text-slate-600">Géolocalisation</p>
            </div>

            <!-- Consent warning -->
            @if (!hasLocationConsent()) {
              <div class="mb-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
                <tas-icon iconName="feather:shield" class="text-amber-500 shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
                <div>
                  <p class="text-xs font-medium text-amber-800">Consentement non enregistré</p>
                  <p class="text-xs text-amber-700 mt-0.5">
                    Le consentement de localisation du prospect n'est pas enregistré. En continuant, vous confirmez avoir obtenu l'accord verbal du prospect.
                  </p>
                </div>
              </div>
            }

            @switch (geoStatus()) {
              @case ('idle') {
                <button
                  tas-outlined-button
                  color="primary"
                  type="button"
                  class="w-full text-xs"
                  (click)="requestGeolocation()"
                >
                  <tas-icon iconName="feather:crosshair" style="font-size:14px"></tas-icon>
                  Obtenir ma position
                </button>
              }
              @case ('acquiring') {
                <div class="flex items-center justify-center gap-2 py-3">
                  <tas-spinner size="4" class="text-primary"></tas-spinner>
                  <span class="text-xs text-slate-500">Acquisition de la position…</span>
                </div>
              }
              @case ('acquired') {
                <div class="p-3 rounded-lg bg-green-50 border border-green-200">
                  <div class="flex items-center gap-2 mb-1">
                    <tas-icon iconName="feather:check-circle" class="text-green-600" style="font-size:14px"></tas-icon>
                    <span class="text-xs font-medium text-green-800">Position acquise</span>
                  </div>
                  <p class="text-[10px] text-green-700 tabular-nums">
                    {{ geoLatitude() | number:'1.5-5' }}, {{ geoLongitude() | number:'1.5-5' }}
                  </p>
                  <button
                    type="button"
                    class="text-[10px] text-green-600 hover:underline mt-1"
                    (click)="requestGeolocation()"
                  >
                    Actualiser
                  </button>
                </div>
              }
              @case ('denied') {
                <div class="p-3 rounded-lg bg-red-50 border border-red-200 mb-2">
                  <div class="flex items-center gap-2 mb-1">
                    <tas-icon iconName="feather:x-circle" class="text-red-500" style="font-size:14px"></tas-icon>
                    <span class="text-xs font-medium text-red-800">Géolocalisation refusée</span>
                  </div>
                  <p class="text-[10px] text-red-600">
                    L'accès à la position a été refusé par votre navigateur. Vous pouvez saisir la position manuellement.
                  </p>
                </div>
                <button
                  tas-outlined-button
                  type="button"
                  class="w-full text-xs mb-2"
                  (click)="geoStatus.set('manual')"
                >
                  <tas-icon iconName="feather:edit-3" style="font-size:12px"></tas-icon>
                  Saisie manuelle
                </button>
              }
              @case ('error') {
                <div class="p-3 rounded-lg bg-red-50 border border-red-200 mb-2">
                  <div class="flex items-center gap-2 mb-1">
                    <tas-icon iconName="feather:alert-triangle" class="text-red-500" style="font-size:14px"></tas-icon>
                    <span class="text-xs font-medium text-red-800">Erreur de géolocalisation</span>
                  </div>
                  <p class="text-[10px] text-red-600">
                    Impossible d'obtenir la position. Vérifiez vos paramètres ou utilisez la saisie manuelle.
                  </p>
                </div>
                <div class="flex gap-2">
                  <button
                    tas-outlined-button
                    type="button"
                    class="flex-1 text-xs"
                    (click)="requestGeolocation()"
                  >
                    Réessayer
                  </button>
                  <button
                    tas-outlined-button
                    type="button"
                    class="flex-1 text-xs"
                    (click)="geoStatus.set('manual')"
                  >
                    Saisie manuelle
                  </button>
                </div>
              }
              @case ('manual') {
                <div class="grid grid-cols-2 gap-2">
                  <tas-form-field>
                    <tas-label>Latitude</tas-label>
                    <input
                      tasInput
                      type="number"
                      step="0.00001"
                      placeholder="Ex : 14.6937"
                      [ngModel]="geoLatitude()"
                      (ngModelChange)="geoLatitude.set($event)"
                    />
                  </tas-form-field>
                  <tas-form-field>
                    <tas-label>Longitude</tas-label>
                    <input
                      tasInput
                      type="number"
                      step="0.00001"
                      placeholder="Ex : -17.4441"
                      [ngModel]="geoLongitude()"
                      (ngModelChange)="geoLongitude.set($event)"
                    />
                  </tas-form-field>
                </div>
                <button
                  type="button"
                  class="text-[10px] text-primary hover:underline mt-1"
                  (click)="requestGeolocation()"
                >
                  Réessayer la géolocalisation automatique
                </button>
              }
            }
          </div>
        }

        <!-- ——— VISIT: Photo ——— -->
        @if (activeFields().has('photo')) {
          <div class="mt-4">
            <div class="flex items-center gap-2 mb-2">
              <tas-icon iconName="feather:camera" class="text-slate-500" style="font-size:14px"></tas-icon>
              <p class="text-xs font-semibold text-slate-600">Photo de visite</p>
            </div>

            @if (!photoPreviewUrl()) {
              <!-- Upload zone -->
              <div
                class="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center hover:border-slate-300 transition-colors cursor-pointer"
                (click)="fileInput.click()"
              >
                <tas-icon iconName="feather:upload" class="text-slate-300 mb-2" style="font-size:24px"></tas-icon>
                <p class="text-xs text-slate-500">Prendre ou importer une photo</p>
                <p class="text-[10px] text-slate-400 mt-0.5">JPG, PNG — max 10 Mo</p>
              </div>
              <input
                #fileInput
                type="file"
                accept="image/*"
                capture="environment"
                class="hidden"
                (change)="onFileSelected($event)"
              />
            } @else {
              <!-- Photo preview -->
              <div class="relative rounded-lg overflow-hidden border border-slate-200">
                <img
                  [src]="photoPreviewUrl()"
                  alt="Photo de visite"
                  class="w-full h-48 object-cover"
                />
                <div class="absolute top-2 right-2 flex gap-1">
                  <button
                    type="button"
                    class="w-7 h-7 rounded-full bg-white/90 shadow flex items-center justify-center hover:bg-white transition-colors"
                    (click)="removePhoto()"
                    title="Supprimer"
                  >
                    <tas-icon iconName="feather:trash-2" class="text-red-500" style="font-size:12px"></tas-icon>
                  </button>
                  <button
                    type="button"
                    class="w-7 h-7 rounded-full bg-white/90 shadow flex items-center justify-center hover:bg-white transition-colors"
                    (click)="fileInput.click()"
                    title="Reprendre"
                  >
                    <tas-icon iconName="feather:refresh-cw" class="text-slate-600" style="font-size:12px"></tas-icon>
                  </button>
                </div>
                @if (photoFile()) {
                  <div class="absolute bottom-0 left-0 right-0 bg-black/50 px-2 py-1">
                    <p class="text-[10px] text-white truncate">{{ photoFile()!.name }}</p>
                  </div>
                }
              </div>
              <input
                #fileInput
                type="file"
                accept="image/*"
                capture="environment"
                class="hidden"
                (change)="onFileSelected($event)"
              />
            }
          </div>
        }

        <!-- Notes (always shown) -->
        <div class="mt-3">
          <tas-form-field>
            <tas-label>Notes</tas-label>
            <textarea
              tasInput
              rows="3"
              placeholder="Détails de l'interaction..."
              [ngModel]="notes()"
              (ngModelChange)="notes.set($event)"
            ></textarea>
          </tas-form-field>
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="space-x-4">
          <button tas-outlined-button type="button" (click)="close()">
            Annuler
          </button>
          <button
            tas-raised-button
            color="primary"
            type="button"
            [disabled]="isSubmitting()"
            (click)="submit()"
          >
            @if (isSubmitting()) {
              <tas-spinner size="3" class="text-white"></tas-spinner>
            }
            Enregistrer
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class LogActivityDrawer {
  public readonly data: LogActivityDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<LogActivityDrawerResult | false>);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);

  public readonly activityTypes = ACTIVITY_TYPES;
  public readonly outcomeOptions = OUTCOME_OPTIONS;

  // ——— Form state ———
  public selectedType = signal<LogActivityRequestTypeEnum | ''>('');
  public subject = signal('');
  public notes = signal('');
  public durationMinutes = signal<number | null>(null);
  public outcome = signal('');
  public scheduledAt = signal('');
  public isSubmitting = signal(false);
  public submitted = signal(false);

  // ——— Visit: Geolocation ———
  public geoStatus = signal<GeoStatus>('idle');
  public geoLatitude = signal<number | null>(null);
  public geoLongitude = signal<number | null>(null);
  public hasLocationConsent = signal(false);

  // ——— Visit: Photo ———
  public photoFile = signal<File | null>(null);
  public photoPreviewUrl = signal<string | null>(null);

  public readonly activeFields = computed(() => {
    const type = this.selectedType();
    if (!type) return new Set<string>();
    return ACTIVITY_TYPES.find((t) => t.value === type)?.fields ?? new Set();
  });

  public readonly subjectPlaceholder = computed(() => {
    switch (this.selectedType()) {
      case LogActivityRequestTypeEnum.Call:     return 'Ex : Appel de qualification';
      case LogActivityRequestTypeEnum.Meeting:  return 'Ex : Rendez-vous en agence';
      case LogActivityRequestTypeEnum.Email:    return 'Ex : Envoi offre commerciale';
      case LogActivityRequestTypeEnum.Visit:    return 'Ex : Visite terrain client';
      case LogActivityRequestTypeEnum.Sms:      return 'Ex : SMS de relance';
      case LogActivityRequestTypeEnum.WhatsApp: return 'Ex : Échange WhatsApp';
      case LogActivityRequestTypeEnum.Note:     return 'Ex : Note interne';
      default: return "Sujet de l'activité";
    }
  });

  // ——— Type change ———

  public onTypeChange(type: LogActivityRequestTypeEnum): void {
    this.selectedType.set(type);
    if (type === LogActivityRequestTypeEnum.Visit) {
      this._checkLocationConsent();
    }
  }

  // ——— Geolocation ———

  public requestGeolocation(): void {
    if (!navigator.geolocation) {
      this.geoStatus.set('error');
      return;
    }

    // Consent check: warn if not granted
    if (!this.hasLocationConsent()) {
      this._confirmDialog.confirm({
        title: 'Consentement de localisation',
        message: 'Le consentement de localisation du prospect n\'est pas enregistré. Confirmez-vous avoir obtenu l\'accord du prospect avant de collecter sa position ?',
        closable: true,
        showCancelButton: true,
        acceptButtonProps: { label: 'Continuer', theme: 'primary' },
        rejectButtonProps: { label: 'Annuler' },
        accept: () => this._doGeoRequest(),
      });
    } else {
      this._doGeoRequest();
    }
  }

  // ——— Photo ———

  public onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Validate size (10 MB)
    if (file.size > 10 * 1024 * 1024) {
      this._snackbar.error('Fichier trop volumineux', 'La taille maximale est de 10 Mo.');
      input.value = '';
      return;
    }

    // Validate type
    if (!file.type.startsWith('image/')) {
      this._snackbar.error('Format invalide', 'Seules les images sont acceptées.');
      input.value = '';
      return;
    }

    this.photoFile.set(file);

    // Generate preview
    const reader = new FileReader();
    reader.onload = () => {
      this.photoPreviewUrl.set(reader.result as string);
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  public removePhoto(): void {
    this.photoFile.set(null);
    this.photoPreviewUrl.set(null);
  }

  // ——— Submit ———

  public submit(): void {
    this.submitted.set(true);

    if (!this.selectedType() || !this.subject().trim()) return;

    this.isSubmitting.set(true);

    // Build notes with geo + photo info for visit
    let enrichedNotes = this.notes().trim();
    if (this.selectedType() === LogActivityRequestTypeEnum.Visit) {
      if (this.geoLatitude() != null && this.geoLongitude() != null) {
        enrichedNotes += `\n[Position GPS : ${this.geoLatitude()}, ${this.geoLongitude()}]`;
      }
      if (this.photoFile()) {
        enrichedNotes += `\n[Photo jointe : ${this.photoFile()!.name}]`;
      }
    }

    this._leadsApi.logLeadActivity(this.data.leadId, {
      type: this.selectedType() as LogActivityRequestTypeEnum,
      subject: this.subject().trim(),
      notes: enrichedNotes || null,
      durationMinutes: this.activeFields().has('duration') ? this.durationMinutes() : null,
      outcome: this.activeFields().has('outcome') && this.outcome()
        ? Number(this.outcome()) as any
        : null,
      scheduledAt: this.activeFields().has('scheduledAt') && this.scheduledAt()
        ? new Date(this.scheduledAt()).toISOString()
        : null,
    }).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', "Impossible d'enregistrer l'activité.");
        this.isSubmitting.set(false);
        return EMPTY;
      }),
    ).subscribe((result) => {
      const typeMeta = ACTIVITY_TYPES.find((t) => t.value === this.selectedType());

      const activity: ActivityDto = {
        id: result.activityId,
        type: this.selectedType() as unknown as ActivityDtoTypeEnum,
        subject: this.subject().trim(),
        notes: enrichedNotes || null,
        performedAt: result.performedAt ?? new Date().toISOString(),
        durationMinutes: this.durationMinutes(),
        outcome: this.outcome() ? Number(this.outcome()) as any : null,
        scheduledAt: this.scheduledAt()
          ? new Date(this.scheduledAt()).toISOString()
          : null,
      };

      // If visit with geo, also update lead coordinates
      if (this.selectedType() === LogActivityRequestTypeEnum.Visit
          && this.geoLatitude() != null && this.geoLongitude() != null) {
        this._leadsApi.updateLead(this.data.leadId, {
          latitude: this.geoLatitude(),
          longitude: this.geoLongitude(),
        }).pipe(catchError(() => EMPTY)).subscribe();
      }

      this._snackbar.success(
        'Activité enregistrée',
        `${typeMeta?.label ?? 'Activité'} ajoutée à la fiche.`,
      );
      this._dialogRef.close({ activity });
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  // ——— Private ———

  private _doGeoRequest(): void {
    this.geoStatus.set('acquiring');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.geoLatitude.set(position.coords.latitude);
        this.geoLongitude.set(position.coords.longitude);
        this.geoStatus.set('acquired');
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          this.geoStatus.set('denied');
        } else {
          this.geoStatus.set('error');
        }
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  private _checkLocationConsent(): void {
    this._leadsApi.listConsents(this.data.leadId).pipe(
      catchError(() => of([] as ConsentDto[])),
    ).subscribe((consents) => {
      const hasGeoConsent = (consents ?? []).some(
        (c) => (c.type === 'Geolocation' || c.type === 'Location' || c.type === 'DataCollection')
          && c.status === 'Granted'
          && !c.withdrawnAt,
      );
      this.hasLocationConsent.set(hasGeoConsent);
    });
  }
}
