import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { catchError, EMPTY, finalize, map, of } from 'rxjs';
import { ConnectedMailboxApiService, ScheduledMailDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasIcon } from '@talisoft/ui/icon';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTitle } from '@talisoft/ui/title';
import { MAIL_SEND_ERRORS, scheduleLabel } from './mail-labels';

/**
 * Les e-mails programmés de l'agent : quand ils partiront, à qui, et de quoi les annuler — ou les
 * renvoyer quand ils n'ont pas pu partir (boîte à reconnecter, mot de passe refusé). Rend `true`
 * si la liste a changé.
 */
@Component({
  selector: 'mail-scheduled-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, TasIcon, TasSpinner, TasTable, TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>E-mails programmés</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (isLoading()) {
          <div class="flex justify-center py-12"><tas-spinner size="8" class="text-primary"></tas-spinner></div>
        } @else if (mails().length === 0) {
          <div class="flex flex-col items-center gap-2 py-12 text-center text-slate-500">
            <tas-icon iconName="feather:clock" iconClass="!size-6" class="text-slate-400"></tas-icon>
            <p class="text-sm">Aucun e-mail programmé. Le menu ▾ à côté d’« Envoyer » permet d’en programmer un.</p>
          </div>
        } @else {
          <tas-table [data]="mails()" identifierField="id" [config]="config()" [hasCaption]="false">
            <ng-template #body let-m>
              <tr>
                <td class="w-full max-w-0 !px-0 !py-3">
                  <div class="flex items-start gap-3">
                    <span class="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full"
                          [class]="m.status === 'Failed' ? 'bg-red-50 text-red-600' : 'bg-primary/10 text-primary'" aria-hidden="true">
                      <tas-icon [iconName]="m.status === 'Failed' ? 'feather:alert-triangle' : 'feather:clock'" iconClass="!size-4"></tas-icon>
                    </span>
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm font-semibold text-slate-900">{{ m.subject || '(sans objet)' }}</p>
                      <p class="truncate text-xs text-slate-500">À {{ (m.to ?? []).join(', ') }} · depuis {{ m.accountLabel }}
                        @if (m.attachmentCount) { · {{ m.attachmentCount }} pièce{{ m.attachmentCount > 1 ? 's' : '' }} jointe{{ m.attachmentCount > 1 ? 's' : '' }} }
                      </p>
                      @if (m.status === 'Failed') {
                        <p class="mt-1 text-xs font-medium text-red-700">Pas parti à {{ scheduleLabel(m.sendAt) }} — {{ errorLabel(m.lastError) }}</p>
                      } @else if (m.status === 'Sending') {
                        <p class="mt-1 text-xs font-medium text-primary">Envoi en cours…</p>
                      } @else {
                        <p class="mt-1 text-xs font-medium text-primary">Partira {{ scheduleLabel(m.sendAt) }}</p>
                      }
                    </div>
                    <div class="flex shrink-0 gap-1">
                      @if (m.status === 'Failed') {
                        <button tas-outlined-button color="primary" type="button" [disabled]="busy() === m.id" (click)="retry(m)">Renvoyer</button>
                      }
                      @if (m.status !== 'Sending') {
                        <button tas-text-button type="button" [disabled]="busy() === m.id" (click)="cancel(m)">
                          {{ m.status === 'Failed' ? 'Supprimer' : 'Annuler l’envoi' }}
                        </button>
                      }
                    </div>
                  </div>
                </td>
              </tr>
            </ng-template>
          </tas-table>
        }
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button type="button" (click)="close()">Fermer</button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class MailScheduledDrawer implements OnInit {
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(ConnectedMailboxApiService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly mails = signal<ScheduledMailDto[]>([]);
  public readonly isLoading = signal(true);
  public readonly busy = signal<string | null>(null);
  private _changed = false;

  public readonly config = computed<TableConfig>(() => ({
    property: 'mail-scheduled',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 25, pageSizeOptions: [25, 50], totalElements: this.mails().length },
  }));
  public readonly scheduleLabel = scheduleLabel;

  ngOnInit(): void {
    this.load();
  }

  public load(): void {
    this.isLoading.set(true);
    this._api
      .listMyScheduledMails()
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Les e-mails programmés n’ont pas pu être chargés.');
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((list) => this.mails.set(list ?? []));
  }

  public errorLabel(code: string | null | undefined): string {
    return (code && MAIL_SEND_ERRORS[code]) || 'le fournisseur ne l’a pas accepté.';
  }

  public cancel(mail: ScheduledMailDto): void {
    this._confirm.confirm({
      title: mail.status === 'Failed' ? 'Supprimer cet e-mail ?' : 'Annuler l’envoi ?',
      message: `« ${mail.subject || '(sans objet)'} » ne partira pas. Son texte et ses pièces jointes sont supprimés.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: mail.status === 'Failed' ? 'Supprimer' : 'Annuler l’envoi', theme: 'warn' },
      rejectButtonProps: { label: 'Garder' },
      accept: () => this._run(mail, this._api.cancelScheduledMail(mail.id!), 'Envoi annulé'),
    });
  }

  public retry(mail: ScheduledMailDto): void {
    this._run(mail, this._api.retryScheduledMail(mail.id!), 'Envoi relancé');
  }

  public close(): void {
    this._dialogRef.close(this._changed);
  }

  private _run(mail: ScheduledMailDto, call: ReturnType<ConnectedMailboxApiService['cancelScheduledMail']>, done: string): void {
    this.busy.set(mail.id ?? null);
    call
      .pipe(
        map(() => true),
        catchError(() => of(false)),
        finalize(() => this.busy.set(null)),
      )
      .subscribe((ok) => {
        if (!ok) {
          this._snackbar.error('Non fait', 'L’e-mail est peut-être déjà en cours d’envoi.');
        } else {
          this._snackbar.success(done, '');
          this._changed = true;
        }
        this.load();
      });
  }
}
