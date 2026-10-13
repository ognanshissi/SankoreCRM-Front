import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { disabled, email, form, FormField, FormRoot, pattern, readonly, required, submit } from '@angular/forms/signals';
import { catchError, firstValueFrom, map, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { AgenciesApiService, UpdateUserRequest, UserDto, UsersApiService } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { EditUserState } from './edit-user-state';
import { UserManagerCard, UserManagerChange } from './user-manager-card';

const PHONE_PATTERN = /^\+?[0-9 ().-]*$/;

const STATUS_LABELS: Record<string, string | undefined> = {
  PendingActivation: "En attente d'activation",
  Active: 'Actif',
  Disabled: 'Désactivé',
  Locked: 'Verrouillé',
};

const ACCOUNT_TYPES: Record<string, string | undefined> = {
  Standard: 'Standard',
  System: 'Système',
  Service: 'Service',
};

class IdentityFormModel {
  public firstName!: string;
  public lastName!: string;
  public email!: string;
  public workPhone!: string;
  public agencyId!: string;

  public static fromUser(user: UserDto | null): IdentityFormModel {
    const m = new IdentityFormModel();
    m.firstName = user?.firstName ?? '';
    m.lastName = user?.lastName ?? '';
    m.email = user?.email ?? '';
    m.workPhone = user?.workPhone ?? '';
    m.agencyId = user?.agencyId ?? '';
    return m;
  }
}

@Component({
  selector: 'user-informations',
  imports: [
    DatePipe, RouterLink, Button, TasFormField, TasLabel, TasError, TasHint, TasInput, TasSelect, TasSpinner,
    FormRoot, FormField, TimeagoPipe, UserManagerCard,
  ],
  template: `
    @if (user(); as u) {
      <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-5 items-start">
        <div class="flex flex-col gap-5 min-w-0">
          <!-- Identité -->
          <section class="rounded-2xl bg-white shadow-sm border border-slate-100 p-6">
            <h2 class="text-xl font-bold text-primary">Identité</h2>
            <form [formRoot]="formSchema" class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4 mt-4">
              <tas-form-field>
                <tas-label>Prénom</tas-label>
                <input tasInput type="text" [formField]="formSchema.firstName" />
                @if (formSchema.firstName().touched() && formSchema.firstName().invalid()) {
                  <tas-error>{{ formSchema.firstName().errors()[0].message }}</tas-error>
                }
              </tas-form-field>
              <tas-form-field>
                <tas-label>Nom</tas-label>
                <input tasInput type="text" [formField]="formSchema.lastName" />
                @if (formSchema.lastName().touched() && formSchema.lastName().invalid()) {
                  <tas-error>{{ formSchema.lastName().errors()[0].message }}</tas-error>
                }
              </tas-form-field>

              <tas-form-field>
                <tas-label>Adresse électronique</tas-label>
                <input tasInput type="email" [class.bg-slate-50]="!canEditEmail()" [formField]="formSchema.email" />
                @if (formSchema.email().touched() && formSchema.email().invalid()) {
                  <tas-error>{{ formSchema.email().errors()[0].message }}</tas-error>
                } @else if (isPending()) {
                  <tas-hint>La modifier renvoie une invitation à la nouvelle adresse.</tas-hint>
                } @else {
                  <tas-hint>Modifiable seulement avant l'activation du compte.</tas-hint>
                }
              </tas-form-field>
              <tas-form-field>
                <tas-label>Téléphone professionnel</tas-label>
                <input tasInput type="tel" placeholder="+225 07 00 00 00 00" [formField]="formSchema.workPhone" />
                @if (formSchema.workPhone().touched() && formSchema.workPhone().invalid()) {
                  <tas-error>{{ formSchema.workPhone().errors()[0].message }}</tas-error>
                }
              </tas-form-field>

              <tas-form-field>
                <tas-label>Agence</tas-label>
                <tas-select [options]="agencyOptions()" placeholder="Sélectionnez une agence" [formField]="formSchema.agencyId"></tas-select>
                <tas-hint>Détermine les leads qu'{{ pronoun() }} peut recevoir.</tas-hint>
              </tas-form-field>
              <div>
                <p class="text-sm font-medium text-slate-700 mb-1.5">Matricule</p>
                <div class="flex items-center h-11 px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-600 tabular-nums">{{ u.employeeNumber || '—' }}</div>
                <p class="text-xs text-slate-500 mt-1.5">Attribué automatiquement.</p>
              </div>
            </form>

            @if (canUpdate() && isDirty()) {
              <div class="flex justify-end gap-3 mt-5 pt-4 border-t border-slate-100">
                <button tas-outlined-button type="button" [disabled]="formSchema().submitting()" (click)="cancel()">Annuler</button>
                <button tas-raised-button color="primary" type="button"
                  [disabled]="formSchema().invalid() || formSchema().submitting()" [isLoading]="formSchema().submitting()"
                  (click)="save()">Enregistrer</button>
              </div>
            }
          </section>

          <user-manager-card
            [userId]="u.id!"
            [userFullName]="u.fullName"
            [userSubtitle]="userSubtitle()"
            [reportsToUserId]="u.reportsToUserId"
            [reportsToFullName]="u.reportsToFullName"
            [managerSubtitle]="managerSubtitle()"
            [directReportsCount]="u.directReportsCount ?? 0"
            (managerChanged)="onManagerChanged($event)"
          ></user-manager-card>
        </div>

        <div class="flex flex-col gap-5">
          <!-- Compte -->
          <section class="rounded-2xl bg-white shadow-sm border border-slate-100 p-6">
            <h2 class="text-xl font-bold text-primary">Compte</h2>
            <dl class="mt-3 divide-y divide-slate-100 text-sm">
              <div class="flex justify-between gap-3 py-3">
                <dt class="text-slate-600">Statut</dt>
                <dd class="font-medium text-slate-900 text-right">{{ statusLabel() }}</dd>
              </div>
              <div class="flex justify-between gap-3 py-3">
                <dt class="text-slate-600">Profil</dt>
                <dd class="font-medium text-slate-900">{{ accountType() }}</dd>
              </div>
              <div class="flex justify-between gap-3 py-3">
                <dt class="text-slate-600">Créé le</dt>
                <dd class="text-right">
                  <span class="font-medium text-slate-900">{{ u.createdAt ? (u.createdAt | date: 'd MMM yyyy') : '—' }}</span>
                  @if (u.createdByName) {
                    <span class="block text-xs text-slate-500">par {{ u.createdByName }}</span>
                  }
                </dd>
              </div>
              <div class="flex justify-between gap-3 py-3">
                <dt class="text-slate-600">Dernière connexion</dt>
                <dd class="font-medium text-slate-900">{{ u.lastLoginAt ? (u.lastLoginAt | dateTimeAgo) : 'Jamais' }}</dd>
              </div>
              <div class="flex justify-between items-center gap-3 py-3">
                <dt class="text-slate-600">Double authentification</dt>
                <!-- Aucun second facteur n'est vérifié à la connexion : ne pas l'afficher « exigé ». -->
                <dd><span class="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold" title="La validation en deux étapes n'est pas encore disponible sur la plateforme.">Non disponible</span></dd>
              </div>
            </dl>
          </section>

          <!-- Rôles -->
          <section class="rounded-2xl bg-white shadow-sm border border-slate-100 p-6">
            <h2 class="text-base font-semibold text-slate-900">Rôles</h2>
            <div class="flex flex-wrap gap-2 mt-3">
              @for (role of u.roleLabels ?? []; track role) {
                <span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-800 text-xs font-medium">{{ role }}</span>
              } @empty {
                <span class="text-sm text-slate-500">Aucun rôle</span>
              }
              @if (u.activeAttributionsCount) {
                <span class="px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-700 text-xs">
                  +{{ u.activeAttributionsCount }} attribution{{ u.activeAttributionsCount > 1 ? 's' : '' }} temporaire{{ u.activeAttributionsCount > 1 ? 's' : '' }}
                </span>
              }
            </div>
            <a [routerLink]="['../roles']" class="inline-block mt-4 text-sm font-medium text-primary hover:underline">Gérer les rôles</a>
          </section>
        </div>
      </div>
    } @else {
      <div class="flex justify-center py-24"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
    }
  `,
})
export class UserInformationsPage {
  private readonly _permissions = inject(PermissionsService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _state = inject(EditUserState);

  public readonly canUpdate = this._permissions.can('user:update');
  public readonly user = this._state.user;

  public agencyOptions = signal<{ label: string; value: string }[]>([]);
  public model = signal(IdentityFormModel.fromUser(null));
  public formSchema = form(this.model, (schema) => {
    required(schema.firstName, { message: 'Le prénom est obligatoire' });
    required(schema.lastName, { message: 'Le nom est obligatoire' });
    required(schema.email, { message: "L'adresse est obligatoire" });
    email(schema.email, { message: 'Adresse invalide' });
    pattern(schema.workPhone, PHONE_PATTERN, { message: 'Numéro invalide' });
    required(schema.agencyId, { message: "L'agence est obligatoire" });
    readonly(schema.firstName, () => !this.canUpdate());
    readonly(schema.lastName, () => !this.canUpdate());
    readonly(schema.workPhone, () => !this.canUpdate());
    // L'adresse est l'identifiant de connexion : figée une fois le compte activé (règle serveur).
    readonly(schema.email, () => !this.canUpdate() || this.user()?.status !== 'PendingActivation');
    disabled(schema.agencyId, () => !this.canUpdate());
  });

  public readonly isPending = computed(() => this.user()?.status === 'PendingActivation');
  public readonly canEditEmail = computed(() => this.canUpdate() && this.isPending());
  public readonly statusLabel = computed(() => STATUS_LABELS[this.user()?.status ?? ''] ?? this.user()?.status ?? '—');
  public readonly accountType = computed(() => ACCOUNT_TYPES[this.user()?.accountType ?? ''] ?? this.user()?.accountType ?? '—');
  /** « elle » ou « il » n'est pas déductible d'un prénom : la forme neutre reste juste. */
  public readonly pronoun = computed(() => 'il ou elle');

  public readonly userSubtitle = computed(() =>
    [this.user()?.roleLabels?.[0], this.user()?.agencyName].filter((v) => !!v).join(' · ') || null,
  );
  public readonly managerSubtitle = computed(() =>
    [this.user()?.reportsToRoleLabel, this.user()?.reportsToAgencyName].filter((v) => !!v).join(' · ') || null,
  );

  public readonly isDirty = computed(() => {
    const m = this.model();
    const initial = IdentityFormModel.fromUser(this.user());
    return (Object.keys(initial) as (keyof IdentityFormModel)[]).some((k) => (m[k] ?? '').trim() !== (initial[k] ?? '').trim());
  });

  constructor() {
    this._agenciesApi
      .listAgencies(false, 1, 200)
      .pipe(catchError(() => of({ items: [] })))
      .subscribe((page) =>
        this.agencyOptions.set(
          (page.items ?? []).filter((a) => !!a.id).map((a) => ({ label: a.name ?? a.code ?? 'Agence', value: a.id! })),
        ),
      );

    // Le formulaire suit l'utilisateur chargé, et se recale après chaque enregistrement.
    effect(() => {
      this.model.set(IdentityFormModel.fromUser(this.user()));
      this.formSchema().reset();
    });
  }

  public cancel(): void {
    this.model.set(IdentityFormModel.fromUser(this.user()));
    this.formSchema().reset();
  }

  public save(): void {
    const user = this.user();
    if (!user?.id) return;
    const initial = IdentityFormModel.fromUser(user);

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      // Seuls les champs modifiés partent : l'endpoint applique ce qu'on lui donne, et renvoyer
      // l'adresse inchangée n'a pas à risquer une nouvelle invitation.
      const request: UpdateUserRequest = {};
      if (value.firstName.trim() !== initial.firstName) request.firstName = value.firstName.trim();
      if (value.lastName.trim() !== initial.lastName) request.lastName = value.lastName.trim();
      if (value.workPhone.trim() !== initial.workPhone) request.workPhone = value.workPhone.trim();
      if (value.agencyId !== initial.agencyId) request.agencyId = value.agencyId;
      const emailChanged = value.email.trim().toLowerCase() !== initial.email.toLowerCase();
      if (emailChanged) request.email = value.email.trim();

      const ok = await firstValueFrom(
        this._usersApi.updateUser(user.id!, request).pipe(
          map(() => true),
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Enregistrement impossible', err.error?.detail ?? err.error?.title ?? 'Les informations n’ont pas été mises à jour.');
            return of(false);
          }),
        ),
      );
      if (!ok) return;

      this._snackbar.success(
        'Informations enregistrées',
        emailChanged ? 'Une nouvelle invitation est partie à la nouvelle adresse.' : 'La fiche est à jour.',
      );
      this._state.reload();
    });
  }

  public onManagerChanged(_change: UserManagerChange): void {
    // Le rôle et l'agence du nouveau responsable viennent du serveur : on relit la fiche.
    this._state.reload();
  }
}

export default UserInformationsPage;
