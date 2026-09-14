import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, forkJoin } from 'rxjs';
import { TasTitle } from '@talisoft/ui/title';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasMultiSelect } from '@talisoft/ui/multi-select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { UsersApiService, AgenciesApiService, RolesApiService, ProductsApiService } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';

const LANGUAGE_OPTIONS = [
  { label: 'Français', value: 'fr' },
  { label: 'English', value: 'en' },
  { label: 'العربية', value: 'ar' },
  { label: 'Wolof', value: 'wo' },
];

class CreateUserFormModel {
  public firstName!: string;
  public lastName!: string;
  public email!: string;
  public defaultLanguage!: string;
  public agencyId!: string;
  public roleId!: string;

  public static instantiate(): CreateUserFormModel {
    const m = new CreateUserFormModel();
    m.firstName = '';
    m.lastName = '';
    m.email = '';
    m.defaultLanguage = 'fr';
    m.agencyId = '';
    m.roleId = '';
    return m;
  }
}

@Component({
  selector: 'create-user',
  templateUrl: './create-user.html',
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
    TasError,
    TasInput,
    TasSelect,
    TasMultiSelect,
    TasSpinner,
    FormsModule,
    FormRoot,
    FormField,
  ],
})
export class CreateUserComponent {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _rolesApiService = inject(RolesApiService);
  private readonly _productsApiService = inject(ProductsApiService);
  private readonly _snackbarService = inject(SnackbarService);

  public isLoadingOptions = signal(true);
  public agencyOptions = signal<{ label: string; value: string }[]>([]);
  public roleOptions = signal<{ label: string; value: string }[]>([]);
  public specialtyOptions = signal<{ label: string; value: string }[]>([]);
  public selectedSpecialties = signal<string[]>([]);
  public selectedSpokenLanguages = signal<string[]>([]);

  public model = signal(CreateUserFormModel.instantiate());

  public readonly languageOptions = LANGUAGE_OPTIONS;

  public formSchema = form(this.model, (schema) => {
    required(schema.firstName, { message: 'Le nom complet est obligatoire' });
    required(schema.email, { message: "L'adresse e-mail est obligatoire" });
    required(schema.defaultLanguage, { message: 'La langue par défaut est obligatoire' });
  });

  constructor() {
    forkJoin({
      agencies: this._agenciesApiService.listAgencies(false, 1, 0),
      roles: this._rolesApiService.listRoles(),
      products: this._productsApiService.listProducts(),
    }).subscribe({
      next: ({ agencies, roles, products }) => {
        this.agencyOptions.set(
          (agencies.items ?? []).map((a) => ({ label: a.name ?? '', value: a.id ?? '' }))
        );
        this.roleOptions.set(
          (roles ?? []).map((r) => ({ label: r.label ?? r.name ?? '', value: r.id ?? '' }))
        );
        this.specialtyOptions.set(
          (products ?? []).map((p) => ({ label: p.name ?? p.code ?? '', value: p.code ?? '' }))
        );
        this.isLoadingOptions.set(false);
      },
      error: () => this.isLoadingOptions.set(false),
    });
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const result = await firstValueFrom(
        this._usersApiService
          .createUser({
            firstName: value.firstName,
            lastName: value.lastName,
            email: value.email,
            defaultLanguage: value.defaultLanguage,
            agencyId: value.agencyId || undefined,
            roleId: value.roleId || undefined,
            specialties: this.selectedSpecialties().length ? this.selectedSpecialties() : [],
            spokenLanguages: this.selectedSpokenLanguages().length ? this.selectedSpokenLanguages() : [],
          })
          .pipe(
            catchError(() => {
              this._snackbarService.error('Erreur', "Impossible de créer l'utilisateur.");
              return EMPTY;
            }),
          ),
      );

      this._snackbarService.success('Succès', 'Utilisateur créé. Un e-mail d\'activation lui a été envoyé.');
      this._dialogRef.close(result ?? true);
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}
