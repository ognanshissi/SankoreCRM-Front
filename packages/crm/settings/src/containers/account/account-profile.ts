import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, maxLength, pattern, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel, TasError, TasHint } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { MyProfileDto, UpdateMyProfileRequest, UsersApiService } from '@sankore/crm-api';
import { AccountHeaderState } from './account-navigation';

const LANGUAGE_OPTIONS = [
  { label: 'Français', value: 'fr' },
  { label: 'English', value: 'en' },
];

/** Fuseaux IANA de la zone. Celui qui sert à lire les horaires de travail pour le dispatching. */
const TIME_ZONE_OPTIONS = [
  { label: 'Abidjan (GMT+0)', value: 'Africa/Abidjan' },
  { label: 'Dakar (GMT+0)', value: 'Africa/Dakar' },
  { label: 'Bamako (GMT+0)', value: 'Africa/Bamako' },
  { label: 'Ouagadougou (GMT+0)', value: 'Africa/Ouagadougou' },
  { label: 'Lomé (GMT+0)', value: 'Africa/Lome' },
  { label: 'Conakry (GMT+0)', value: 'Africa/Conakry' },
  { label: 'Porto-Novo / Cotonou (GMT+1)', value: 'Africa/Porto-Novo' },
  { label: 'Niamey (GMT+1)', value: 'Africa/Niamey' },
  { label: 'Douala (GMT+1)', value: 'Africa/Douala' },
  { label: 'Libreville (GMT+1)', value: 'Africa/Libreville' },
  { label: 'Paris (GMT+1 / +2)', value: 'Europe/Paris' },
];

const AMOUNT_FORMAT_OPTIONS = [
  { label: '250 000 FCFA', value: 'SpaceGrouped' },
  { label: '250.000 FCFA', value: 'DotGrouped' },
  { label: '250,000 FCFA', value: 'CommaGrouped' },
];

const PHONE_PATTERN = /^\+?[0-9 ().-]*$/;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const SIGNATURE_MAX_LENGTH = 500;

class ProfileFormModel {
  public firstName!: string;
  public lastName!: string;
  public workPhone!: string;
  public whatsApp!: string;
  public signature!: string;
  public interfaceLanguage!: string;
  public timeZone!: string;
  public amountFormat!: string;

  public static fromDto(dto: MyProfileDto): ProfileFormModel {
    const m = new ProfileFormModel();
    m.firstName = dto.firstName ?? '';
    m.lastName = dto.lastName ?? '';
    m.workPhone = dto.workPhone ?? '';
    m.whatsApp = dto.whatsAppNumber ?? '';
    m.signature = dto.signature ?? '';
    m.interfaceLanguage = dto.interfaceLanguage ?? 'fr';
    m.timeZone = dto.timeZone ?? 'Africa/Abidjan';
    m.amountFormat = dto.amountFormat ?? 'SpaceGrouped';
    return m;
  }
}

@Component({
  selector: 'account-profile',
  imports: [
    DatePipe, TitleCasePipe, FormRoot, FormField, Button, TasFormField, TasLabel, TasError, TasHint,
    TasIcon, TasInput, TasSelect, TasSpinner,
  ],
  templateUrl: './account-profile.html',
})
export class AccountProfile implements OnInit {
  private readonly _usersApi = inject(UsersApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _header = inject(AccountHeaderState);

  public readonly languageOptions = LANGUAGE_OPTIONS;
  public readonly amountFormatOptions = AMOUNT_FORMAT_OPTIONS;
  public readonly timeZoneOptions = signal(TIME_ZONE_OPTIONS);
  public readonly signatureMaxLength = SIGNATURE_MAX_LENGTH;

  public isLoading = signal(true);
  public loadFailed = signal(false);
  public isAvatarBusy = signal(false);
  public dto = signal<MyProfileDto | null>(null);

  public model = signal(ProfileFormModel.fromDto({}));
  public formSchema = form(this.model, (schema) => {
    required(schema.firstName, { message: 'Le prénom est obligatoire' });
    required(schema.lastName, { message: 'Le nom est obligatoire' });
    pattern(schema.workPhone, PHONE_PATTERN, { message: 'Numéro invalide' });
    pattern(schema.whatsApp, PHONE_PATTERN, { message: 'Numéro invalide' });
    maxLength(schema.signature, SIGNATURE_MAX_LENGTH, {
      message: `${SIGNATURE_MAX_LENGTH} caractères au maximum`,
    });
  });

  ngOnInit(): void {
    this._load();
  }

  public initials(): string {
    const m = this.model();
    return ((m.firstName[0] ?? '') + (m.lastName[0] ?? '')).toUpperCase() || '?';
  }

  // ——— Photo : appliquée tout de suite, indépendamment du bouton Enregistrer ———

  public onAvatarSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Remis à zéro pour que choisir deux fois le même fichier redéclenche l'évènement.
    input.value = '';
    if (!file) return;

    if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
      this._snackbar.error('Format refusé', 'La photo doit être au format JPG ou PNG.');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      this._snackbar.error('Photo trop lourde', 'La photo ne peut pas dépasser 2 Mo.');
      return;
    }

    this.isAvatarBusy.set(true);
    this._usersApi.uploadMyAvatar(file).pipe(
      catchError((err: HttpErrorResponse) => {
        this._snackbar.error('Photo non enregistrée', err.error?.detail ?? 'La photo n’a pas pu être envoyée.');
        this.isAvatarBusy.set(false);
        return EMPTY;
      }),
    ).subscribe(() => this._refreshAvatar('Photo mise à jour'));
  }

  public removeAvatar(): void {
    this.isAvatarBusy.set(true);
    this._usersApi.deleteMyAvatar().pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'La photo n’a pas pu être retirée.');
        this.isAvatarBusy.set(false);
        return EMPTY;
      }),
    ).subscribe(() => this._refreshAvatar('Photo retirée'));
  }

  // ——— Formulaire ———

  public cancel(): void {
    const dto = this.dto();
    if (!dto) return;
    this.model.set(ProfileFormModel.fromDto(dto));
    this.formSchema().reset();
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const request: UpdateMyProfileRequest = {
        firstName: value.firstName.trim(),
        lastName: value.lastName.trim(),
        workPhone: value.workPhone.trim() || null,
        whatsAppNumber: value.whatsApp.trim() || null,
        signature: value.signature.trim() || null,
        interfaceLanguage: value.interfaceLanguage,
        timeZone: value.timeZone,
        amountFormat: value.amountFormat,
      };

      const ok = await firstValueFrom(
        this._usersApi.updateMyProfile(request).pipe(
          map(() => true),
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Enregistrement impossible', err.error?.detail ?? err.error?.title ?? 'Votre profil n’a pas été enregistré.');
            return of(false);
          }),
        ),
      );
      if (!ok) return;

      this._snackbar.success('Profil enregistré', 'Vos informations ont été mises à jour.');
      // Relecture : la date de modification et le nom affiché dans l'en-tête viennent du serveur.
      this._load();
    });
  }

  // ——— Chargement ———

  private _refreshAvatar(message: string): void {
    this._usersApi.getMyProfile().pipe(catchError(() => of(null))).subscribe((profile) => {
      this.isAvatarBusy.set(false);
      if (!profile) return;
      // Seule la photo est reprise : une saisie en cours dans le formulaire ne doit pas sauter.
      this.dto.update((d) => (d ? { ...d, avatarDataUrl: profile.avatarDataUrl } : profile));
      this._header.profile.update((p) => (p ? { ...p, avatarDataUrl: profile.avatarDataUrl } : profile));
      this._snackbar.success(message, '');
    });
  }

  private _load(): void {
    this.isLoading.set(true);
    this.loadFailed.set(false);

    this._usersApi.getMyProfile().subscribe({
      next: (profile) => {
        this.dto.set(profile);
        this.model.set(ProfileFormModel.fromDto(profile));
        this.formSchema().reset();
        this._header.profile.set(profile);
        // Un fuseau enregistré hors de la liste reste affichable plutôt que de paraître vide.
        const tz = profile.timeZone;
        if (tz && !TIME_ZONE_OPTIONS.some((o) => o.value === tz)) {
          this.timeZoneOptions.set([...TIME_ZONE_OPTIONS, { label: tz, value: tz }]);
        }
        this.isLoading.set(false);
      },
      error: () => {
        this.loadFailed.set(true);
        this.isLoading.set(false);
      },
    });
  }
}

export default AccountProfile;
