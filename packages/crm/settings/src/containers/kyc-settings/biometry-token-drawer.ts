import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInputPassword } from '@talisoft/ui/input-password';
import { TasTitle } from '@talisoft/ui/title';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { KYCSettingsApiService } from '@sankore/crm-api';

export interface BiometryTokenDrawerData {
  /** Indice masqué du jeton déjà stocké, s'il y en a un. */
  maskedValue: string | null;
}

class BiometryTokenFormModel {
  public token!: string;

  public static empty(): BiometryTokenFormModel {
    const model = new BiometryTokenFormModel();
    // Jamais prérempli : le jeton stocké n'est pas lisible, et par conception aucune route ne le
    // renvoie. Remplacer veut dire ressaisir.
    model.token = '';
    return model;
  }
}

/**
 * Saisie du jeton du service biométrique du tenant (`PUT /kyc-settings/biometry-token`).
 *
 * **Écriture seule.** Le jeton vit dans le coffre de secrets, jamais dans une colonne, un `GET`,
 * un log ou une entrée d'audit — l'écran ne peut donc ni l'afficher ni le préremplir. Il ne montre
 * que l'indice masqué renvoyé par le coffre, assez pour distinguer deux jetons pendant une
 * rotation, jamais assez pour en utiliser un.
 *
 * Sans jeton, chaque vérification répond BIOMETRY_NOT_CONFIGURED et le dossier KYC reste en
 * `Verifying` pour le job de reprise : le client n'est jamais rejeté à cause de notre
 * configuration. C'est pourquoi cet écran parle de « configuration manquante », pas d'erreur.
 */
@Component({
  selector: 'biometry-token-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    FormRoot,
    Button,
    TasError,
    TasFormField,
    TasHint,
    TasLabel,
    TasIcon,
    TasInputPassword,
    TasTitle,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>
          @if (data.maskedValue) {
            Remplacer le jeton biométrique
          } @else {
            Configurer le jeton biométrique
          }
        </tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <p class="text-xs text-slate-500 mb-4">
          Jeton porteur envoyé au service biométrique externe pour ce tenant. Il
          est conservé dans le coffre de secrets : aucune route ne le renvoie,
          et il n'apparaît ni dans les journaux ni dans la piste d'audit.
        </p>

        @if (data.maskedValue) {
          <div
            class="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-2"
          >
            <tas-icon
              iconName="feather:key"
              class="text-slate-400"
              style="font-size:12px"
            ></tas-icon>
            <span class="text-xs text-slate-600">
              Jeton actuel :
              <span class="font-medium tabular-nums">{{
                data.maskedValue
              }}</span>
            </span>
          </div>
        }

        <form [formRoot]="formSchema" class="flex flex-col gap-5">
            <tas-input-password [formField]="formSchema.token">
              Jeton <span class="text-functional-error">*</span>
            </tas-input-password>
            @if (formSchema.token().touched() && formSchema.token().invalid()) {
              <tas-error>{{
                formSchema.token().errors()[0].message
              }}</tas-error>
            } @else {
              <tas-hint>
                Collé depuis le service biométrique. Les espaces de début et de
                fin sont retirés.
              </tas-hint>
            }

          @if (submitError()) {
            <p class="text-xs text-functional-error">{{ submitError() }}</p>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button type="button" (click)="close()">
          <tas-icon iconName="feather:x"></tas-icon> Annuler
        </button>
        <button
          tas-raised-button
          color="primary"
          type="button"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
          (click)="handleSubmit()"
        >
          <tas-icon iconName="feather:save"></tas-icon>
          @if (data.maskedValue) {
            Remplacer
          } @else {
            Enregistrer
          }
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class BiometryTokenDrawer {
  public readonly data: BiometryTokenDrawerData = inject(DIALOG_DATA);

  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _settingsApi = inject(KYCSettingsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly submitError = signal<string | null>(null);

  public model = signal(BiometryTokenFormModel.empty());

  public formSchema = form(this.model, (schema) => {
    validate(schema.token, (ctx) => {
      const raw = (ctx.value() ?? '').trim();
      if (!raw)
        return { kind: 'required', message: 'Le jeton est obligatoire' };
      if (raw.length > 512) {
        return {
          kind: 'maxLength',
          message: 'Le jeton ne peut pas dépasser 512 caractères',
        };
      }
      // Pas de contrôle de format : la forme d'un jeton appartient au service, et la refuser
      // ici rejetterait un jeton valide le jour où il change de forme.
      return null;
    });
  });

  public readonly isReplacement = computed(() => !!this.data.maskedValue);

  public close(): void {
    this._dialogRef.close(false);
  }

  public handleSubmit(): void {
    this.submitError.set(null);

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const token = (value?.token ?? '').trim();
      if (!token) return;

      // `map(() => true)` parce que la route répond 204 : le client généré émet `null`, et un
      // test de vérité sur la réponse prendrait un succès pour un échec.
      const saved = await firstValueFrom(
        this._settingsApi.setKycBiometryToken({ token }).pipe(
          map(() => true),
          catchError((error: HttpErrorResponse) => {
            const message = this._errorMessage(error);
            this.submitError.set(message);
            this._snackbar.error('Enregistrement refusé', message);
            return EMPTY;
          }),
        ),
      );

      if (!saved) return;

      this._snackbar.success(
        'Jeton enregistré',
        'Les prochaines vérifications biométriques utiliseront ce jeton.',
      );
      this._dialogRef.close(true);
    });
  }

  private _errorMessage(error: HttpErrorResponse): string {
    if (error.status === 403) {
      return "Vous n'avez pas le droit de modifier les paramètres KYC.";
    }

    // Le serveur nomme les refus de validation par chemin de champ : les remonter évite un
    // message générique là où la cause est connue.
    const errors = error.error?.errors as Record<string, string[]> | undefined;
    const first = errors ? Object.values(errors).flat()[0] : undefined;

    return first ?? error.error?.title ?? "Impossible d'enregistrer le jeton.";
  }
}
