import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { InsuranceDistributionApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  DISTRIBUTOR_FILE_MAX_BYTES,
  DISTRIBUTOR_FILE_TYPES,
  DISTRIBUTOR_KIND_META,
  DISTRIBUTOR_KIND_OPTIONS,
  distributorErrorMessage,
  DistributorKind,
} from './insurance-distribution.models';

export interface AddDistributorDocumentDrawerData {
  /** Nature proposée à l'ouverture (depuis la liste des pièces exigées) ; vide sinon. */
  kind?: DistributorKind;
  /** Natures ayant déjà une pièce en vigueur : la nouvelle la remplacera. */
  currentKinds: DistributorKind[];
}

class AddDocumentFormModel {
  public kind!: string;
  public reference!: string;
  public issuer!: string;
  public issuedOn!: string;
  public expiresOn!: string;

  public static instantiate(kind?: string): AddDocumentFormModel {
    const m = new AddDocumentFormModel();
    m.kind = kind ?? '';
    m.reference = '';
    m.issuer = '';
    m.issuedOn = '';
    m.expiresOn = '';
    return m;
  }
}

/**
 * Enregistre une pièce du distributeur. Une pièce de même nature déjà en vigueur est remplacée
 * (renouvellement) mais reste au dossier : elle couvrait les contrats signés pendant sa validité.
 */
@Component({
  selector: 'add-distributor-document-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
    TasFormField, TasLabel, TasError, TasHint, TasInput, TasSelect, TasDatePicker, TasIcon, Button,
    FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>Ajouter une pièce</tas-drawer-title>
      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <tas-form-field>
            <tas-label>Nature <span class="text-functional-error">*</span></tas-label>
            <tas-select [options]="kindOptions" placeholder="Choisir" [formField]="formSchema.kind"></tas-select>
            @if (formSchema.kind().touched() && formSchema.kind().invalid()) {
              <tas-error>{{ formSchema.kind().errors()[0].message }}</tas-error>
            } @else if (kindHint()) {
              <tas-hint>{{ kindHint() }}</tas-hint>
            }
          </tas-form-field>

          @if (replacesCurrent()) {
            <div class="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="note">
              <tas-icon iconName="feather:refresh-cw" class="mt-0.5 shrink-0" style="font-size:14px"></tas-icon>
              <p>Une pièce de cette nature est déjà en vigueur : elle sera marquée « Remplacée » et restera au dossier.</p>
            </div>
          }

          <tas-form-field>
            <tas-label>Référence <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" placeholder="N° d’agrément, de garantie, de police RC…" [formField]="formSchema.reference" />
            @if (formSchema.reference().touched() && formSchema.reference().invalid()) {
              <tas-error>{{ formSchema.reference().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Émetteur</tas-label>
            <input tasInput type="text" placeholder="Autorité de contrôle, garant, assureur RC" [formField]="formSchema.issuer" />
          </tas-form-field>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <tas-date-picker mode="date" placeholder="Sélectionnez une date" [formField]="formSchema.issuedOn">
                Délivrée le
              </tas-date-picker>
            </div>
            <div>
              <tas-date-picker mode="date" placeholder="Sans échéance" [formField]="formSchema.expiresOn">
                Échéance
              </tas-date-picker>
              @if (formSchema.expiresOn().touched() && formSchema.expiresOn().invalid()) {
                <tas-error>{{ formSchema.expiresOn().errors()[0].message }}</tas-error>
              } @else {
                <tas-hint>Vide pour une pièce sans échéance.</tas-hint>
              }
            </div>
          </div>

          <div>
            <p class="mb-1 text-sm text-slate-700">Pièce scannée</p>
            <input #fileInput type="file" accept=".pdf,.jpg,.jpeg,.png" class="hidden" (change)="onFileSelected($event)" />
            @if (file(); as f) {
              <div class="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <tas-icon iconName="feather:file" class="text-slate-500" style="font-size:14px"></tas-icon>
                <span class="min-w-0 flex-1 truncate text-slate-800">{{ f.name }}</span>
                <span class="text-xs text-slate-500 tabular-nums">{{ sizeLabel(f.size) }}</span>
                <button tas-text-button type="button" class="text-sm" (click)="clearFile(fileInput)">Retirer</button>
              </div>
            } @else {
              <button tas-outlined-button color="primary" type="button" class="rounded-full text-sm" (click)="fileInput.click()">
                <tas-icon iconName="feather:upload" style="font-size:14px"></tas-icon>
                Joindre un fichier
              </button>
            }
            @if (fileError(); as error) {
              <tas-error>{{ error }}</tas-error>
            } @else {
              <tas-hint>Facultatif — PDF, JPEG ou PNG, 10 Mo au plus.</tas-hint>
            }
          </div>
        </form>
      </tas-drawer-content>
      <tas-drawer-action>
        <div class="flex justify-end gap-2">
          <button tas-outlined-button color="primary" type="button" class="rounded-full" (click)="dialogRef.close(false)">Annuler</button>
          <button tas-raised-button color="primary" type="button" class="rounded-full"
                  [disabled]="formSchema().invalid() || formSchema().submitting() || !!fileError()"
                  [isLoading]="formSchema().submitting()"
                  (click)="handleSubmit()">Enregistrer</button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class AddDistributorDocumentDrawer {
  protected readonly data = inject<AddDistributorDocumentDrawerData>(DIALOG_DATA);
  protected readonly dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(InsuranceDistributionApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly kindOptions = DISTRIBUTOR_KIND_OPTIONS;
  public readonly file = signal<File | null>(null);
  public readonly fileError = signal<string | null>(null);

  public readonly model = signal(AddDocumentFormModel.instantiate(this.data.kind));
  public readonly formSchema = form(this.model, (schema) => {
    required(schema.kind, { message: 'Choisissez la nature de la pièce' });
    validate(schema.reference, (ctx) =>
      ctx.value().trim() ? null : { kind: 'required', message: 'La référence est obligatoire' });
    validate(schema.expiresOn, (ctx) => {
      const expires = ctx.value();
      const issued = ctx.valueOf(schema.issuedOn);
      return expires && issued && expires < issued
        ? { kind: 'min', message: 'L’échéance précède la date de délivrance' }
        : null;
    });
  });

  public kindHint(): string | null {
    return DISTRIBUTOR_KIND_META[this.formSchema.kind().value() as DistributorKind]?.hint ?? null;
  }

  public replacesCurrent(): boolean {
    return this.data.currentKinds.includes(this.formSchema.kind().value() as DistributorKind);
  }

  public sizeLabel(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  }

  /** Contrôlé ici pour ne pas téléverser 10 Mo et plus avant d'apprendre le refus du serveur. */
  public onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.file.set(file);
    if (!file) {
      this.fileError.set(null);
    } else if (file.size > DISTRIBUTOR_FILE_MAX_BYTES) {
      this.fileError.set('Le fichier dépasse 10 Mo.');
    } else if (file.type && !DISTRIBUTOR_FILE_TYPES.includes(file.type)) {
      this.fileError.set('Seuls les fichiers PDF, JPEG et PNG sont acceptés.');
    } else {
      this.fileError.set(null);
    }
  }

  public clearFile(input: HTMLInputElement): void {
    input.value = '';
    this.file.set(null);
    this.fileError.set(null);
  }

  public handleSubmit(): void {
    if (this.fileError()) return;
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const created = await firstValueFrom(
        this._api.addInsuranceDistributorDocument(
          value.kind,
          value.reference.trim(),
          value.issuer.trim() || undefined,
          value.issuedOn || undefined,
          value.expiresOn || undefined,
          this.file() ?? undefined,
        ).pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Pièce non enregistrée', distributorErrorMessage(err.error?.error, 'La pièce n’a pas pu être enregistrée.'));
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );
      if (!created) return;
      this._snackbar.success('Pièce enregistrée', DISTRIBUTOR_KIND_META[value.kind as DistributorKind]?.label ?? '');
      this.dialogRef.close(true);
    });
  }
}
