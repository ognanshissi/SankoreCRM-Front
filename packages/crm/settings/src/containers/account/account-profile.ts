import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasSwitch } from '@talisoft/ui/switch';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { UsersApiService, UserDto } from '@sankore/crm-api';
import { AuthenticationService } from '@sankore/crm/common';

@Component({
  selector: 'account-profile',
  imports: [
    FormsModule, TasCard, TasSpinner, TasIcon, TasTag, Button, TasSwitch,
    TasFormField, TasLabel, TasInput,
  ],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
    } @else {
      <div class="pb-6 flex flex-col gap-4">
        <!-- User info (read-only) -->
        <tas-card>
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <tas-icon iconName="feather:user" class="text-slate-400" style="font-size:14px"></tas-icon>
              Informations du compte
            </p>
          </div>
          <div class="p-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <p class="text-xs text-slate-400 mb-1">Email</p>
              <p class="text-sm font-medium text-slate-800 font-mono">{{ user()?.email ?? '—' }}</p>
            </div>
            <div>
              <p class="text-xs text-slate-400 mb-1">Statut</p>
              <tas-tag [severity]="user()?.status === '1' ? 'success' : 'warning'">
                {{ user()?.status === '1' ? 'Actif' : 'Inactif' }}
              </tas-tag>
            </div>
            @if (user()?.agencyName) {
              <div>
                <p class="text-xs text-slate-400 mb-1">Agence</p>
                <p class="text-sm text-slate-800">{{ user()!.agencyName }}</p>
              </div>
            }
            @if (user()?.roles?.length) {
              <div>
                <p class="text-xs text-slate-400 mb-1">Rôles</p>
                <div class="flex gap-1 flex-wrap">
                  @for (role of user()!.roles!; track role) {
                    <tas-tag severity="info">{{ role }}</tas-tag>
                  }
                </div>
              </div>
            }
          </div>
        </tas-card>

        <!-- Editable profile -->
        <tas-card>
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <tas-icon iconName="feather:edit-3" class="text-slate-400" style="font-size:14px"></tas-icon>
              Modifier mon profil
            </p>
          </div>
          <div class="p-4 flex flex-col gap-3">
            <tas-form-field>
              <tas-label>Nom complet</tas-label>
              <input tasInput type="text" placeholder="Votre nom"
                [ngModel]="editFullName()" (ngModelChange)="editFullName.set($event)" />
            </tas-form-field>

            <tas-form-field>
              <tas-label>Langues parlées</tas-label>
              <input tasInput type="text" placeholder="Ex : fr, en, wo (séparées par des virgules)"
                [ngModel]="editLanguages()" (ngModelChange)="editLanguages.set($event)" />
              <p class="text-xs text-slate-400 mt-1">Codes langue séparés par des virgules.</p>
            </tas-form-field>

            <tas-form-field>
              <tas-label>Spécialités</tas-label>
              <input tasInput type="text" placeholder="Ex : Loan, Savings (séparées par des virgules)"
                [ngModel]="editSpecialties()" (ngModelChange)="editSpecialties.set($event)" />
            </tas-form-field>

            <div class="flex items-center gap-3">
              <tas-switch [checked]="editNotifications()" ariaLabel="Notifications"
                (toggle)="editNotifications.set($event)"></tas-switch>
              <span class="text-sm text-slate-600">Recevoir les notifications par email</span>
            </div>

            <div class="flex justify-end mt-2">
              <button tas-raised-button color="primary" type="button"
                [disabled]="isSaving()" [isLoading]="isSaving()" (click)="saveProfile()">
                <tas-icon iconName="feather:save" style="font-size:14px"></tas-icon>
                Enregistrer
              </button>
            </div>
          </div>
        </tas-card>
      </div>
    }
  `,
})
export class AccountProfile implements OnInit {
  private readonly _usersApi = inject(UsersApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _snackbar = inject(SnackbarService);

  public isLoading = signal(true);
  public isSaving = signal(false);
  public user = signal<UserDto | null>(null);

  public editFullName = signal('');
  public editLanguages = signal('');
  public editSpecialties = signal('');
  public editNotifications = signal(true);

  ngOnInit(): void {
    const userId = this._auth.connectedUser()?.id;
    if (!userId) { this.isLoading.set(false); return; }

    this._usersApi.getUser(userId).pipe(
      catchError(() => { this.isLoading.set(false); return EMPTY; }),
    ).subscribe((u) => {
      this.user.set(u);
      this.editFullName.set(u.fullName ?? '');
      this.editLanguages.set((u.spokenLanguages ?? []).join(', '));
      this.editSpecialties.set((u.specialties ?? []).join(', '));
      this.editNotifications.set(u.enableNotifications ?? true);
      this.isLoading.set(false);
    });
  }

  public saveProfile(): void {
    const userId = this._auth.connectedUser()?.id;
    if (!userId) return;

    this.isSaving.set(true);
    this._usersApi.updateUser(userId, {
      fullName: this.editFullName().trim() || null,
      spokenLanguages: this.editLanguages().split(',').map((l) => l.trim()).filter(Boolean),
      specialties: this.editSpecialties().split(',').map((s) => s.trim()).filter(Boolean),
      enableNotifications: this.editNotifications(),
    }).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Mise à jour échouée.'); this.isSaving.set(false); return EMPTY; }),
    ).subscribe(() => {
      this._snackbar.success('Profil mis à jour', 'Vos informations ont été enregistrées.');
      this.isSaving.set(false);
    });
  }
}

export default AccountProfile;
