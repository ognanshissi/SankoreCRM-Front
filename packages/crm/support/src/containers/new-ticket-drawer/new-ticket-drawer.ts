import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, maxLength, required, submit } from '@angular/forms/signals';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import {
  OpenSupportTicketCommandCategoryEnum,
  OpenSupportTicketCommandPriorityEnum,
  SupportApiService,
} from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTitle } from '@talisoft/ui/title';
import { CATEGORY_OPTIONS, PRIORITY_OPTIONS, supportErrorMessage } from '../../support-meta';

export interface NewTicketDrawerData {
  /** L'écran d'où vient l'utilisateur, pour que le support le reproduise. */
  pageUrl?: string | null;
}

class NewTicketFormModel {
  public subject!: string;
  public category!: string;
  public priority!: string;
  public body!: string;

  public static instantiate(): NewTicketFormModel {
    const m = new NewTicketFormModel();
    m.subject = '';
    m.category = OpenSupportTicketCommandCategoryEnum.Question;
    m.priority = OpenSupportTicketCommandPriorityEnum.Normal;
    m.body = '';
    return m;
  }
}

/** Nouveau ticket à l'équipe Sankoré. Ferme sur l'id du ticket créé. */
@Component({
  selector: 'new-ticket-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './new-ticket-drawer.html',
  imports: [
    FormRoot, FormField,
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle,
    TasFormField, TasLabel, TasHint, TasError, TasInput, TasSelect, TasIcon, Button,
  ],
})
export class NewTicketDrawer {
  private readonly _supportApi = inject(SupportApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _dialogRef = inject<DialogRef<string>>(DialogRef);
  private readonly _data = inject<NewTicketDrawerData | null>(DIALOG_DATA, { optional: true });

  public readonly categoryOptions = CATEGORY_OPTIONS;
  public readonly priorityOptions = PRIORITY_OPTIONS;
  public readonly pageUrl = this._data?.pageUrl ?? null;

  public model = signal(NewTicketFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.subject, { message: 'Le sujet est obligatoire' });
    maxLength(schema.subject, 200, { message: '200 caractères au plus' });
    required(schema.body, { message: 'Décrivez votre demande' });
    maxLength(schema.body, 10000, { message: '10 000 caractères au plus' });
  });

  public close(): void {
    this._dialogRef.close();
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const opened = await firstValueFrom(
        this._supportApi
          .openSupportTicket({
            subject: value.subject.trim(),
            category: value.category as OpenSupportTicketCommandCategoryEnum,
            priority: value.priority as OpenSupportTicketCommandPriorityEnum,
            body: value.body.trim(),
            pageUrl: this.pageUrl,
          })
          .pipe(
            catchError((err: HttpErrorResponse) => {
              this._snackbar.error('Ticket non envoyé', supportErrorMessage(err.error?.error));
              return EMPTY;
            }),
          ),
        { defaultValue: null },
      );
      if (opened?.id) {
        this._snackbar.success('Ticket envoyé', `${opened.reference} : l'équipe Sankoré vous répondra ici et par e-mail.`);
        this._dialogRef.close(opened.id);
      }
    });
  }
}
