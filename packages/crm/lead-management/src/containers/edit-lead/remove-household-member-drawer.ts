import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import {
  form,
  FormField,
  FormRoot,
  maxLength,
  required,
  submit,
} from '@angular/forms/signals';
import { catchError, firstValueFrom, map, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { LeadsApiService } from '@sankore/crm-api';
import { HouseholdMemberView } from '@sankore/crm/common';

export interface RemoveHouseholdMemberDrawerData {
  leadId: string;
  member: HouseholdMemberView;
}

class RemoveHouseholdMemberFormModel {
  public reason!: string;

  public static instantiate(): RemoveHouseholdMemberFormModel {
    const m = new RemoveHouseholdMemberFormModel();
    m.reason = '';
    return m;
  }
}

/**
 * Retrait d'un membre du foyer du lead (BNF-F-03).
 *
 * Un drawer et non `ConfirmDialogService` : le motif est **obligatoire** au
 * cahier des charges, et une boîte de confirmation ne sait pas saisir de texte —
 * elle laisserait partir un retrait sans motif, ou obligerait à inventer un
 * motif par défaut, c'est-à-dire à perdre l'information que la trace existe
 * précisément pour garder.
 *
 * Le retrait est logique : la ligne est conservée côté serveur et reste affichée
 * dans l'historique du foyer. C'est dit à l'agent ici, pour qu'il ne croie pas
 * supprimer une personne.
 */
@Component({
  selector: 'remove-household-member-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasIcon,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <div class="flex items-center gap-2">
          <tas-icon iconName="feather:user-minus" style="font-size:18px"></tas-icon>
          <span>Retirer {{ data.member.displayName }} du foyer</span>
        </div>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (submitError(); as message) {
          <div class="mb-4 p-3 rounded-lg border border-functional-error/40 bg-functional-error/5">
            <p class="text-sm text-functional-error">{{ message }}</p>
          </div>
        }

        <div class="mb-4 p-3 rounded-lg border border-warn/40 bg-warn/5">
          <p class="text-sm text-slate-700">
            {{ data.member.displayName }} ({{ data.member.typeLabel }}) ne fera plus partie du
            foyer de ce lead.
          </p>
          <p class="text-xs text-slate-500 mt-1">
            Le membre n'est pas supprimé : il reste visible dans l'historique du foyer, avec la
            date et le motif du retrait.
          </p>
        </div>

        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <tas-form-field>
            <tas-label>Motif du retrait <span class="text-functional-error">*</span></tas-label>
            <textarea
              tasInput
              rows="3"
              placeholder="Ex. : séparation, enfant devenu majeur, erreur de saisie…"
              [formField]="formSchema.reason"
            ></textarea>
            @if (formSchema.reason().touched() && formSchema.reason().invalid()) {
              <tas-error>{{ formSchema.reason().errors()[0].message }}</tas-error>
            }
            <tas-hint>Le motif est conservé dans l'historique du foyer.</tas-hint>
          </tas-form-field>
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-2">
          <button tas-outlined-button color="primary" type="button" (click)="close()">
            Annuler
          </button>
          <button
            tas-raised-button
            color="warn"
            type="button"
            (click)="handleSubmit()"
            [disabled]="formSchema().invalid() || formSchema().submitting()"
            [isLoading]="formSchema().submitting()"
          >
            Confirmer le retrait
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class RemoveHouseholdMemberDrawer {
  public readonly data: RemoveHouseholdMemberDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly submitError = signal<string | null>(null);

  public model = signal(RemoveHouseholdMemberFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.reason, { message: 'Le motif du retrait est obligatoire' });
    maxLength(schema.reason, 500, {
      message: 'Le motif ne peut pas dépasser 500 caractères',
    });
  });

  public handleSubmit(): void {
    this.submitError.set(null);
    submit(this.formSchema, async (field) => {
      const reason = field().value().reason.trim();

      // `204 No Content` : le corps vaut `null`. On projette sur un marqueur
      // plutôt que de conclure sur `undefined`, et on évite `EMPTY`, qui ferait
      // rejeter `firstValueFrom` au lieu de retourner.
      const outcome = await firstValueFrom(
        this._leadsApi
          .removeLeadHouseholdMember(this.data.leadId, this.data.member.memberId, { reason })
          .pipe(
            map(() => 'ok' as const),
            catchError((error: HttpErrorResponse) => {
              const message = this._errorMessage(error);
              this.submitError.set(message);
              this._snackbar.error('Erreur', message);
              return of('ko' as const);
            }),
          ),
      );

      if (outcome === 'ko') return;

      this._snackbar.success(
        'Membre retiré',
        `${this.data.member.displayName} a été retiré du foyer et reste visible dans l'historique.`,
      );
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private _errorMessage(error: HttpErrorResponse): string {
    const body = error.error as
      | { code?: string; title?: string; detail?: string; errors?: Record<string, string[]> }
      | undefined;

    switch (body?.code) {
      case 'HOUSEHOLD_MEMBER_ALREADY_REMOVED':
        return 'Ce membre a déjà été retiré du foyer.';
      case 'HOUSEHOLD_REMOVAL_REASON_REQUIRED':
        return 'Le motif du retrait est obligatoire.';
      case 'LEAD_CONVERTED':
        return 'Ce lead est converti : son foyer se modifie depuis la fiche client.';
    }
    if (error.status === 403) {
      return "Vous n'avez pas le droit de modifier ce foyer.";
    }
    if (error.status === 404) {
      return "Ce membre n'est plus rattaché au foyer du lead.";
    }
    if (error.status === 409) {
      return 'Le foyer a changé entre-temps : rechargez la fiche avant de retirer ce membre.';
    }
    const firstValidation = body?.errors ? Object.values(body.errors).flat()[0] : undefined;
    return (
      firstValidation ?? body?.detail ?? body?.title ?? 'Impossible de retirer ce membre du foyer.'
    );
  }
}

export default RemoveHouseholdMemberDrawer;
