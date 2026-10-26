import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormField, FormRoot, form, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, forkJoin, of } from 'rxjs';
import { CustomerSettingsApiService, LeadSettingsApiService } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSwitch } from '@talisoft/ui/switch';

const WHATSAPP_COMPLAINTS_KEY = 'whatsapp-bot-complaints-enabled';
const ACKNOWLEDGEMENT_DAYS_KEY = 'complaint-acknowledgement-days';
const RESOLUTION_DAYS_KEY = 'complaint-resolution-days';

class ComplaintDelaysFormModel {
  public acknowledgementDays!: string;
  public resolutionDays!: string;

  public static instantiate(acknowledgement = '2', resolution = '30'): ComplaintDelaysFormModel {
    const m = new ComplaintDelaysFormModel();
    m.acknowledgementDays = acknowledgement;
    m.resolutionDays = resolution;
    return m;
  }
}

function days(value: string): number | null {
  const n = Number(value?.trim());
  return Number.isInteger(n) ? n : null;
}

/**
 * Les réclamations des clients (2026-10-26) : la prise de réclamation par WhatsApp, et les délais
 * d'accusé de réception et de réponse de TOUTES les réclamations, saisies en agence comprises.
 *
 * Deux réglages de deux modules, d'où deux droits : l'interrupteur est un paramètre des leads
 * (`lead:settings:manage`), les délais un paramètre clients (`customers:update_sensitive`). Chaque
 * partie se fige sans son droit plutôt que de laisser envoyer une requête refusée.
 */
@Component({
  selector: 'complaint-settings-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRoot, FormField, Button, TasCard, TasFormField, TasLabel, TasError, TasHint, TasInput, TasSwitch],
  template: `
    <tas-card class="block">
      <div class="flex flex-col gap-4 p-4">
        <div class="flex items-start gap-3">
          <tas-switch
            [checked]="whatsAppEnabled()"
            [isLoading]="isToggling()"
            [disabled]="isToggling() || !canManageLeadSettings()"
            ariaLabel="Recueillir les réclamations sur WhatsApp"
            (toggle)="setWhatsAppEnabled($event)"
          ></tas-switch>
          <div>
            <p class="text-sm font-semibold text-slate-800">Réclamations sur WhatsApp</p>
            <p class="mt-0.5 text-xs text-slate-500">
              @if (whatsAppEnabled()) {
                « Réclamation » ou « plainte » lance un échange guidé : numéro client, date de naissance,
                description, catégorie. La réclamation est enregistrée sur la fiche du client et son conseiller
                est prévenu. Aucune réponse n'est envoyée au modèle d'IA ; fonctionne aussi chatbot désactivé.
              } @else {
                Désactivé : un client qui écrit « réclamation » ou « plainte » est passé à un conseiller.
              }
            </p>
          </div>
        </div>

        <form [formRoot]="formSchema" class="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
          <tas-form-field>
            <tas-label>Accusé de réception (jours)</tas-label>
            <input tasInput type="text" inputmode="numeric" class="tabular-nums" [formField]="formSchema.acknowledgementDays" />
            @if (formSchema.acknowledgementDays().touched() && formSchema.acknowledgementDays().invalid()) {
              <tas-error>{{ formSchema.acknowledgementDays().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Réponse (jours)</tas-label>
            <input tasInput type="text" inputmode="numeric" class="tabular-nums" [formField]="formSchema.resolutionDays" />
            @if (formSchema.resolutionDays().touched() && formSchema.resolutionDays().invalid()) {
              <tas-error>{{ formSchema.resolutionDays().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <div class="flex items-end">
            <button
              tas-outlined-button
              color="primary"
              type="button"
              [disabled]="!canManageCustomerSettings() || formSchema().invalid() || formSchema().submitting()"
              [isLoading]="formSchema().submitting()"
              (click)="saveDelays()"
            >
              Enregistrer les délais
            </button>
          </div>

          <tas-hint class="sm:col-span-3">
            Valent pour toutes les réclamations, WhatsApp ou agence. Une réclamation déjà enregistrée garde ses échéances.
          </tas-hint>
        </form>
      </div>
    </tas-card>
  `,
})
export class ComplaintSettingsCard implements OnInit {
  private readonly _leadSettings = inject(LeadSettingsApiService);
  private readonly _customerSettings = inject(CustomerSettingsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _permissions = inject(PermissionsService);

  public readonly canManageLeadSettings = this._permissions.can('lead:settings:manage');
  public readonly canManageCustomerSettings = this._permissions.can('customers:update_sensitive');

  public readonly whatsAppEnabled = signal(false);
  public readonly isToggling = signal(false);

  public readonly model = signal(ComplaintDelaysFormModel.instantiate());
  public readonly formSchema = form(this.model, (schema) => {
    validate(schema.acknowledgementDays, (ctx) => {
      const n = days(ctx.value());
      return n !== null && n >= 1 && n <= 365 ? null : { kind: 'range', message: 'Entre 1 et 365 jours' };
    });
    validate(schema.resolutionDays, (ctx) => {
      const n = days(ctx.value());
      if (n === null || n < 1 || n > 365) return { kind: 'range', message: 'Entre 1 et 365 jours' };
      const acknowledgement = days(ctx.valueOf(schema.acknowledgementDays));
      return acknowledgement !== null && n < acknowledgement
        ? { kind: 'order', message: "La réponse ne peut pas être due avant l'accusé de réception" }
        : null;
    });
  });

  public ngOnInit(): void {
    forkJoin({
      enabled: this._leadSettings.getLeadSetting(WHATSAPP_COMPLAINTS_KEY).pipe(catchError(() => of(null))),
      acknowledgement: this._customerSettings.getCustomerSetting(ACKNOWLEDGEMENT_DAYS_KEY).pipe(catchError(() => of(null))),
      resolution: this._customerSettings.getCustomerSetting(RESOLUTION_DAYS_KEY).pipe(catchError(() => of(null))),
    }).subscribe(({ enabled, acknowledgement, resolution }) => {
      this.whatsAppEnabled.set(enabled?.value === 'true');
      this.model.set(
        ComplaintDelaysFormModel.instantiate(acknowledgement?.value ?? '2', resolution?.value ?? '30'),
      );
    });
  }

  public setWhatsAppEnabled(enabled: boolean): void {
    this.isToggling.set(true);
    this._leadSettings
      .updateLeadSetting(WHATSAPP_COMPLAINTS_KEY, { value: String(enabled) })
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', "Le réglage n'a pas pu être enregistré.");
          this.isToggling.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.whatsAppEnabled.set(enabled);
        this.isToggling.set(false);
        this._snackbar.success(
          enabled ? 'Réclamations WhatsApp activées' : 'Réclamations WhatsApp désactivées',
          enabled
            ? 'Les clients peuvent déposer une réclamation sur WhatsApp.'
            : 'Une réclamation sur WhatsApp passe désormais à un conseiller.',
        );
      });
  }

  public saveDelays(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      try {
        await firstValueFrom(
          forkJoin([
            this._customerSettings.updateCustomerSetting(ACKNOWLEDGEMENT_DAYS_KEY, { value: value.acknowledgementDays.trim() }),
            this._customerSettings.updateCustomerSetting(RESOLUTION_DAYS_KEY, { value: value.resolutionDays.trim() }),
          ]),
        );
        this._snackbar.success('Délais enregistrés', "Ils s'appliquent aux prochaines réclamations.");
      } catch {
        this._snackbar.error('Erreur', "Les délais n'ont pas pu être enregistrés.");
      }
      return undefined;
    });
  }
}
