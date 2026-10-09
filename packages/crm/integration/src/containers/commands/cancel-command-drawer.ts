import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasAlert } from '@talisoft/ui/alert';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasTitle } from '@talisoft/ui/title';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../../data-access/integration-facade.service';
import { commandTypeLabel } from '../../data-access/integration-referential';
import { CANCEL_WARNING, shortId } from './command-presentation';

const MINIMUM_REASON_LENGTH = 10;
const MAXIMUM_REASON_LENGTH = 500;

export interface CancelCommandDrawerData {
  commandId: string;
  commandType: string | null | undefined;
}

export interface CancelCommandDrawerResult {
  commandId: string;
  status: string;
}

class CancelCommandFormModel {
  public reason!: string;

  public static empty(): CancelCommandFormModel {
    const model = new CancelCommandFormModel();
    model.reason = '';
    return model;
  }
}

/**
 * Annulation d'une commande, avec motif (`POST /commands/{id}/cancel`).
 *
 * Le motif est facultatif dans le schéma mais obligatoire ici : l'annulation est
 * définitive et elle est auditée avec son auteur. Une annulation définitive sans motif
 * ne dit pas, six mois plus tard, pourquoi un client n'a jamais été créé côté externe.
 * D'où un drawer et non un `window.prompt` : il y a une mise en garde à lire avant
 * d'écrire, et un motif à relire avant d'envoyer.
 */
@Component({
  selector: 'cancel-command-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    FormRoot,
    Button,
    TasAlert,
    TasError,
    TasFormField,
    TasHint,
    TasLabel,
    TasIcon,
    TasInput,
    TasTitle,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
  ],
  templateUrl: './cancel-command-drawer.html',
})
export class CancelCommandDrawer {
  public readonly data: CancelCommandDrawerData = inject(DIALOG_DATA);

  private readonly _dialogRef = inject(DialogRef<CancelCommandDrawerResult | null>);
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly cancelWarning = CANCEL_WARNING;
  public readonly minimumReasonLength = MINIMUM_REASON_LENGTH;
  public readonly submitError = signal<string | null>(null);

  public readonly commandLabel = commandTypeLabel(this.data.commandType);
  public readonly commandRef = shortId(this.data.commandId);

  public model = signal(CancelCommandFormModel.empty());

  public formSchema = form(this.model, (schema) => {
    validate(schema.reason, (ctx) => {
      const raw = (ctx.value() ?? '').trim();
      if (!raw) {
        return { kind: 'required', message: "Le motif est obligatoire pour une annulation" };
      }
      if (raw.length < MINIMUM_REASON_LENGTH) {
        return {
          kind: 'minLength',
          message: `Expliquez la décision en au moins ${MINIMUM_REASON_LENGTH} caractères`,
        };
      }
      if (raw.length > MAXIMUM_REASON_LENGTH) {
        return {
          kind: 'maxLength',
          message: `Le motif ne peut pas dépasser ${MAXIMUM_REASON_LENGTH} caractères`,
        };
      }
      return null;
    });
  });

  public close(): void {
    this._dialogRef.close(null);
  }

  public handleSubmit(): void {
    this.submitError.set(null);

    submit(this.formSchema, async (field) => {
      const reason = (field()?.value()?.reason ?? '').trim();
      if (!reason) return;

      const result = await firstValueFrom(
        this._facade.cancelCommand(this.data.commandId, reason).pipe(
          catchError((error: HttpErrorResponse) => {
            // 409 = la commande est partie ou a déjà été confirmée par le système
            // externe entre l'ouverture de ce drawer et l'envoi : ce n'est pas une
            // panne, c'est une course perdue, et l'administrateur doit recharger.
            const message =
              error.status === 409
                ? "Cette commande est déjà partie ou a été confirmée par le système externe : elle ne peut plus être annulée. Rechargez la liste."
                : integrationErrorMessage(error, "L'annulation n'a pas abouti.");
            this.submitError.set(message);
            this._snackbar.error('Annulation impossible', message);
            return EMPTY;
          }),
        ),
      );

      if (!result) return;

      this._snackbar.success(
        'Commande annulée',
        'Elle ne sera pas envoyée au système externe. Votre motif est conservé.',
      );
      this._dialogRef.close({
        commandId: result.commandId ?? this.data.commandId,
        status: result.status ?? 'Cancelled',
      });
    });
  }
}
