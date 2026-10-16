import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { TelephonyApiService, UserDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTitle } from '@talisoft/ui/title';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { telephonyErrorMessage } from '../../data-access/telephony-referential';
import { isValidCallerNumber, UserLinkRow } from './user-link-presentation';

export interface LinkUserDrawerData {
  /** Les comptes du fournisseur encore libres, pris de l'annuaire déjà chargé par l'écran. */
  availableAccounts: UserLinkRow[];
  /** Les utilisateurs CRM, pour la liste déroulante. Vide quand la lecture a échoué. */
  users: UserDto[];
  /** Les identifiants CRM déjà rattachés : un utilisateur ne tient qu'un seul compte. */
  linkedCrmUserIds: string[];
  /** Compte présélectionné quand on part d'une ligne de la liste. */
  externalUserId: string | null;
  /** Faux quand l'annuaire n'a pas pu être lu : la saisie passe alors en manuel. */
  directoryAvailable: boolean;
}

class LinkUserFormModel {
  public externalUserId!: string;
  public externalEmail!: string;
  public crmUserId!: string;
  public defaultCallerNumber!: string;

  public static instantiate(data: LinkUserDrawerData): LinkUserFormModel {
    const model = new LinkUserFormModel();
    model.externalUserId = data.externalUserId ?? '';
    model.externalEmail =
      data.availableAccounts.find((row) => row.externalUserId === data.externalUserId)
        ?.externalEmail ?? '';
    model.crmUserId = '';
    model.defaultCallerNumber = '';
    return model;
  }
}

/**
 * Rattachement manuel d'un poste.
 *
 * Deux saisies différentes derrière un seul formulaire, parce que le contrat accepte les
 * deux : « takes the pairing GET telephony/directory proposed, OR one typed by hand ».
 * Quand l'annuaire a répondu, on choisit un compte dans la liste — c'est la saisie sûre.
 * Quand il n'a pas répondu (fournisseur injoignable), la liste serait vide : on laisse
 * alors saisir l'identifiant du compte à la main, en disant que rien ne le vérifie, au
 * lieu de bloquer tout rattachement sur une panne du fournisseur.
 *
 * Les utilisateurs déjà rattachés sont retirés de la liste : un utilisateur tient AU PLUS
 * un compte, et le serveur répond 409 plutôt que de déplacer le compte — proposer le choix
 * échangerait une explication contre un refus.
 */
@Component({
  selector: 'lib-link-user-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasIcon,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    FormRoot,
    FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Rattacher un poste</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <p class="text-sm text-slate-500">
            Un utilisateur tient au plus un compte du fournisseur, et un compte au plus un
            utilisateur. Les appels qui suivront seront attribués à cet utilisateur.
          </p>

          @if (!data.directoryAvailable) {
            <div class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <tas-icon
                iconName="feather:alert-triangle"
                class="mt-0.5 shrink-0 text-amber-600"
                style="font-size:14px"
              ></tas-icon>
              <p class="text-xs text-amber-800">
                L'annuaire du fournisseur n'a pas pu être lu : saisissez l'identifiant du compte
                à la main. Rien ne le vérifie ici — une faute de frappe donnera un rattachement
                qui n'attribuera aucun appel.
              </p>
            </div>
          }

          @if (data.directoryAvailable) {
            <tas-form-field>
              <tas-label>
                Compte du fournisseur <span class="text-functional-error">*</span>
              </tas-label>
              <tas-select
                [searchable]="true"
                [options]="accountOptions()"
                optionLabel="label"
                optionValue="value"
                placeholder="Cherchez un compte dans l'annuaire"
                [formField]="formSchema.externalUserId"
              ></tas-select>
              @if (formSchema.externalUserId().touched() && formSchema.externalUserId().invalid()) {
                <tas-error>{{ formSchema.externalUserId().errors()[0].message }}</tas-error>
              } @else {
                <tas-hint>
                  {{ accountOptions().length }} compte(s) encore libre(s) dans l'annuaire.
                </tas-hint>
              }
            </tas-form-field>
          } @else {
            <div class="grid grid-cols-2 gap-4">
              <tas-form-field>
                <tas-label>
                  Identifiant du compte <span class="text-functional-error">*</span>
                </tas-label>
                <input tasInput type="text" [formField]="formSchema.externalUserId" />
                @if (formSchema.externalUserId().touched() && formSchema.externalUserId().invalid()) {
                  <tas-error>{{ formSchema.externalUserId().errors()[0].message }}</tas-error>
                } @else {
                  <tas-hint>Tel qu'il apparaît dans la console du fournisseur.</tas-hint>
                }
              </tas-form-field>

              <tas-form-field>
                <tas-label>Adresse e-mail du compte</tas-label>
                <input tasInput type="text" [formField]="formSchema.externalEmail" />
                <tas-hint>Facultatif. Sert au rapprochement automatique ultérieur.</tas-hint>
              </tas-form-field>
            </div>
          }

          <tas-form-field>
            <tas-label>Utilisateur SANKORE <span class="text-functional-error">*</span></tas-label>
            <tas-select
              [searchable]="true"
              [options]="userOptions()"
              optionLabel="label"
              optionValue="value"
              placeholder="Cherchez un utilisateur"
              [formField]="formSchema.crmUserId"
            ></tas-select>
            @if (formSchema.crmUserId().touched() && formSchema.crmUserId().invalid()) {
              <tas-error>{{ formSchema.crmUserId().errors()[0].message }}</tas-error>
            } @else if (userOptions().length === 0) {
              <tas-hint>
                Aucun utilisateur disponible : la liste des utilisateurs n'a pas pu être lue, ou
                ils sont tous déjà rattachés.
              </tas-hint>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Numéro d'appelant</tas-label>
            <input tasInput type="text" placeholder="+2252012345678" [formField]="formSchema.defaultCallerNumber" />
            @if (formSchema.defaultCallerNumber().touched() && formSchema.defaultCallerNumber().invalid()) {
              <tas-error>{{ formSchema.defaultCallerNumber().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>
                Facultatif. Laissé vide, l'utilisateur appelle avec le numéro par défaut de la
                connexion, ce qui est le cas ordinaire.
              </tas-hint>
            }
          </tas-form-field>

          @if (submitError()) {
            <p class="text-sm text-functional-error">{{ submitError() }}</p>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
        <button
          tas-raised-button
          color="primary"
          type="button"
          (click)="handleSubmit()"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
        >
          Rattacher
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class LinkUserDrawer {
  public readonly data: LinkUserDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(TelephonyApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly submitError = signal<string | null>(null);

  public model = signal(LinkUserFormModel.instantiate(this.data));

  public formSchema = form(this.model, (schema) => {
    required(schema.externalUserId, { message: 'Choisissez un compte du fournisseur' });
    required(schema.crmUserId, { message: 'Choisissez un utilisateur' });

    validate(schema.defaultCallerNumber, (ctx) =>
      isValidCallerNumber(ctx.value())
        ? null
        : {
            kind: 'pattern',
            message:
              'Format international attendu : un « + » puis 8 à 15 chiffres, sans espace',
          },
    );
  });

  public readonly accountOptions = computed(() =>
    this.data.availableAccounts
      .filter((row) => !!row.externalUserId)
      .map((row) => ({
        value: row.externalUserId,
        label: `${row.externalDisplayName} — ${row.externalEmail}`,
      })),
  );

  public readonly userOptions = computed(() => {
    const linked = new Set(this.data.linkedCrmUserIds);
    return this.data.users
      .filter((user) => !!user.id && !linked.has(user.id))
      .map((user) => ({
        value: user.id as string,
        label: user.agencyName
          ? `${user.fullName || user.email} — ${user.agencyName}`
          : `${user.fullName || user.email}`,
      }));
  });

  public handleSubmit(): void {
    this.submitError.set(null);

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const email =
        this.data.availableAccounts.find(
          (row) => row.externalUserId === value.externalUserId,
        )?.externalEmail ?? value.externalEmail;

      const response = await firstValueFrom(
        this._api
          .linkTelephonyUser({
            crmUserId: value.crmUserId,
            externalUserId: value.externalUserId.trim(),
            // L'e-mail de l'annuaire est une valeur d'affichage : `—` y remplace un champ
            // vide, et l'envoyer tel quel écrirait ce tiret dans la ligne de rattachement.
            externalEmail: email && email !== '—' ? email.trim() : null,
            defaultCallerNumber: value.defaultCallerNumber.trim() || null,
          })
          .pipe(
            catchError((error: HttpErrorResponse) => {
              const message = telephonyErrorMessage(
                error,
                "Le rattachement n'a pas pu être enregistré.",
              );
              this.submitError.set(message);
              this._snackbar.error('Rattachement refusé', message);
              return EMPTY;
            }),
          ),
        { defaultValue: undefined },
      );

      if (!response) return;

      this._snackbar.success(
        'Poste rattaché',
        'Les prochains appels de ce compte seront attribués à cet utilisateur.',
      );
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
