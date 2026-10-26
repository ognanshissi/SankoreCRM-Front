import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { CredentialDto, DistributionCredentialsApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { CREDENTIAL_CATEGORY_OPTIONS, credentialCategoryLabel, credentialErrorMessage, formatDay } from './credential.models';

export interface IssueCredentialDrawerData {
  userId: string;
  userName: string;
  /** La carte en vigueur : la nouvelle la remplace et la clôt (renouvellement). */
  current: CredentialDto | null;
}

class IssueCredentialFormModel {
  public category!: string;
  public cardNumber!: string;
  public issuingAuthority!: string;
  public issuedOn!: string;
  public expiresOn!: string;
  public indemnityInsurer!: string;
  public indemnityPolicyReference!: string;
  public indemnityExpiresOn!: string;
  public trainingHours!: string;
  public trainingCompletedOn!: string;
  public supersedeReason!: string;

  public static instantiate(current: CredentialDto | null): IssueCredentialFormModel {
    const m = new IssueCredentialFormModel();
    // Un renouvellement reprend tout sauf le numéro et les dates de la carte. La RC est reprise en
    // entier : l'assureur seul, sans police ni date, rendait la carte « RC non renseignée ».
    m.category = current?.category ?? '';
    m.cardNumber = '';
    m.issuingAuthority = current?.issuingAuthority ?? '';
    m.issuedOn = '';
    m.expiresOn = '';
    m.indemnityInsurer = current?.indemnityInsurer ?? '';
    m.indemnityPolicyReference = current?.indemnityPolicyReference ?? '';
    m.indemnityExpiresOn = current?.indemnityExpiresOn ?? '';
    m.trainingHours = current?.trainingHours != null ? String(current.trainingHours) : '';
    m.trainingCompletedOn = current?.trainingCompletedOn ?? '';
    m.supersedeReason = '';
    return m;
  }
}

/**
 * Enregistre la carte professionnelle d'un utilisateur, ou la renouvelle. Sans carte en vigueur,
 * le serveur refuse que cet utilisateur signe un contrat d'assurance ou reçoive un lead assurance.
 */
@Component({
  selector: 'issue-credential-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
    TasFormField, TasLabel, TasError, TasHint, TasInput, TasSelect, TasDatePicker, TasIcon, Button,
    FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>{{ data.current ? 'Renouveler la carte professionnelle' : 'Enregistrer une carte professionnelle' }}</tas-drawer-title>
      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <p class="text-sm text-slate-600">Pour {{ data.userName }}.</p>

          @if (data.current; as c) {
            <div class="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="note">
              <tas-icon iconName="feather:refresh-cw" class="mt-0.5 shrink-0" style="font-size:14px"></tas-icon>
              <p>
                La carte en vigueur ({{ categoryLabel(c.category) }}, échéance {{ day(c.expiresOn) }}) sera close
                et restera à l'historique : elle couvre les contrats présentés pendant sa validité.
              </p>
            </div>
          }

          <tas-form-field>
            <tas-label>Catégorie <span class="text-functional-error">*</span></tas-label>
            <tas-select [options]="categoryOptions" placeholder="Choisir" [formField]="formSchema.category"></tas-select>
            @if (formSchema.category().touched() && formSchema.category().invalid()) {
              <tas-error>{{ formSchema.category().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <div class="grid grid-cols-2 gap-4">
            <tas-form-field>
              <tas-label>N° de carte <span class="text-functional-error">*</span></tas-label>
              <input tasInput type="text" autocomplete="off" [formField]="formSchema.cardNumber" />
              @if (formSchema.cardNumber().touched() && formSchema.cardNumber().invalid()) {
                <tas-error>{{ formSchema.cardNumber().errors()[0].message }}</tas-error>
              } @else {
                <tas-hint>Enregistré chiffré, jamais réaffiché.</tas-hint>
              }
            </tas-form-field>
            <tas-form-field>
              <tas-label>Délivrée par <span class="text-functional-error">*</span></tas-label>
              <input tasInput type="text" placeholder="Direction nationale des assurances…" [formField]="formSchema.issuingAuthority" />
              @if (formSchema.issuingAuthority().touched() && formSchema.issuingAuthority().invalid()) {
                <tas-error>{{ formSchema.issuingAuthority().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <tas-date-picker mode="date" placeholder="JJ/MM/AAAA" [formField]="formSchema.issuedOn">
                Délivrée le <span class="text-functional-error">*</span>
              </tas-date-picker>
              @if (formSchema.issuedOn().touched() && formSchema.issuedOn().invalid()) {
                <tas-error>{{ formSchema.issuedOn().errors()[0].message }}</tas-error>
              }
            </div>
            <div>
              <tas-date-picker mode="date" placeholder="JJ/MM/AAAA" [formField]="formSchema.expiresOn">
                Échéance <span class="text-functional-error">*</span>
              </tas-date-picker>
              <!-- Dès qu'une date est saisie : le sélecteur ne marque pas le champ « touché », et le
                   bouton restait désactivé sans dire pourquoi. -->
              @if ((formSchema.expiresOn().touched() || formSchema.expiresOn().value()) && formSchema.expiresOn().invalid()) {
                <tas-error>{{ formSchema.expiresOn().errors()[0].message }}</tas-error>
              }
            </div>
          </div>

          <div class="flex flex-col gap-4 rounded-lg border border-slate-200 p-4">
            <div>
              <p class="text-sm font-medium text-slate-800">Assurance de responsabilité civile professionnelle</p>
              <p class="text-xs text-slate-500">Une couverture échue invalide la carte, même en cours de validité.</p>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <tas-form-field>
                <tas-label>Assureur</tas-label>
                <input tasInput type="text" [formField]="formSchema.indemnityInsurer" />
              </tas-form-field>
              <tas-form-field>
                <tas-label>N° de police</tas-label>
                <input tasInput type="text" [formField]="formSchema.indemnityPolicyReference" />
              </tas-form-field>
            </div>
            <div>
              <tas-date-picker mode="date" placeholder="JJ/MM/AAAA" [formField]="formSchema.indemnityExpiresOn">
                Couverte jusqu'au
              </tas-date-picker>
              <tas-hint>Vide tant que l'attestation n'est pas reçue.</tas-hint>
            </div>
          </div>

          <div class="flex flex-col gap-4 rounded-lg border border-slate-200 p-4">
            <div>
              <p class="text-sm font-medium text-slate-800">Formation</p>
              <p class="text-xs text-slate-500">La micro-assurance exige une formation (CIMA art. 732).</p>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <tas-form-field>
                <tas-label>Heures suivies</tas-label>
                <input tasInput type="text" inputmode="numeric" [formField]="formSchema.trainingHours" />
                @if (formSchema.trainingHours().touched() && formSchema.trainingHours().invalid()) {
                  <tas-error>{{ formSchema.trainingHours().errors()[0].message }}</tas-error>
                }
              </tas-form-field>
              <div>
                <tas-date-picker mode="date" placeholder="JJ/MM/AAAA" [formField]="formSchema.trainingCompletedOn">
                  Terminée le
                </tas-date-picker>
              </div>
            </div>
          </div>

          @if (data.current) {
            <tas-form-field>
              <tas-label>Motif du remplacement <span class="text-functional-error">*</span></tas-label>
              <textarea tasInput rows="2" placeholder="Renouvellement à échéance, changement de catégorie…" [formField]="formSchema.supersedeReason"></textarea>
              @if (formSchema.supersedeReason().touched() && formSchema.supersedeReason().invalid()) {
                <tas-error>{{ formSchema.supersedeReason().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          }
        </form>
      </tas-drawer-content>
      <tas-drawer-action>
        <div class="flex justify-end gap-2">
          <button tas-outlined-button color="primary" type="button" class="rounded-full" (click)="dialogRef.close(false)">Annuler</button>
          <button tas-raised-button color="primary" type="button" class="rounded-full"
                  [disabled]="formSchema().invalid() || formSchema().submitting()"
                  [isLoading]="formSchema().submitting()"
                  (click)="handleSubmit()">Enregistrer</button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class IssueCredentialDrawer {
  protected readonly data = inject<IssueCredentialDrawerData>(DIALOG_DATA);
  protected readonly dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(DistributionCredentialsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly categoryOptions = CREDENTIAL_CATEGORY_OPTIONS;
  public readonly categoryLabel = credentialCategoryLabel;
  public readonly day = formatDay;

  public readonly model = signal(IssueCredentialFormModel.instantiate(this.data.current));
  public readonly formSchema = form(this.model, (schema) => {
    required(schema.category, { message: 'Choisissez la catégorie' });
    validate(schema.cardNumber, (ctx) =>
      ctx.value().trim() ? null : { kind: 'required', message: 'Le numéro de carte est obligatoire' });
    validate(schema.issuingAuthority, (ctx) =>
      ctx.value().trim() ? null : { kind: 'required', message: "L'autorité de délivrance est obligatoire" });
    required(schema.issuedOn, { message: 'La date de délivrance est obligatoire' });
    required(schema.expiresOn, { message: "L'échéance est obligatoire" });
    validate(schema.expiresOn, (ctx) => {
      const expires = ctx.value();
      const issued = ctx.valueOf(schema.issuedOn);
      return expires && issued && expires <= issued
        ? { kind: 'min', message: "L'échéance doit suivre la date de délivrance" }
        : null;
    });
    validate(schema.trainingHours, (ctx) => {
      const raw = String(ctx.value() ?? '').trim();
      if (!raw) return null;
      const hours = Number(raw);
      return Number.isInteger(hours) && hours >= 0 ? null : { kind: 'min', message: "Un nombre d'heures entier, positif ou nul" };
    });
    validate(schema.supersedeReason, (ctx) =>
      !this.data.current || ctx.value().trim() ? null : { kind: 'required', message: 'Le motif est obligatoire pour un remplacement' });
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const v = field().value();
      const hours = String(v.trainingHours ?? '').trim();
      const created = await firstValueFrom(
        this._api
          .issueUserCredential(this.data.userId, {
            category: v.category,
            cardNumber: v.cardNumber.trim(),
            issuingAuthority: v.issuingAuthority.trim(),
            issuedOn: v.issuedOn,
            expiresOn: v.expiresOn,
            indemnityInsurer: v.indemnityInsurer.trim() || null,
            indemnityPolicyReference: v.indemnityPolicyReference.trim() || null,
            indemnityExpiresOn: v.indemnityExpiresOn || null,
            trainingHours: hours ? Number(hours) : null,
            trainingCompletedOn: v.trainingCompletedOn || null,
            supersedeReason: this.data.current ? v.supersedeReason.trim() : null,
          })
          .pipe(
            catchError((err: HttpErrorResponse) => {
              this._snackbar.error('Carte non enregistrée', credentialErrorMessage(err, "La carte n'a pas pu être enregistrée."));
              return EMPTY;
            }),
          ),
        { defaultValue: null },
      );
      if (!created) return;
      this._snackbar.success('Carte enregistrée', `${credentialCategoryLabel(created.category)}, valide jusqu'au ${formatDay(created.expiresOn)}.`);
      this.dialogRef.close(true);
    });
  }
}
