import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { form, FormField, FormRoot, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, forkJoin } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { UsersApiService, AgenciesApiService, UserDto, AgencyDto } from '@sankore/crm-api';
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
    NgClass,
    TasCard,
    Button,
    TasFormField,
    TasLabel,
    TasInput,
    TasSelect,
    TasSpinner,
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
        <!-- Read-only info -->
        <tas-card>
          <div class="p-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p
                class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1"
              >
                Email
              </p>
              <p class="font-medium text-slate-800">
                {{ user()!.email ?? '—' }}
              </p>
            </div>
            <div>
              <p
                class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1"
              >
                Type de compte
              </p>
              <p class="font-medium text-slate-800">
                {{ user()!.accountType ?? '—' }}
              </p>
            </div>
            <div>
              <p
                class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1"
              >
                Dernière connexion
              </p>
              <p class="font-medium text-slate-800">
                {{ $any(user()!.lastLoginAt) | dateTimeAgo }}
              </p>
            </div>
            <div>
              <p
                class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1"
              >
                MFA
              </p>
              <span
                class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                [ngClass]="{
                  'bg-green-100 text-green-700': user()!.mfaEnabled,
                  'bg-slate-100 text-slate-500': !user()!.mfaEnabled,
                }"
              >
                {{ user()!.mfaEnabled ? 'Activé' : 'Désactivé' }}
              </span>
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
                Enregistrer
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
  private readonly _snackbarService = inject(SnackbarService);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
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
