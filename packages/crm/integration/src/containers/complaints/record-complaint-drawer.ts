import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { FormField, form, required, submit, validate } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  RecordComplaintRequestCategoryEnum,
  RecordComplaintRequestChannelEnum,
} from '@sankore/crm-api';
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_CHANNELS,
} from '../../data-access/integration-referential';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../../data-access/integration-facade.service';

export interface RecordComplaintDrawerData {
  /** Pré-rempli quand on arrive depuis la fiche d'un client. */
  crmCustomerId?: string;
  customerLabel?: string;
}

class RecordComplaintFormModel {
  public crmCustomerId!: string;
  // Typés depuis l'énumération du contrat : le générateur en produit une vraie, donc un
  // canal que le serveur ne connaît pas ne compile pas.
  public channel!: RecordComplaintRequestChannelEnum | '';
  public category!: RecordComplaintRequestCategoryEnum | '';
  public subject!: string;
  public body!: string;
  public receivedAt!: string;

  public static instantiate(crmCustomerId: string): RecordComplaintFormModel {
    const m = new RecordComplaintFormModel();
    m.crmCustomerId = crmCustomerId;
    m.channel = '';
    m.category = '';
    m.subject = '';
    m.body = '';
    // Par défaut aujourd'hui, mais modifiable : les délais du mécanisme courent depuis
    // le moment où le CLIENT s'est plaint, pas depuis la saisie. Un courrier enregistré
    // trois jours en retard ne doit pas acheter trois jours de plus à l'institution.
    m.receivedAt = new Date().toISOString().slice(0, 10);
    return m;
  }
}

/**
 * Dépôt d'une réclamation — mécanisme du règlement n° 01/CIMA/PCMA/CE/SG/2024.
 *
 * L'objet est en clair et le CORPS est chiffré côté serveur : l'objet apparaît dans les
 * listes et dans le rapport remis au superviseur, le corps est du texte libre sur le
 * grief d'une personne nommée. L'écran le dit, pour que l'agent sache où il peut écrire
 * un nom et où il ne doit pas.
 */
@Component({
  // Pas de `selector` : ce drawer s'ouvre par `SideDrawerService.open()` et n'est jamais
  // posé comme balise dans un gabarit. Un sélecteur serait une métadonnée morte — et
  // celle que la règle de lint du dépôt refuse.
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasAlert,
    Button,
    TasDatePicker,
    TasFormField,
    TasLabel,
    TasHint,
    TasError,
    TasInput,
    TasSelect,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <span class="text-lg font-semibold text-slate-800">Enregistrer une réclamation</span>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-4">
          <tas-alert type="info">
            <p class="text-xs">
              Les deux délais du mécanisme — accuser réception, puis répondre — courent
              depuis la date de réception saisie ici, et sont figés à l'enregistrement.
            </p>
          </tas-alert>

          @if (!data.crmCustomerId) {
            <tas-form-field>
              <tas-label>Client <span class="text-functional-error">*</span></tas-label>
              <input tasInput type="text" [formField]="formSchema.crmCustomerId" />
              <tas-hint>Identifiant du client concerné.</tas-hint>
              @if (formSchema.crmCustomerId().touched() && formSchema.crmCustomerId().invalid()) {
                <tas-error>{{ formSchema.crmCustomerId().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          } @else {
            <div>
              <p class="text-xs text-slate-500">Client</p>
              <p class="mt-1 text-sm text-slate-800">{{ data.customerLabel || data.crmCustomerId }}</p>
            </div>
          }

          <div>
            <tas-date-picker mode="date" [formField]="formSchema.receivedAt">
              Reçue le <span class="text-functional-error">*</span>
            </tas-date-picker>
            <tas-hint>La date à laquelle le client s'est plaint, pas celle de la saisie.</tas-hint>
            @if (formSchema.receivedAt().touched() && formSchema.receivedAt().invalid()) {
              <tas-error>{{ formSchema.receivedAt().errors()[0].message }}</tas-error>
            }
          </div>

          <tas-form-field>
            <tas-label>Canal <span class="text-functional-error">*</span></tas-label>
            <tas-select
              [options]="channelOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="Par quel canal est-elle arrivée ?"
              [formField]="formSchema.channel"
            ></tas-select>
            @if (formSchema.channel().touched() && formSchema.channel().invalid()) {
              <tas-error>{{ formSchema.channel().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Objet <span class="text-functional-error">*</span></tas-label>
            <tas-select
              [options]="categoryOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="Sur quoi porte-t-elle ?"
              [formField]="formSchema.category"
            ></tas-select>
            <tas-hint>
              Liste fermée : c'est ce que compte le rapport remis au superviseur.
            </tas-hint>
            @if (formSchema.category().touched() && formSchema.category().invalid()) {
              <tas-error>{{ formSchema.category().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Intitulé <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" [formField]="formSchema.subject" />
            <tas-hint>
              Une ligne, lisible par un opérateur. Elle apparaît dans les listes et dans le
              rapport, donc <strong>n'y mettez pas de nom ni de montant</strong>.
            </tas-hint>
            @if (formSchema.subject().touched() && formSchema.subject().invalid()) {
              <tas-error>{{ formSchema.subject().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Ce que dit le client</tas-label>
            <textarea
              tasInput
              rows="5"
              [formField]="formSchema.body"
              placeholder="Le grief, dans les mots du client."
            ></textarea>
            <tas-hint>Chiffré au repos. C'est ici que va le détail nominatif.</tas-hint>
          </tas-form-field>
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-button type="button" (click)="close()">Annuler</button>
        <button
          tas-raised-button
          color="primary"
          type="button"
          [disabled]="isSaving()"
          (click)="handleSubmit()"
        >
          Enregistrer
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class RecordComplaintDrawer {
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _integration = inject(IntegrationFacadeService);

  public readonly data = inject<RecordComplaintDrawerData>(DIALOG_DATA);

  public readonly channelOptions = COMPLAINT_CHANNELS.map((c) => ({ ...c }));
  public readonly categoryOptions = COMPLAINT_CATEGORIES.map((c) => ({ ...c }));

  public readonly isSaving = signal(false);

  public readonly model = signal(
    RecordComplaintFormModel.instantiate(this.data.crmCustomerId ?? ''),
  );

  public readonly formSchema = form(this.model, (schema) => {
    required(schema.crmCustomerId, { message: 'Le client concerné est obligatoire' });
    required(schema.channel, { message: "Le canal d'arrivée est obligatoire" });
    required(schema.category, { message: "L'objet est obligatoire" });
    required(schema.subject, { message: "L'intitulé est obligatoire" });

    required(schema.receivedAt, { message: 'La date de réception est obligatoire' });
    validate(schema.receivedAt, ({ value }) => {
      const raw = value();
      if (!raw) return null;

      // Comparaison sur la chaîne `yyyy-MM-dd`, comme la déclaration de sinistre :
      // passer par `Date` ramènerait le décalage UTC qui fait basculer « aujourd'hui »
      // à la veille. Le serveur refuse aussi une date future, et répondre ici évite
      // d'aller chercher un 400 pour une faute de frappe.
      const today = new Date().toISOString().slice(0, 10);
      return raw <= today
        ? null
        : { kind: 'future', message: 'Une réclamation ne peut pas être reçue dans le futur' };
    });
  });

  public handleSubmit(): void {
    submit(this.formSchema, async () => {
      const value = this.model();
      this.isSaving.set(true);

      try {
        const complaint = await firstValueFrom(
          this._integration.recordComplaint({
            crmCustomerId: value.crmCustomerId,
            // Le `|| undefined` ne se produit pas : le formulaire exige les deux. Il est
            // là pour le typage, l'énumération générée n'acceptant pas la chaîne vide.
            channel: value.channel || undefined,
            category: value.category || undefined,
            subject: value.subject,
            body: value.body?.trim() ? value.body.trim() : null,
            connectionId: null,
            policyId: null,
            claimId: null,
            // Minuit UTC du jour saisi : le serveur attend un instant et calcule les
            // deux délais à partir de lui.
            receivedAt: `${value.receivedAt}T00:00:00Z`,
          }),
        );

        this._snackbar.success(
          'Réclamation enregistrée',
          `Référence ${complaint.reference ?? '—'}. L'accusé de réception est dû.`,
        );

        this._dialogRef.close(true);
      } catch (error) {
        this._snackbar.error(
          'Réclamation non enregistrée',
          integrationErrorMessage(error as HttpErrorResponse, "Elle n'a pas pu être enregistrée."),
        );
      } finally {
        this.isSaving.set(false);
      }
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
