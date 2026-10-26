import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { FormField, FormRoot, form, maxLength, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ClientComplaintsApiService, ProductHoldingsApiService } from '@sankore/crm-api';
import { COMPLAINT_CATEGORY_OPTIONS, COMPLAINT_CHANNEL_OPTIONS } from './client-complaints.labels';

export interface RecordClientComplaintDrawerData {
  clientId: string;
}

class RecordClientComplaintFormModel {
  public channel!: string;
  public category!: string;
  public subject!: string;
  public description!: string;
  public holdingId!: string;

  public static instantiate(): RecordClientComplaintFormModel {
    const m = new RecordClientComplaintFormModel();
    m.channel = 'Branch';
    m.category = '';
    m.subject = '';
    m.description = '';
    m.holdingId = '';
    return m;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  CLIENT_READ_ONLY: 'La fiche est en lecture seule : aucune réclamation ne peut y être ajoutée.',
  COMPLAINT_HOLDING_NOT_OF_CLIENT: "Le contrat choisi n'appartient pas à ce client.",
  CLIENT_NOT_FOUND: "Ce client n'est pas dans votre périmètre.",
};

/**
 * Enregistrement d'une réclamation par un agent (2026-10-26). Les délais viennent des réglages
 * de l'institution et la réclamation est attribuée par le serveur — conseiller, à défaut
 * créateur, à défaut responsable d'agence —, qui la prévient : rien de cela ne se choisit ici.
 */
@Component({
  selector: 'record-client-complaint-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    Button,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <span class="text-lg font-semibold text-slate-800">Enregistrer une réclamation</span>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-4">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <tas-form-field>
              <tas-label>Canal <span class="text-functional-error">*</span></tas-label>
              <tas-select [options]="channelOptions" [formField]="formSchema.channel"></tas-select>
            </tas-form-field>

            <tas-form-field>
              <tas-label>Catégorie <span class="text-functional-error">*</span></tas-label>
              <tas-select [options]="categoryOptions" placeholder="Choisir" [formField]="formSchema.category"></tas-select>
              @if (formSchema.category().touched() && formSchema.category().invalid()) {
                <tas-error>{{ formSchema.category().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          </div>

          <tas-form-field>
            <tas-label>Objet <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" placeholder="Frais de dossier prélevés deux fois" [formField]="formSchema.subject" />
            <tas-hint>Affiché dans les listes et les notifications : n'y mettez ni montant ni donnée personnelle.</tas-hint>
            @if (formSchema.subject().touched() && formSchema.subject().invalid()) {
              <tas-error>{{ formSchema.subject().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Ce que dit le client <span class="text-functional-error">*</span></tas-label>
            <textarea tasInput rows="6" [formField]="formSchema.description"></textarea>
            <tas-hint>Conservé chiffré, lisible depuis le détail de la réclamation.</tas-hint>
            @if (formSchema.description().touched() && formSchema.description().invalid()) {
              <tas-error>{{ formSchema.description().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          @if (holdingOptions().length > 0) {
            <tas-form-field>
              <tas-label>Contrat concerné</tas-label>
              <tas-select [options]="holdingOptions()" placeholder="Aucun en particulier" clearable [formField]="formSchema.holdingId"></tas-select>
            </tas-form-field>
          }

          <p class="text-xs text-slate-500">
            La réclamation est attribuée au conseiller du client, qui reçoit une tâche, une notification et
            un e-mail. Les délais d'accusé de réception et de réponse sont ceux de l'institution.
          </p>
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-2">
          <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
          <button
            tas-raised-button
            color="primary"
            type="button"
            [disabled]="formSchema().invalid() || formSchema().submitting()"
            [isLoading]="formSchema().submitting()"
            (click)="handleSubmit()"
          >
            Enregistrer
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class RecordClientComplaintDrawer implements OnInit {
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _api = inject(ClientComplaintsApiService);
  private readonly _holdingsApi = inject(ProductHoldingsApiService);
  private readonly _snackbar = inject(SnackbarService);
  public readonly data = inject<RecordClientComplaintDrawerData>(DIALOG_DATA);

  public readonly channelOptions = COMPLAINT_CHANNEL_OPTIONS;
  public readonly categoryOptions = COMPLAINT_CATEGORY_OPTIONS;
  public readonly holdingOptions = signal<{ value: string; label: string }[]>([]);

  public readonly model = signal(RecordClientComplaintFormModel.instantiate());
  public readonly formSchema = form(this.model, (schema) => {
    required(schema.channel, { message: 'Le canal est obligatoire' });
    required(schema.category, { message: 'La catégorie est obligatoire' });
    required(schema.subject, { message: "L'objet est obligatoire" });
    maxLength(schema.subject, 200, { message: '200 caractères au plus' });
    required(schema.description, { message: 'Décrivez la réclamation' });
  });

  public ngOnInit(): void {
    // Facultatif : sans le droit de lire les contrats, le champ n'apparaît simplement pas.
    this._holdingsApi
      .listClientHoldings(this.data.clientId, undefined, undefined, 1, 100)
      .pipe(catchError(() => EMPTY))
      .subscribe((page) =>
        this.holdingOptions.set(
          (page.items ?? [])
            .filter((h) => !!h.holdingId)
            .map((h) => ({
              value: h.holdingId!,
              label: [h.productCode ?? 'Contrat', h.externalRef].filter(Boolean).join(' · '),
            })),
        ),
      );
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      try {
        const created = await firstValueFrom(
          this._api.fileClientComplaint(this.data.clientId, {
            channel: value.channel,
            category: value.category,
            subject: value.subject.trim(),
            description: value.description.trim(),
            holdingId: value.holdingId || null,
          }),
        );
        this._snackbar.success('Réclamation enregistrée', `Référence ${created.reference}.`);
        this._dialogRef.close(true);
      } catch (err) {
        const code = err instanceof HttpErrorResponse ? err.error?.error : undefined;
        this._snackbar.error('Enregistrement impossible', ERROR_MESSAGES[code] ?? "La réclamation n'a pas pu être enregistrée.");
      }
      return undefined;
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
