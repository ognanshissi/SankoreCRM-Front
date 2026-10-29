import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, submit } from '@angular/forms/signals';
import { catchError, firstValueFrom, map, of } from 'rxjs';
import { ConnectedMailboxApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTitle } from '@talisoft/ui/title';
import { MailAccountsStore } from './mail-accounts.store';
import { MailEditor } from './mail-editor';

export interface MailSignatureDrawerData {
  accountId: string;
  /** L'adresse de la boîte, pour le titre. */
  email: string;
  signature: string | null;
}

class SignatureFormModel {
  public signature = '';
}

/**
 * La signature d'une boîte : ajoutée sous chaque nouveau message et chaque réponse qui en part,
 * modifiable avant l'envoi. Ouvert depuis Mon compte et depuis la barre d'un e-mail en cours.
 * Rend la signature enregistrée (`null` : supprimée), ou `undefined` si l'on a fermé.
 */
@Component({
  selector: 'mail-signature-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRoot, FormField, Button, TasIcon, TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle, MailEditor],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Signature</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-3">
          <p class="text-sm text-slate-600">
            Ajoutée sous vos nouveaux messages et vos réponses envoyés depuis <span class="font-semibold text-slate-900">{{ data.email }}</span>.
            Vous pouvez la modifier ou l’effacer dans chaque e-mail avant de l’envoyer.
          </p>
          <div class="rounded-xl border border-slate-200 [--mail-editor-min:10rem] [--mail-editor-max:24rem]">
            <mail-editor [formField]="formSchema.signature" placeholder="Awa Koné — Conseillère, Agence du Plateau — +225 07 00 00 00 00"></mail-editor>
          </div>
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        @if (data.signature) {
          <button tas-text-button type="button" class="me-auto text-functional-error" [disabled]="formSchema().submitting()" (click)="save(true)">
            <tas-icon iconName="feather:trash-2" iconClass="!size-3.5" class="me-1.5"></tas-icon>Supprimer la signature
          </button>
        }
        <button tas-outlined-button type="button" (click)="close()">Annuler</button>
        <button tas-raised-button color="primary" type="button" [disabled]="formSchema().submitting()" [isLoading]="formSchema().submitting()" (click)="save(false)">
          Enregistrer
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class MailSignatureDrawer {
  public readonly data: MailSignatureDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<string | null>);
  private readonly _api = inject(ConnectedMailboxApiService);
  private readonly _store = inject(MailAccountsStore);
  private readonly _snackbar = inject(SnackbarService);

  public readonly model = signal(Object.assign(new SignatureFormModel(), { signature: this.data.signature ?? '' }));
  public readonly formSchema = form(this.model);

  public save(remove: boolean): void {
    submit(this.formSchema, async () => {
      const signature = remove ? null : this.model().signature || null;
      const ok = await firstValueFrom(
        this._api.setMailSignature(this.data.accountId, { signature }).pipe(
          map(() => true),
          catchError(() => of(false)),
        ),
      );
      if (!ok) {
        this._snackbar.error('Non enregistrée', 'La signature n’a pas pu être enregistrée (10 000 caractères au plus).');
        return;
      }
      // Le serveur a pu la nettoyer ou la juger vide : on relit pour garder la sienne.
      this._store.load(true);
      this._store.setSignature(this.data.accountId, signature);
      this._snackbar.success(remove ? 'Signature supprimée' : 'Signature enregistrée', '');
      this._dialogRef.close(signature);
    });
  }

  public close(): void {
    this._dialogRef.close(undefined);
  }
}
