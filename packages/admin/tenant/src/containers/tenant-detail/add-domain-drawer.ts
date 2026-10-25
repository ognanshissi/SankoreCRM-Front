import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, pattern, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TenantDomainsApiService } from '@sankore/crm-admin-api';

export interface AddDomainDrawerData {
  tenantId: string;
  tenantName: string;
}

/**
 * Même règle que le serveur (`TenantFqdn.IsOrigin`) : schéma http(s), hôte, port facultatif, rien
 * d'autre. Le navigateur envoie `location.origin`, donc un hôte nu ne serait jamais reconnu.
 */
const ORIGIN_PATTERN = /^https?:\/\/[^\s/?#]+\/?$/i;

class AddDomainFormModel {
  public fqdn!: string;
  public validTo!: string;

  public static instantiate(): AddDomainFormModel {
    const m = new AddDomainFormModel();
    m.fqdn = '';
    m.validTo = '';
    return m;
  }
}

@Component({
  templateUrl: './add-domain-drawer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
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
    TasDatePicker,
    FormRoot,
    FormField,
  ],
})
export class AddDomainDrawer {
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _domainsApi = inject(TenantDomainsApiService);
  public readonly data = inject<AddDomainDrawerData>(DIALOG_DATA);

  /** Refus du serveur (doublon, adresse principale d'un autre tenant) : affiché sur place. */
  public serverError = signal<string | null>(null);
  public readonly today = new Date().toISOString().slice(0, 10);
  // Le validateur refuse aujourd'hui : le calendrier commence donc demain.
  public readonly tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  public model = signal(AddDomainFormModel.instantiate());
  public formSchema = form(this.model, (schema) => {
    required(schema.fqdn, { message: 'L’origine est obligatoire' });
    pattern(schema.fqdn, ORIGIN_PATTERN, {
      message: 'Saisissez une origine complète, schéma compris (https://crm.exemple.com), sans chemin',
    });
    validate(schema.validTo, ({ value }) =>
      value() && value() <= this.today
        ? { kind: 'past', message: 'La fin de validité doit être postérieure à aujourd’hui' }
        : null,
    );
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      this.serverError.set(null);
      const value = field().value();
      const created = await firstValueFrom(
        this._domainsApi
          .createTenantDomain({
            tenantId: this.data.tenantId,
            fqdn: value.fqdn.trim(),
            // Toujours secondaire : le domaine principal reflète `tenants.fqdn`, et le changer
            // déplacerait l'accès du tenant — ce n'est pas un ajout.
            isPrimary: false,
            // Fin de la journée choisie, en UTC : la borne est exclusive côté serveur.
            validTo: value.validTo ? `${value.validTo}T23:59:59Z` : null,
          })
          .pipe(
            catchError((err: HttpErrorResponse) => {
              this.serverError.set(
                err.status === 0
                  ? 'Le serveur d’administration est injoignable.'
                  : (err.error?.detail ?? 'Le domaine n’a pas pu être ajouté.'),
              );
              return EMPTY;
            }),
          ),
        { defaultValue: null },
      );
      if (created) this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}

export default AddDomainDrawer;
