import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { email, form, FormField, FormRoot, pattern, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasIcon } from '@talisoft/ui/icon';
import { ModuleCatalogApiService, TenantProfile, TenantsApiService } from '@sankore/crm-admin-api';

/** Même règle que l'ajout d'un domaine : une origine complète, sans chemin. */
const ORIGIN_PATTERN = /^https?:\/\/[^\s/?#]+\/?$/i;

const MODULE_LABELS: Record<string, string> = {
  BankingMicrofinance: 'Banking - Microfinance',
  Insurance: 'Assurance',
};

class CreateTenantFormModel {
  public name!: string;
  public rootUserEmail!: string;
  public fqdn!: string;
  public trialExpiresAt!: string;
  public profile!: string;

  public static instantiate(): CreateTenantFormModel {
    const m = new CreateTenantFormModel();
    m.name = '';
    m.rootUserEmail = '';
    m.fqdn = '';
    m.trialExpiresAt = '';
    m.profile = '';
    return m;
  }
}

/**
 * Création d'un tenant dans le registre. Le profil choisit les modules payants activés d'emblée,
 * sans demande ; ensuite le tenant les gère comme n'importe quel autre. Le compte racine du CRM
 * n'est pas créé ici : il l'est au déploiement de l'API, ou par `POST users/create-root`.
 */
@Component({
  templateUrl: './create-tenant-drawer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle, Button,
    TasFormField, TasLabel, TasHint, TasError, TasInput, TasDatePicker, TasIcon, FormRoot, FormField,
  ],
})
export class CreateTenantDrawer implements OnInit {
  private readonly _dialogRef = inject(DialogRef<string | null>);
  private readonly _tenantsApi = inject(TenantsApiService);
  private readonly _catalogApi = inject(ModuleCatalogApiService);

  public readonly profiles = signal<TenantProfile[]>([]);
  public readonly profilesError = signal(false);
  public readonly serverError = signal<string | null>(null);
  public readonly today = new Date().toISOString().slice(0, 10);
  // Le validateur refuse aujourd'hui : le calendrier commence donc demain.
  public readonly tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  public readonly model = signal(CreateTenantFormModel.instantiate());
  public readonly formSchema = form(this.model, (schema) => {
    required(schema.name, { message: 'Le nom est obligatoire' });
    required(schema.rootUserEmail, { message: 'L’e-mail du compte racine est obligatoire' });
    email(schema.rootUserEmail, { message: 'Adresse e-mail invalide' });
    required(schema.fqdn, { message: 'L’origine est obligatoire' });
    pattern(schema.fqdn, ORIGIN_PATTERN, {
      message: 'Saisissez une origine complète, schéma compris (https://crm.exemple.com), sans chemin',
    });
    validate(schema.trialExpiresAt, ({ value }) =>
      value() && value() <= this.today
        ? { kind: 'past', message: 'La fin d’essai doit être postérieure à aujourd’hui' }
        : null,
    );
    required(schema.profile, { message: 'Choisissez un profil' });
  });

  public ngOnInit(): void {
    this._catalogApi
      .listTenantProfiles()
      .pipe(
        catchError(() => {
          this.profilesError.set(true);
          return EMPTY;
        }),
      )
      .subscribe((profiles) => this.profiles.set(profiles ?? []));
  }

  public pickProfile(code: string): void {
    this.model.update((m) => ({ ...m, profile: code }));
  }

  public moduleNames(profile: TenantProfile): string {
    const modules = profile.modules ?? [];
    return modules.length === 0 ? 'Aucun module payant' : modules.map((m) => MODULE_LABELS[m] ?? m).join(' + ');
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      this.serverError.set(null);
      const v = field().value();
      const id = await firstValueFrom(
        this._tenantsApi
          .createTenant({
            name: v.name.trim(),
            rootUserEmail: v.rootUserEmail.trim(),
            fqdn: v.fqdn.trim().replace(/\/$/, ''),
            // Fin de la journée choisie, en UTC, comme la fin de validité d'un domaine.
            trialExpiresAt: v.trialExpiresAt ? `${v.trialExpiresAt}T23:59:59Z` : null,
            profile: v.profile,
          })
          .pipe(
            map((created: { id?: string } | null) => created?.id ?? null),
            catchError((err: HttpErrorResponse) => {
              this.serverError.set(this._describe(err));
              return EMPTY;
            }),
          ),
        { defaultValue: null },
      );
      if (id) this._dialogRef.close(id);
    });
  }

  public close(): void {
    this._dialogRef.close(null);
  }

  private _describe(err: HttpErrorResponse): string {
    if (err.status === 0) return 'Le serveur d’administration est injoignable.';
    switch (err.error?.error) {
      case 'TENANT_FQDN_TAKEN':
        return 'Cette origine appartient déjà à un autre tenant.';
      case 'PROFILE_UNKNOWN':
        return 'Ce profil n’existe plus. Rechargez la page.';
      default:
        return err.error?.detail ?? err.error?.title ?? 'Le tenant n’a pas pu être créé.';
    }
  }
}

export default CreateTenantDrawer;
