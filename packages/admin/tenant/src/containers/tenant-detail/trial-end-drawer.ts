import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TenantsApiService } from '@sankore/crm-admin-api';
import { describeTrialError } from '../trial-signups/trial-signup-referential';

export interface TrialEndDrawerData {
  tenantId: string;
  tenantName: string;
  /** La fin actuelle, ISO ; sert de valeur de départ. */
  trialExpiresAt: string | null;
}

class TrialEndFormModel {
  /** `aaaa-mm-jj`, ce que rend un `<input type="date">`. */
  public end!: string;

  public static from(current: string | null): TrialEndFormModel {
    const m = new TrialEndFormModel();
    m.end = current ? TrialEndFormModel._day(new Date(current)) : '';
    return m;
  }

  private static _day(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

/**
 * Prolonge un essai gratuit (docs/essai-gratuit-socle.md, lot 3). L'essai prend fin le soir du jour
 * choisi, à 23 h 59 heure du poste : choisir « le 31 » veut dire que le client travaille tout le 31.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle, Button,
    TasFormField, TasLabel, TasHint, TasError, TasInput, FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <TasTitle class="text-lg">Prolonger l’essai</TasTitle>
        <p class="text-sm text-slate-500">{{ data.tenantName }}</p>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <tas-form-field>
            <tas-label>Fin de l’essai <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="date" [formField]="formSchema.end" />
            @if (formSchema.end().touched() && formSchema.end().invalid()) {
              <tas-error>{{ formSchema.end().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>L’institution travaille normalement jusqu’au soir de ce jour, puis passe en consultation seule.</tas-hint>
            }
          </tas-form-field>

          @if (serverError()) {
            <p role="alert" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{{ serverError() }}</p>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
        <button tas-raised-button color="primary" type="button" (click)="handleSubmit()"
                [disabled]="formSchema().invalid() || formSchema().submitting()"
                [isLoading]="formSchema().submitting()">
          Enregistrer
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class TrialEndDrawer {
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(TenantsApiService);
  public readonly data = inject<TrialEndDrawerData>(DIALOG_DATA);

  public serverError = signal<string | null>(null);

  public model = signal(TrialEndFormModel.from(this.data.trialExpiresAt));
  public formSchema = form(this.model, (schema) => {
    required(schema.end, { message: 'Choisissez une date' });
    validate(schema.end, ({ value }) =>
      value() && TrialEndDrawer.endOf(value()) <= new Date()
        ? { kind: 'past', message: 'Choisissez une date à venir' }
        : null,
    );
  });

  /** Le soir du jour choisi, heure locale. */
  public static endOf(day: string): Date {
    return new Date(`${day}T23:59:59`);
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      this.serverError.set(null);
      const done = await firstValueFrom(
        this._api
          .setTenantTrialEnd(this.data.tenantId, { trialExpiresAt: TrialEndDrawer.endOf(field().value().end).toISOString() })
          .pipe(
            map(() => true),
            catchError((err) => {
              this.serverError.set(describeTrialError(err, 'La fin de l’essai n’a pas pu être modifiée.'));
              return EMPTY;
            }),
          ),
        { defaultValue: false },
      );
      if (done) this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
