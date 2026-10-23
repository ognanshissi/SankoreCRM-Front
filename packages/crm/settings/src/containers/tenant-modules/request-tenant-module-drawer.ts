import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { TenantModuleDto, TenantModulesApiService } from '@sankore/crm-api';
import { TasTitle } from '@talisoft/ui/title';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { TasError } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { formatModulePrice, moduleErrorCode, moduleErrorMessage } from './tenant-modules.models';

/** `requested` : la demande est partie ; `stale` : le prix a changé, la page doit se recharger. */
export type RequestTenantModuleOutcome = 'requested' | 'stale';

class RequestModuleFormModel {
  public acceptsCost!: boolean;

  public static instantiate(): RequestModuleFormModel {
    const m = new RequestModuleFormModel();
    m.acceptsCost = false;
    return m;
  }
}

/**
 * Demande d'un module payant. Le prix affiché part avec la demande : si la plateforme l'a changé
 * entre-temps, le registre refuse plutôt que d'enregistrer un accord sur un montant que
 * l'administrateur n'a pas vu.
 */
@Component({
  selector: 'request-tenant-module-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle, Button,
    TasCheckbox, TasError, TasIcon, FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <TasTitle class="text-lg">Demander le module « {{ module.label }} »</TasTitle>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <p class="text-sm text-slate-600">{{ module.description }}</p>

          <div class="rounded-lg border border-slate-200 p-4 flex items-baseline justify-between gap-4">
            <span class="text-sm text-slate-500">Coût mensuel</span>
            <span class="text-lg font-semibold text-slate-800 tabular-nums">{{ price }}</span>
          </div>

          <ul class="text-xs text-slate-500 flex flex-col gap-1.5 list-disc pl-4">
            <li>La demande est transmise à l’équipe Sankoré, qui l’autorise ou la refuse.</li>
            <li>Le module s’active dès l’autorisation ; vous pouvez annuler la demande d’ici là.</li>
            <li>Vous pourrez le désactiver à tout moment, sans perte de données.</li>
          </ul>

          <div class="rounded-lg border border-slate-200 p-4">
            <tas-checkbox [formField]="formSchema.acceptsCost">
              J’accepte ce coût de {{ price }} par mois pour mon institution
            </tas-checkbox>
            @if (formSchema.acceptsCost().touched() && formSchema.acceptsCost().invalid()) {
              <tas-error class="mt-1.5 ml-6">{{ formSchema.acceptsCost().errors()[0].message }}</tas-error>
            }
          </div>
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button type="button" (click)="close()">
          <tas-icon iconName="feather:x"></tas-icon> &nbsp; Annuler
        </button>
        <button tas-raised-button color="primary" type="button" (click)="handleSubmit()"
                [disabled]="formSchema().invalid() || formSchema().submitting()"
                [isLoading]="formSchema().submitting()">
          <tas-icon iconName="feather:send"></tas-icon> &nbsp; Envoyer la demande
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class RequestTenantModuleDrawer {
  private readonly _dialogRef = inject(DialogRef<RequestTenantModuleOutcome>);
  private readonly _api = inject(TenantModulesApiService);
  private readonly _snackbar = inject(SnackbarService);
  public readonly module: TenantModuleDto = inject(DIALOG_DATA);

  public readonly price = formatModulePrice(this.module.monthlyPrice, this.module.currency);

  public readonly model = signal(RequestModuleFormModel.instantiate());
  public readonly formSchema = form(this.model, (schema) => {
    validate(schema.acceptsCost, (ctx) =>
      ctx.value() ? null : { kind: 'accept', message: 'Cochez la case pour accepter le coût du module' },
    );
  });

  public handleSubmit(): void {
    submit(this.formSchema, async () => {
      const sent = await firstValueFrom(
        this._api
          .requestTenantModule(this.module.code!, {
            acceptedMonthlyPrice: this.module.monthlyPrice ?? 0,
            acceptedCurrency: this.module.currency ?? null,
          })
          .pipe(
            map(() => true),
            catchError((err) => {
              this._snackbar.error('Demande non envoyée', moduleErrorMessage(err, 'La demande n’a pas pu être envoyée.'));
              if (moduleErrorCode(err) === 'MODULE_PRICE_CHANGED') this._dialogRef.close('stale');
              return EMPTY;
            }),
          ),
        { defaultValue: false },
      );
      if (sent) this._dialogRef.close('requested');
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}
