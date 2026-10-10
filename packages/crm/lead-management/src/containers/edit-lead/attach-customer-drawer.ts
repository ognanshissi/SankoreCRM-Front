import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, firstValueFrom, of } from 'rxjs';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { LeadsApiService } from '@sankore/crm-api';
import { CustomerMatchView } from './customer-match-banner';

export type AttachCustomerMode = 'attach' | 'detach';

export interface AttachCustomerDrawerData {
  leadId: string;
  mode: AttachCustomerMode;
  customer: CustomerMatchView;
  /**
   * `LeadDto.updatedAt` au moment de l'ouverture. Jeton de concurrence du contrat
   * (`expectedUpdatedAt`) : sans lui, deux agents qui rattachent le même lead en
   * parallèle écrasent silencieusement l'un l'autre.
   */
  expectedUpdatedAt: string | null;
}

export type AttachCustomerResult = 'attached' | 'detached';

class AttachCustomerFormModel {
  public reason!: string;

  public static instantiate(): AttachCustomerFormModel {
    const m = new AttachCustomerFormModel();
    m.reason = '';
    return m;
  }
}

/**
 * Rattachement et détachement motivés d'un lead à un client existant (BNF-F-18, dernier
 * critère : « Rattachement ou détachement possible ensuite depuis la fiche lead, avec
 * motif »).
 *
 * Un seul drawer pour les deux sens : le formulaire est le même — un motif obligatoire —
 * et seuls l'appel et les textes changent. Les séparer ferait deux écrans qui divergent
 * sur la gestion du conflit de concurrence, qui est précisément la partie délicate.
 */
@Component({
  selector: 'attach-customer-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasIcon,
    TasTag,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    FormRoot,
    FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title class="text-lg">
          {{ isDetach() ? 'Détacher le client' : 'Rattacher au client' }}
        </tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-5">
          <div class="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="text-sm font-medium text-slate-800 truncate">
                  {{ data.customer.displayName }}
                </p>
                <p class="text-xs text-slate-500 mt-0.5">
                  @if (data.customer.clientNumber) {
                    <span class="tabular-nums">N° {{ data.customer.clientNumber }}</span>
                  }
                  @if (data.customer.agencyLabel) { · {{ data.customer.agencyLabel }} }
                </p>
              </div>
              @if (data.customer.isExact) {
                <tas-tag severity="success">Correspondance exacte</tas-tag>
              } @else {
                <tas-tag severity="warning">Correspondance partielle</tas-tag>
              }
            </div>
            @if (data.customer.matchedOnLabels.length > 0) {
              <p class="text-xs text-slate-400 mt-2">
                Correspond sur : {{ data.customer.matchedOnLabels.join(', ') }}
              </p>
            }
          </div>

          @if (isDetach()) {
            <div class="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <tas-icon
                iconName="feather:alert-triangle"
                class="text-amber-600 shrink-0 mt-0.5"
                style="font-size:14px"
              ></tas-icon>
              <p class="text-xs text-amber-800">
                Le lead redeviendra un prospect autonome : l'identité, le foyer, le statut
                PPE et le statut FATCA ne seront plus lus depuis la fiche client.
              </p>
            </div>
          } @else {
            <div class="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <tas-icon
                iconName="feather:info"
                class="text-slate-400 shrink-0 mt-0.5"
                style="font-size:14px"
              ></tas-icon>
              <p class="text-xs text-slate-500">
                L'identité, le foyer, le statut PPE et le statut FATCA du lead seront
                lus depuis la fiche client. Aucune donnée d'identité n'est ressaisie ici.
              </p>
            </div>

            @for (conflict of data.customer.conflicts; track conflict) {
              <div class="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <tas-icon
                  iconName="feather:alert-triangle"
                  class="text-amber-600 shrink-0 mt-0.5"
                  style="font-size:14px"
                ></tas-icon>
                <p class="text-xs text-amber-800">{{ conflict }}</p>
              </div>
            }
          }

          <form [formRoot]="formSchema" class="flex flex-col gap-5">
            <tas-form-field>
              <tas-label>
                Motif <span class="text-functional-error">*</span>
              </tas-label>
              <textarea
                tasInput
                rows="3"
                [placeholder]="
                  isDetach()
                    ? 'Pourquoi ce lead ne correspond pas à ce client…'
                    : 'Pourquoi ce lead correspond à ce client…'
                "
                [formField]="formSchema.reason"
              ></textarea>
              <tas-hint>Le motif est conservé dans l'historique du lead.</tas-hint>
              @if (formSchema.reason().touched() && formSchema.reason().invalid()) {
                <tas-error>{{ formSchema.reason().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          </form>

          @if (serverError()) {
            <div class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
              <tas-icon
                iconName="feather:alert-circle"
                class="text-red-500 shrink-0 mt-0.5"
                style="font-size:14px"
              ></tas-icon>
              <p class="text-xs text-red-700">{{ serverError() }}</p>
            </div>
          }
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="space-x-4">
          <button tas-outlined-button color="primary" type="button" (click)="close()">
            Annuler
          </button>
          <button
            tas-raised-button
            [color]="isDetach() ? 'warn' : 'primary'"
            type="button"
            [disabled]="formSchema().invalid() || formSchema().submitting()"
            [isLoading]="formSchema().submitting()"
            (click)="handleSubmit()"
          >
            {{ isDetach() ? 'Détacher' : 'Rattacher' }}
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class AttachCustomerDrawer {
  public readonly data: AttachCustomerDrawerData = inject(DIALOG_DATA);

  private readonly _dialogRef = inject(DialogRef<AttachCustomerResult | false>);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly isDetach = computed(() => this.data.mode === 'detach');
  public serverError = signal<string | null>(null);

  public model = signal(AttachCustomerFormModel.instantiate());
  public formSchema = form(this.model, (schema) => {
    required(schema.reason, { message: 'Le motif est obligatoire' });
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      this.serverError.set(null);
      const reason = (field()?.value().reason ?? '').trim();
      const expectedUpdatedAt = this.data.expectedUpdatedAt;

      const call = this.isDetach()
        ? this._leadsApi.detachLeadFromCustomer(this.data.leadId, { reason, expectedUpdatedAt })
        : this._leadsApi.attachLeadToCustomer(this.data.leadId, {
            customerId: this.data.customer.customerId,
            reason,
            expectedUpdatedAt,
          });

      // Drapeau plutôt que la valeur émise : le contrat répond 204 sans corps, donc
      // « a réussi » ne se lit pas dans ce qui arrive — seulement dans l'absence d'erreur.
      let failed = false;
      await firstValueFrom(
        call.pipe(
          catchError((err: HttpErrorResponse) => {
            failed = true;
            this.serverError.set(this._errorMessage(err));
            return of(null);
          }),
        ),
      );

      if (failed) return;

      if (this.isDetach()) {
        this._snackbar.success('Client détaché', 'Le lead redevient un prospect autonome.');
        this._dialogRef.close('detached');
      } else {
        this._snackbar.success(
          'Client rattaché',
          `Le lead est rattaché à ${this.data.customer.displayName}.`,
        );
        this._dialogRef.close('attached');
      }
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  /**
   * Le diagnostic compte ici : un 409 et un 422 demandent deux gestes différents de
   * l'agent, et un message générique les rend indiscernables.
   */
  private _errorMessage(err: HttpErrorResponse): string {
    const detail = err.error?.title ?? err.error?.detail ?? null;
    switch (err.status) {
      case 409:
        return (
          detail ??
          'Le lead a été modifié entre-temps. Rechargez la fiche avant de réessayer.'
        );
      case 422:
        return detail ?? "Ce rattachement n'est pas autorisé pour ce lead.";
      case 404:
        return 'Le lead ou le client est introuvable.';
      case 400:
        return detail ?? 'Requête refusée par le serveur.';
      default:
        return this.isDetach()
          ? 'Impossible de détacher le client, réessayez plus tard.'
          : 'Impossible de rattacher le client, réessayez plus tard.';
    }
  }
}
