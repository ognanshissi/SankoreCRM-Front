import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, maxLength, submit } from '@angular/forms/signals';
import { catchError, firstValueFrom, of } from 'rxjs';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { LoginHistoryDto, UsersApiService } from '@sankore/crm-api';
import { describeLoginOutcome, describeDevice } from './security-labels';

class ReportLoginFormModel {
  public loginId!: string;
  public comment!: string;

  public static instantiate(loginId: string): ReportLoginFormModel {
    const m = new ReportLoginFormModel();
    m.loginId = loginId;
    m.comment = '';
    return m;
  }
}

/** Données du tiroir : la ligne cliquée, s'il y en a une, est présélectionnée. */
export interface ReportLoginDrawerData {
  loginId?: string;
}

/**
 * Signaler une connexion. Le choix de la ligne est facultatif — l'utilisateur peut avoir un doute
 * sans savoir laquelle — mais il aide le superviseur à enquêter, d'où la liste des dernières.
 */
@Component({
  selector: 'report-login-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, Button, TasError,
    TasFormField, TasLabel, TasInput, TasSpinner, FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <p class="text-base font-semibold text-slate-800">Signaler une connexion</p>
        <p class="text-xs text-slate-400 mt-0.5">Une connexion ne vient pas de vous ? Nous coupons l'accès tout de suite.</p>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <div class="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
            <p class="font-semibold">Ce qui va se passer</p>
            <ul class="list-disc pl-5 mt-1 space-y-0.5">
              <li>Toutes vos autres sessions sont fermées immédiatement.</li>
              <li>Votre superviseur est prévenu avec le détail de la connexion.</li>
              <li>Changez ensuite votre mot de passe depuis cet onglet.</li>
            </ul>
          </div>

          <fieldset>
            <legend class="text-sm font-medium text-slate-700 mb-2">Quelle connexion ? <span class="text-slate-400 font-normal">(facultatif)</span></legend>
            @if (isLoading()) {
              <div class="flex justify-center py-6"><tas-spinner size="6" class="text-primary"></tas-spinner></div>
            } @else {
              <div class="flex flex-col gap-2" role="radiogroup">
                <label class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer"
                  [class.border-primary]="model().loginId === ''" [class.border-slate-200]="model().loginId !== ''">
                  <input type="radio" name="login" value="" [checked]="model().loginId === ''" (change)="pick('')" />
                  <span class="text-sm text-slate-700">Je ne sais pas laquelle</span>
                </label>
                @for (login of logins(); track login.id) {
                  <label class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer"
                    [class.border-primary]="model().loginId === login.id" [class.border-slate-200]="model().loginId !== login.id">
                    <input type="radio" name="login" [value]="login.id" [checked]="model().loginId === login.id" (change)="pick(login.id!)" />
                    <span class="flex-1 min-w-0">
                      <span class="block text-sm text-slate-800 tabular-nums">{{ login.occuredAt | date: 'dd/MM/yyyy HH:mm' }} · {{ outcomeLabel(login) }}</span>
                      <span class="block text-xs text-slate-500 truncate">{{ deviceLabel(login) }}@if (login.ipAddress) { · {{ login.ipAddress }} }</span>
                    </span>
                  </label>
                }
              </div>
            }
          </fieldset>

          <tas-form-field>
            <tas-label>Commentaire pour votre superviseur</tas-label>
            <textarea tasInput rows="3" placeholder="Ex. : je n'étais pas connecté à cette heure-là" [formField]="formSchema.comment"></textarea>
            @if (formSchema.comment().invalid()) {
              <tas-error>{{ formSchema.comment().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button type="button" (click)="close()">Annuler</button>
        <button tas-raised-button color="warn" type="button"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
          (click)="handleSubmit()">
          Signaler et fermer mes autres sessions
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ReportLoginDrawer implements OnInit {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _data = inject<ReportLoginDrawerData | null>(DIALOG_DATA, { optional: true });
  private readonly _usersApi = inject(UsersApiService);
  private readonly _snackbar = inject(SnackbarService);

  public isLoading = signal(true);
  public logins = signal<LoginHistoryDto[]>([]);
  public model = signal(ReportLoginFormModel.instantiate(this._data?.loginId ?? ''));
  public formSchema = form(this.model, (schema) => {
    maxLength(schema.comment, 1000, { message: '1000 caractères au maximum' });
  });

  public readonly outcomeLabel = (login: LoginHistoryDto) => describeLoginOutcome(login.outcome).label;
  public readonly deviceLabel = describeDevice;

  ngOnInit(): void {
    this._usersApi.getMyLoginHistory(1, 10).pipe(catchError(() => of([]))).subscribe((logins) => {
      this.logins.set(logins);
      this.isLoading.set(false);
    });
  }

  public pick(loginId: string): void {
    this.model.update((m) => ({ ...m, loginId }));
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const result = await firstValueFrom(
        this._usersApi.reportSuspiciousLogin({
          loginId: value.loginId || null,
          comment: value.comment.trim() || null,
        }).pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Signalement impossible', err.error?.detail ?? 'Le signalement n’a pas pu être envoyé.');
            return of(null);
          }),
        ),
      );
      if (!result) return;

      const ended = result.endedSessions ?? 0;
      this._snackbar.success(
        'Connexion signalée',
        ended > 0
          ? `${ended} autre(s) session(s) fermée(s). Changez maintenant votre mot de passe.`
          : 'Aucune autre session n’était ouverte. Changez maintenant votre mot de passe.',
      );
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
