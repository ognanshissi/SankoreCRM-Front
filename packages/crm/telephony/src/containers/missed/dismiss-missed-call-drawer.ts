import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormField, FormRoot, form, required, submit } from '@angular/forms/signals';
import { catchError, firstValueFrom, map, of } from 'rxjs';
import { TelephonyApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTitle } from '@talisoft/ui/title';
import {
  DISMISS_NOTICE,
  DISMISS_REASON_HINT,
  attemptCountLabel,
  missedErrorMessage,
} from './missed-presentation';

export interface DismissMissedCallDrawerData {
  callId: string;
  attemptCount: number | null | undefined;
  /** Qui a appelé, tel que le contexte l'a résolu — ou la phrase qui en tient lieu. */
  contextLabel: string;
}

export interface DismissMissedCallDrawerResult {
  callId: string;
}

class DismissFormModel {
  public reason!: string;

  public static instantiate(): DismissFormModel {
    const model = new DismissFormModel();
    model.reason = '';
    return model;
  }
}

/**
 * Clôture d'un appel manqué sans rappel (TEL-F-09, action « Clôturer »).
 *
 * Le motif est OBLIGATOIRE côté serveur et il est rangé au journal d'audit et non sur
 * l'appel : une colonne ne garderait que le dernier motif, alors qu'un relecteur a besoin
 * de la suite. Un formulaire qui laisserait passer un motif vide ferait donc un
 * aller-retour pour un 422 que l'on peut éviter ici.
 *
 * La clôture est aussi là pour ne PAS détourner la qualification : inventer une issue
 * « rien à signaler » la ferait compter dans les indicateurs de contact de
 * l'établissement.
 */
@Component({
  selector: 'lib-dismiss-missed-call-drawer',
  templateUrl: './dismiss-missed-call-drawer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    Button,
    TasFormField,
    TasLabel,
    TasHint,
    TasError,
    TasInput,
  ],
})
export class DismissMissedCallDrawer {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _telephonyApi = inject(TelephonyApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly data = inject<DismissMissedCallDrawerData>(DIALOG_DATA);

  public readonly notice = DISMISS_NOTICE;
  public readonly reasonHint = DISMISS_REASON_HINT;
  public readonly attemptLabel = attemptCountLabel(this.data.attemptCount);

  public model = signal(DismissFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.reason, {
      message: "Le motif est obligatoire : il est conservé au journal d'audit",
    });
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const dismissed = await firstValueFrom(
        this._telephonyApi
          .dismissTelephonyMissedCall(this.data.callId, { reason: value.reason.trim() })
          .pipe(
            // 204 sans corps : `map` donne au succès une valeur lisible, et `of(false)`
            // évite qu'un refus fasse rejeter `firstValueFrom` au lieu de s'afficher.
            map(() => true),
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error(
                'Clôture refusée',
                missedErrorMessage(error, "La clôture n'a pas abouti."),
              );
              return of(false);
            }),
          ),
      );

      if (!dismissed) return;

      this._dialogRef.close({
        callId: this.data.callId,
      } satisfies DismissMissedCallDrawerResult);
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}
