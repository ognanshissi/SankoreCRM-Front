import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, maxLength, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { TasTitle } from '@talisoft/ui/title';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ComplianceApiService } from '@sankore/crm-api';

export interface RaiseSuspicionAlertDrawerData {
  clientId: string;
}

const FACTS_MAX_LENGTH = 8000;

class RaiseSuspicionAlertFormModel {
  public facts = '';
}

/**
 * Signalement d'un soupçon LBC/FT. Une fois transmis, l'agent n'en revoit rien : seul le
 * responsable conformité le lit et le traite. Rien n'apparaît sur la fiche, la chronologie ou
 * les exports — ne pas ajouter ici de retour visible sur la fiche (obligation de non-divulgation).
 */
@Component({
  selector: 'raise-suspicion-alert-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle,
    Button, TasFormField, TasLabel, TasError, TasHint, TasInput, TasIcon,
    FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <TasTitle class="text-lg">Signaler un soupçon (LBC/FT)</TasTitle>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="mb-5 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="note">
          <tas-icon iconName="feather:lock" class="mt-0.5 shrink-0" style="font-size:15px"></tas-icon>
          <div class="flex flex-col gap-1">
            <p>Ce signalement est transmis <span class="font-semibold">uniquement au responsable conformité</span>.
              Il n'apparaîtra ni sur la fiche ni dans l'historique du client.</p>
            <p><span class="font-semibold">N'en informez pas le client</span> (obligation de non-divulgation).</p>
          </div>
        </div>

        <form [formRoot]="formSchema" class="flex flex-col gap-4">
          <tas-form-field>
            <tas-label>Faits constatés <span class="text-functional-error">*</span></tas-label>
            <textarea tasInput rows="10" [formField]="formSchema.facts"
                      placeholder="Ce qui a éveillé le soupçon : opérations, montants, dates, comportement, documents…"></textarea>
            @if (formSchema.facts().touched() && formSchema.facts().invalid()) {
              <tas-error>{{ formSchema.facts().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>Des faits précis et datés, sans appréciation sur la personne. {{ factsLength() }} / {{ maxLength }}</tas-hint>
            }
          </tas-form-field>
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-2">
          <button tas-outlined-button type="button" (click)="close()">Annuler</button>
          <button tas-raised-button color="primary" type="button" (click)="handleSubmit()"
                  [disabled]="formSchema().invalid() || formSchema().submitting()"
                  [isLoading]="formSchema().submitting()">
            Transmettre
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class RaiseSuspicionAlertDrawer {
  public readonly data: RaiseSuspicionAlertDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _complianceApi = inject(ComplianceApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly maxLength = FACTS_MAX_LENGTH;

  public model = signal(new RaiseSuspicionAlertFormModel());
  public formSchema = form(this.model, (schema) => {
    required(schema.facts, { message: 'Décrivez les faits' });
    maxLength(schema.facts, FACTS_MAX_LENGTH, { message: `${FACTS_MAX_LENGTH} caractères au plus` });
  });

  public readonly factsLength = computed(() => this.formSchema.facts().value().length);

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const facts = field().value().facts.trim();
      if (!facts) return;

      // 202 sans corps : on mappe sur `true` pour distinguer le succès de l'échec avalé.
      const sent = await firstValueFrom(
        this._complianceApi.raiseSuspicionAlert(this.data.clientId, { facts }).pipe(
          map(() => true),
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error('Erreur', this._errorMessage(error));
            return EMPTY;
          }),
        ),
        { defaultValue: false },
      );
      if (!sent) return;

      this._snackbar.success('Transmis au responsable conformité', '');
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private _errorMessage(error: HttpErrorResponse): string {
    // Le droit est lu dans le jeton : accordé après la connexion, il manque jusqu'à la suivante,
    // alors que le menu (lu sur le profil) propose déjà l'action. « Réessayez » n'y changeait rien.
    if (error.status === 403) {
      return 'Votre session ne porte pas le droit de signaler un soupçon. Déconnectez-vous puis reconnectez-vous ; si le refus persiste, demandez ce droit à votre administrateur.';
    }
    switch (error.error?.error) {
      case 'SUSPICION_ALERT_FACTS_REQUIRED':
        return `Décrivez les faits (${FACTS_MAX_LENGTH} caractères au plus).`;
      case 'CLIENT_NOT_FOUND':
        return 'Client introuvable, ou hors de votre périmètre.';
      default:
        return 'Le signalement n’a pas pu être transmis. Réessayez.';
    }
  }
}
