import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { form, FormField, FormRoot, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, forkJoin } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { TasIcon } from '@talisoft/ui/icon';
import { UsersApiService, AgenciesApiService, AuthApiService, UserDto, AgencyDto } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TimeagoPipe } from '@talisoft/ui/timeago';

class EditUserFormModel {
  public fullName!: string;
  public agencyId!: string;

  public static fromUser(user: UserDto): EditUserFormModel {
    const m = new EditUserFormModel();
    m.fullName = user.fullName ?? '';
    m.agencyId = user.agencyId ?? '';
    return m;
  }
}

@Component({
  selector: 'user-informations',
  imports: [
    TasCard,
    Button,
    TasFormField,
    TasLabel,
    TasInput,
    TasSelect,
    TasSpinner,
    TasTag,
    TasIcon,
    FormRoot,
    FormField,
    TimeagoPipe,
  ],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else if (user()) {
      <div class="pb-6 flex flex-col gap-4">
        <!-- Read-only metadata strip -->
        <tas-card>
          <div class="p-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <p class="text-xs text-slate-400 mb-1">Adresse e-mail</p>
              <p class="text-sm font-medium text-slate-800 truncate">
                {{ user()!.email ?? '—' }}
              </p>
            </div>
            <div>
              <p class="text-xs text-slate-400 mb-1">Type de compte</p>
              <p class="text-sm font-medium text-slate-800">
                {{ user()!.accountType ?? '—' }}
              </p>
            </div>
            <div>
              <p class="text-xs text-slate-400 mb-1">Dernière connexion</p>
              <p class="text-sm font-medium text-slate-800">
                {{
                  user()!.lastLoginAt
                    ? ($any(user()!.lastLoginAt) | dateTimeAgo)
                    : 'Jamais'
                }}
              </p>
            </div>
            <div>
              <p class="text-xs text-slate-400 mb-1">Double authentification</p>
              <tas-tag [severity]="user()!.mfaEnabled ? 'success' : 'neutral'">
                {{ user()!.mfaEnabled ? 'Activée' : 'Désactivée' }}
              </tas-tag>
            </div>
          </div>
        </tas-card>

        <!-- Edit form -->
        <tas-card>
          <div class="p-4 flex flex-col gap-4">
            <p class="text-sm font-semibold text-slate-700">
              Modifier les informations
            </p>
            <form [formRoot]="formSchema" class="grid grid-cols-2 gap-4">
              <tas-form-field>
                <tas-label>Nom complet</tas-label>
                <input
                  tasInput
                  type="text"
                  placeholder="ex: Amadou Diallo"
                  [formField]="formSchema.fullName"
                />
              </tas-form-field>

              <tas-form-field>
                <tas-label>Agence</tas-label>
                <tas-select
                  [options]="agencyOptions()"
                  placeholder="Sélectionnez une agence"
                  [formField]="formSchema.agencyId"
                ></tas-select>
              </tas-form-field>
            </form>
            <div class="flex justify-end">
              <button
                tas-raised-button
                color="primary"
                type="button"
                [disabled]="formSchema().submitting()"
                [isLoading]="formSchema().submitting()"
                (click)="save()"
              >
                <tas-icon iconName="feather:save" iconSize="sm"></tas-icon>
                Enregistrer
              </button>
            </div>
          </div>
        </tas-card>

        <!-- Security actions -->
        <tas-card>
          <div class="divide-y divide-gray-100">
            <!-- Resend activation (pending only) -->
            <div class="p-4 flex items-start justify-between gap-4">
              <div class="flex items-start gap-3">
                <div
                  class="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center shrink-0 mt-0.5"
                >
                  <tas-icon
                    iconName="feather:mail"
                    class="text-amber-500"
                    style="font-size:14px"
                  ></tas-icon>
                </div>
                <div>
                  <p class="text-sm font-medium text-slate-700">
                    Renvoyer l'e-mail d'activation
                  </p>
                  <p class="text-xs text-slate-400 mt-0.5">
                    Envoie à nouveau le lien d'activation du compte. Disponible
                    uniquement si le compte est en attente.
                  </p>
                </div>
              </div>
              <button
                tas-outlined-button
                color="primary"
                type="button"
                [disabled]="
                  user()!.status !== 'PendingActivation' || isSendingEmail()
                "
                [isLoading]="isSendingEmail()"
                (click)="sendActivation()"
                class="shrink-0"
              >
                <tas-icon iconName="feather:send" iconSize="sm"></tas-icon>
                Renvoyer
              </button>
            </div>

            <!-- Send reset password link (active only) -->
            <div class="p-4 flex items-start justify-between gap-4">
              <div class="flex items-start gap-3">
                <div
                  class="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center shrink-0 mt-0.5"
                >
                  <tas-icon
                    iconName="feather:key"
                    class="text-blue-400"
                    style="font-size:14px"
                  ></tas-icon>
                </div>
                <div>
                  <p class="text-sm font-medium text-slate-700">
                    Envoyer un lien de réinitialisation
                  </p>
                  <p class="text-xs text-slate-400 mt-0.5">
                    Envoie un e-mail permettant à l'utilisateur de choisir un
                    nouveau mot de passe. Disponible uniquement si le compte est
                    actif.
                  </p>
                </div>
              </div>
              <button
                tas-outlined-button
                color="primary"
                type="button"
                [isLoading]="isSendingPasswordReset()"
                [disabled]="
                  user()!.status !== 'Active' || isSendingPasswordReset()
                "
                (click)="sendPasswordReset()"
                class="shrink-0"
              >
                <tas-icon iconName="feather:send" iconSize="sm"></tas-icon>
                Envoyer
              </button>
            </div>
          </div>
        </tas-card>
      </div>
    }
  `,
})
export class UserInformationsPage {
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _authApiService = inject(AuthApiService);
  private readonly _snackbarService = inject(SnackbarService);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public isSendingEmail = signal(false);
  public isSendingPasswordReset = signal(false);
  public user = signal<UserDto | null>(null);
  public agencies = signal<AgencyDto[]>([]);

  public agencyOptions = computed(() =>
    this.agencies().map((a) => ({ label: a.name ?? '', value: a.id ?? '' })),
  );

  public formModel = signal(EditUserFormModel.fromUser({} as UserDto));
  public formSchema = form(this.formModel, () => {});

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      forkJoin({
        user: this._usersApiService.getUser(this.id()),
        agencies: this._agenciesApiService.listAgencies(false, 1, 0),
      }).subscribe({
        next: ({ user, agencies }) => {
          this.user.set(user);
          this.agencies.set(agencies.items ?? []);
          this.formModel.set(EditUserFormModel.fromUser(user));
          this.isLoading.set(false);
        },
        error: () => {
          this._snackbarService.error(
            'Erreur',
            "Impossible de charger l'utilisateur.",
          );
          this.isLoading.set(false);
        },
      });
    });
  }

  public sendActivation(): void {
    const email = this.user()?.email;
    if (!email) return;
    this.isSendingEmail.set(true);
    this._authApiService
      .forgotPassword({ email })
      .pipe(
        catchError(() => {
          this._snackbarService.error(
            'Erreur',
            "Impossible d'envoyer l'e-mail d'activation.",
          );
          this.isSendingEmail.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._snackbarService.success('Succès', "E-mail d'activation envoyé.");
        this.isSendingEmail.set(false);
      });
  }

  public sendPasswordReset(): void {
    const email = this.user()?.email;
    if (!email) return;
    this.isSendingPasswordReset.set(true);
    this._authApiService
      .forgotPassword({ email })
      .pipe(
        catchError(() => {
          this._snackbarService.error(
            'Erreur',
            "Impossible d'envoyer le lien de réinitialisation.",
          );
          this.isSendingPasswordReset.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._snackbarService.success(
          'Succès',
          'Lien de réinitialisation envoyé.',
        );
        this.isSendingPasswordReset.set(false);
      });
  }

  public save(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      await firstValueFrom(
        this._usersApiService
          .updateUser(this.id(), {
            fullName: value.fullName || null,
            agencyId: value.agencyId || null,
          })
          .pipe(
            catchError(() => {
              this._snackbarService.error(
                'Erreur',
                'Impossible de mettre à jour les informations.',
              );
              return EMPTY;
            }),
          ),
      );
      this._snackbarService.success('Succès', 'Informations mises à jour.');
      this.user.update((u) =>
        u ? { ...u, fullName: value.fullName, agencyId: value.agencyId } : u,
      );
    });
  }
}

export default UserInformationsPage;
