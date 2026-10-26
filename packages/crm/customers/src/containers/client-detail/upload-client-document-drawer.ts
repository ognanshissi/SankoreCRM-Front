import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { FormField, FormRoot, form, maxLength, required, submit, validate } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasFileUploader } from '@talisoft/ui/file-uploader';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ClientDocumentsApiService } from '@sankore/crm-api';
import {
  CLIENT_DOCUMENT_ACCEPT,
  CLIENT_DOCUMENT_KIND_OPTIONS,
  CLIENT_DOCUMENT_MAX_SIZE_MB,
  DOCUMENT_DIRECTION_OPTIONS,
} from './client-documents.labels';

export interface UploadClientDocumentDrawerData {
  clientId: string;
}

class UploadClientDocumentFormModel {
  public kind!: string;
  public title!: string;
  public direction!: string;
  public documentDate!: string;

  public static instantiate(): UploadClientDocumentFormModel {
    const m = new UploadClientDocumentFormModel();
    m.kind = 'Correspondence';
    m.title = '';
    m.direction = 'Collected';
    m.documentDate = new Date().toISOString().slice(0, 10);
    return m;
  }
}

const ERRORS: Record<string, string> = {
  CLIENT_DOCUMENT_TYPE_NOT_ALLOWED: "Ce type de fichier n'est pas accepté (PDF, image, Office, texte).",
  CLIENT_DOCUMENT_TOO_LARGE: `Le fichier dépasse ${CLIENT_DOCUMENT_MAX_SIZE_MB} Mo.`,
  CLIENT_DOCUMENT_EMPTY: 'Le fichier est vide.',
  CLIENT_DOCUMENTS_UNAVAILABLE: "Le dépôt de documents n'est pas configuré sur cette installation.",
  CLIENT_READ_ONLY: 'La fiche est en lecture seule : aucun document ne peut y être déposé.',
};

/**
 * Dépôt d'un document sur la fiche client (2026-10-26) : un courrier, un justificatif, tout ce
 * qui n'appartient ni à un dossier KYC, ni à un contrat, ni à un sinistre.
 */
@Component({
  selector: 'upload-client-document-drawer',
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
    TasInput,
    TasSelect,
    TasDatePicker,
    TasFileUploader,
    Button,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <span class="text-lg font-semibold text-slate-800">Déposer un document</span>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <!-- Hors de tas-form-field : il ne projette que ses propres emplacements (label, input,
               erreur, aide) et masquait la zone de dépôt — constaté en recette. -->
          <div class="flex flex-col gap-2">
            <div>
              <p class="text-sm font-medium text-slate-800">Fichier <span class="text-functional-error">*</span></p>
              <p class="mt-0.5 text-xs text-slate-500">
                PDF, image, document Office ou texte ; {{ maxSizeMb }} Mo au plus. Stocké chiffré.
              </p>
            </div>
            <tas-file-uploader
              [accept]="accept"
              [maxSizeMb]="maxSizeMb"
              [value]="file()"
              (valueChange)="file.set($event)"
            ></tas-file-uploader>
          </div>

          <tas-form-field>
            <tas-label>Titre <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" placeholder="Courrier de relance du 12/10" [formField]="formSchema.title" />
            @if (formSchema.title().touched() && formSchema.title().invalid()) {
              <tas-error>{{ formSchema.title().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <tas-form-field>
              <tas-label>Type <span class="text-functional-error">*</span></tas-label>
              <tas-select [options]="kindOptions" [formField]="formSchema.kind"></tas-select>
            </tas-form-field>

            <tas-form-field>
              <tas-label>Sens <span class="text-functional-error">*</span></tas-label>
              <tas-select [options]="directionOptions" [formField]="formSchema.direction"></tas-select>
            </tas-form-field>
          </div>

          <div>
            <tas-date-picker mode="date" [formField]="formSchema.documentDate">
              Date du document <span class="text-functional-error">*</span>
            </tas-date-picker>
            <p class="mt-1 text-xs text-slate-500">La date du document lui-même, pas celle du dépôt.</p>
            @if (formSchema.documentDate().touched() && formSchema.documentDate().invalid()) {
              <tas-error>{{ formSchema.documentDate().errors()[0].message }}</tas-error>
            }
          </div>
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-2">
          <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
          <button
            tas-raised-button
            color="primary"
            type="button"
            [disabled]="!file() || formSchema().invalid() || formSchema().submitting()"
            [isLoading]="formSchema().submitting()"
            (click)="handleSubmit()"
          >
            Déposer
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class UploadClientDocumentDrawer {
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _api = inject(ClientDocumentsApiService);
  private readonly _snackbar = inject(SnackbarService);
  public readonly data = inject<UploadClientDocumentDrawerData>(DIALOG_DATA);

  public readonly accept = CLIENT_DOCUMENT_ACCEPT;
  public readonly maxSizeMb = CLIENT_DOCUMENT_MAX_SIZE_MB;
  public readonly kindOptions = CLIENT_DOCUMENT_KIND_OPTIONS;
  public readonly directionOptions = DOCUMENT_DIRECTION_OPTIONS;

  public readonly file = signal<File | null>(null);
  public readonly model = signal(UploadClientDocumentFormModel.instantiate());
  public readonly formSchema = form(this.model, (schema) => {
    required(schema.title, { message: 'Le titre est obligatoire' });
    maxLength(schema.title, 200, { message: '200 caractères au plus' });
    required(schema.kind, { message: 'Le type est obligatoire' });
    required(schema.direction, { message: 'Le sens est obligatoire' });
    required(schema.documentDate, { message: 'La date est obligatoire' });
    validate(schema.documentDate, ({ value }) => {
      const raw = value();
      // Comparaison sur la chaîne `yyyy-MM-dd` : passer par `Date` ramènerait le décalage UTC.
      return !raw || raw <= new Date().toISOString().slice(0, 10)
        ? null
        : { kind: 'future', message: 'La date ne peut pas être dans le futur' };
    });
  });

  public handleSubmit(): void {
    const file = this.file();
    if (!file) return;

    submit(this.formSchema, async (field) => {
      const value = field().value();
      try {
        await firstValueFrom(
          this._api.uploadClientDocument(
            this.data.clientId, file, value.kind, value.title.trim(), value.direction, value.documentDate.slice(0, 10),
          ),
        );
        this._snackbar.success('Document déposé', `« ${value.title.trim()} » est sur la fiche du client.`);
        this._dialogRef.close(true);
      } catch (err) {
        const code = (err as HttpErrorResponse)?.error?.error as string | undefined;
        this._snackbar.error('Dépôt refusé', (code && ERRORS[code]) || "Le document n'a pas pu être déposé.");
      }
      return undefined;
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
