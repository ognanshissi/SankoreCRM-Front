import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { UsersApiService, WhatsAppApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTitle } from '@talisoft/ui/title';
import { whatsAppActionError } from './whatsapp-labels';

export interface ReassignWhatsAppDrawerData {
  leadId: string;
  conversationId: string;
  currentAgentId: string | null;
}

class ReassignFormModel {
  public agentId!: string;

  public static instantiate(): ReassignFormModel {
    return Object.assign(new ReassignFormModel(), { agentId: '' });
  }
}

/**
 * « Réassigner » (WA-FE-08) : un superviseur confie la conversation à un agent de son équipe. Le
 * serveur refuse un agent hors de l'équipe ; la liste propose les utilisateurs actifs.
 */
@Component({
  selector: 'reassign-whatsapp-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasFormField,
    TasLabel,
    TasHint,
    TasError,
    TasSelect,
    Button,
  ],
  template: `
    <tas-side-drawer width="480px">
      <tas-drawer-title><tas-title>Réassigner la conversation</tas-title></tas-drawer-title>
      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-4">
          <tas-form-field>
            <tas-label>Agent <span class="text-functional-error">*</span></tas-label>
            <tas-select [options]="agents()" placeholder="Choisir un agent" [formField]="formSchema.agentId"></tas-select>
            <tas-hint>
              S’il a déjà la main, la conversation passe à cet agent ; sinon, c’est lui qu’on attend, avec un
              nouveau délai de prise en charge.
            </tas-hint>
            @if (formSchema.agentId().touched() && formSchema.agentId().invalid()) {
              <tas-error>{{ formSchema.agentId().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
        </form>
      </tas-drawer-content>
      <tas-drawer-action>
        <div class="flex justify-end gap-3">
          <button tas-outlined-button type="button" (click)="close()">Annuler</button>
          <button tas-raised-button color="primary" type="button"
                  [disabled]="formSchema().invalid() || formSchema().submitting()"
                  [isLoading]="formSchema().submitting()"
                  (click)="save()">Réassigner</button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ReassignWhatsAppDrawer {
  private readonly _api = inject(WhatsAppApiService);
  private readonly _users = inject(UsersApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _data = inject<ReassignWhatsAppDrawerData>(DIALOG_DATA);

  public readonly agents = signal<{ label: string; value: string }[]>([]);

  public model = signal(ReassignFormModel.instantiate());
  public formSchema = form(this.model, (schema) => {
    required(schema.agentId, { message: 'Choisissez un agent' });
  });

  constructor() {
    this._users.listUsers('Active', undefined, undefined, 1, 500).pipe(catchError(() => EMPTY)).subscribe((page) => {
      this.agents.set((page.items ?? [])
        .filter((u) => u.id && u.id !== this._data.currentAgentId)
        .map((u) => ({ label: u.fullName || u.email || 'Utilisateur', value: u.id! }))
        .sort((a, b) => a.label.localeCompare(b.label, 'fr')));
    });
  }

  public save(): void {
    submit(this.formSchema, async (field) => {
      const done = await firstValueFrom(
        this._api.reassignLeadWhatsApp(this._data.leadId, this._data.conversationId, { agentId: field().value().agentId }).pipe(
          map(() => true),
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error('Réassignation impossible', whatsAppActionError(error));
            return EMPTY;
          }),
        ),
        { defaultValue: false },
      );
      if (!done) return;
      this._snackbar.success('Conversation réassignée', 'L’agent est prévenu dans sa cloche.');
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
