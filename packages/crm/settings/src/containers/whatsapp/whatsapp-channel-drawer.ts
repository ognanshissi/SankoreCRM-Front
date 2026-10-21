import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, tap } from 'rxjs';
import { SaveWhatsAppChannelRequest, WhatsAppApiService, WhatsAppChannelDto } from '@sankore/crm-api';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  DEFAULT_360DIALOG_BASE_URL,
  E164_PATTERN,
  whatsAppErrorMessage,
} from './whatsapp-referential';

export interface WhatsAppChannelDrawerData {
  /** Absent : création. */
  channel: WhatsAppChannelDto | null;
  /** Options d'agence déjà chargées par la page, la première valant « Tout l'établissement ». */
  agencyOptions: { label: string; value: string }[];
}

class WhatsAppChannelFormModel {
  public name!: string;
  public phoneNumberId!: string;
  public wabaId!: string;
  public displayPhoneNumber!: string;
  /** Chaîne vide = tout l'établissement (`tas-select` travaille en chaînes). */
  public agencyId!: string;
  public apiBaseUrl!: string;
  public simulated!: boolean;

  public static fromChannel(dto: WhatsAppChannelDto | null): WhatsAppChannelFormModel {
    const m = new WhatsAppChannelFormModel();
    m.name = dto?.name ?? '';
    m.phoneNumberId = dto?.phoneNumberId ?? '';
    m.wabaId = dto?.wabaId ?? '';
    m.displayPhoneNumber = dto?.displayPhoneNumber ?? '';
    m.agencyId = dto?.agencyId ?? '';
    m.apiBaseUrl = dto?.apiBaseUrl ?? '';
    m.simulated = dto?.simulated ?? false;
    return m;
  }
}

/**
 * Enregistrement d'un numéro WhatsApp, en création comme en édition. La clé API n'est pas
 * ici : elle a son propre endpoint (`PUT …/api-key`) et part dans le coffre, jamais dans la
 * connexion — elle se saisit depuis la carte du numéro, une fois celui-ci créé.
 */
@Component({
  selector: 'whatsapp-channel-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    Button,
    TasIcon,
    TasCheckbox,
    TasFormField,
    TasLabel,
    TasHint,
    TasError,
    TasInput,
    TasSelect,
    FormRoot,
    FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <p class="text-base font-semibold text-slate-800">
          {{ isEdit ? 'Modifier le numéro' : 'Connecter un numéro WhatsApp' }}
        </p>
        <p class="text-xs text-slate-400 mt-0.5">
          Saisie manuelle des identifiants affichés dans le hub 360dialog.
        </p>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          @if (!isEdit) {
            <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <tas-checkbox [formField]="formSchema.simulated">Numéro simulé (développement)</tas-checkbox>
              <p class="text-xs text-slate-500 mt-1">
                Aucun appel à 360dialog : les messages restent en mémoire. Refusé par le serveur
                hors de l’environnement de développement.
              </p>
            </div>
          }

          <tas-form-field>
            <tas-label>Nom <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" placeholder="Ex : Service client Abidjan" [formField]="formSchema.name" />
            <tas-hint>Le nom sous lequel les agents verront ce numéro.</tas-hint>
            @if (formSchema.name().touched() && formSchema.name().invalid()) {
              <tas-error>{{ formSchema.name().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Numéro affiché @if (!isSimulated()) {<span class="text-functional-error">*</span>}</tas-label>
            <input tasInput type="text" placeholder="+2250700000000" [formField]="formSchema.displayPhoneNumber" />
            <tas-hint>Au format international E.164 : « + », indicatif pays, puis le numéro, sans espace.</tas-hint>
            @if (formSchema.displayPhoneNumber().touched() && formSchema.displayPhoneNumber().invalid()) {
              <tas-error>{{ formSchema.displayPhoneNumber().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Phone number ID <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" inputmode="numeric" [formField]="formSchema.phoneNumberId" />
            <tas-hint>Identifiant du numéro chez Meta, affiché dans le hub 360dialog.</tas-hint>
            @if (formSchema.phoneNumberId().touched() && formSchema.phoneNumberId().invalid()) {
              <tas-error>{{ formSchema.phoneNumberId().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>WABA ID</tas-label>
            <input tasInput type="text" inputmode="numeric" [formField]="formSchema.wabaId" />
            <tas-hint>Facultatif. Identifiant du compte WhatsApp Business qui porte le numéro.</tas-hint>
            @if (formSchema.wabaId().touched() && formSchema.wabaId().invalid()) {
              <tas-error>{{ formSchema.wabaId().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Agence</tas-label>
            <tas-select
              [options]="data.agencyOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="Tout l’établissement"
              [formField]="formSchema.agencyId"
            ></tas-select>
            <tas-hint>Laissez « Tout l’établissement » pour un numéro partagé par toutes les agences.</tas-hint>
          </tas-form-field>

          <div class="border-t border-slate-100 pt-4">
            <button tas-text-button type="button" (click)="showAdvanced.set(!showAdvanced())">
              <tas-icon [iconName]="showAdvanced() ? 'feather:chevron-down' : 'feather:chevron-right'" iconSize="sm"></tas-icon>
              Avancé
            </button>

            @if (showAdvanced()) {
              <tas-form-field class="mt-3 block">
                <tas-label>Adresse de l’API 360dialog</tas-label>
                <input tasInput type="url" [placeholder]="defaultBaseUrl" [formField]="formSchema.apiBaseUrl" />
                <tas-hint>Laissez vide pour l’adresse standard. À ne changer que sur indication de 360dialog.</tas-hint>
                @if (formSchema.apiBaseUrl().touched() && formSchema.apiBaseUrl().invalid()) {
                  <tas-error>{{ formSchema.apiBaseUrl().errors()[0].message }}</tas-error>
                }
              </tas-form-field>
            }
          </div>
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
          {{ isEdit ? 'Enregistrer' : 'Connecter le numéro' }}
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class WhatsAppChannelDrawer {
  public readonly data: WhatsAppChannelDrawerData = inject(DIALOG_DATA);

  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(WhatsAppApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly isEdit = !!this.data.channel?.id;
  public readonly defaultBaseUrl = DEFAULT_360DIALOG_BASE_URL;

  public model = signal(WhatsAppChannelFormModel.fromChannel(this.data.channel));
  public showAdvanced = signal(!!this.data.channel?.apiBaseUrl);

  public formSchema = form(this.model, (schema) => {
    required(schema.name, { message: 'Le nom est obligatoire' });

    validate(schema.phoneNumberId, (ctx) => {
      const value = (ctx.value() ?? '').trim();
      if (!value) return { kind: 'required', message: 'Le phone number ID est obligatoire' };
      return /^\d+$/.test(value)
        ? null
        : { kind: 'pattern', message: 'Le phone number ID ne contient que des chiffres' };
    });

    validate(schema.wabaId, (ctx) => {
      const value = (ctx.value() ?? '').trim();
      if (!value) return null;
      return /^\d+$/.test(value)
        ? null
        : { kind: 'pattern', message: 'Le WABA ID ne contient que des chiffres' };
    });

    // Un numéro simulé n'existe chez personne : rien à afficher à un client, donc rien à exiger.
    validate(schema.displayPhoneNumber, (ctx) => {
      const value = (ctx.value() ?? '').trim();
      if (!value) {
        return ctx.valueOf(schema.simulated)
          ? null
          : { kind: 'required', message: 'Le numéro affiché est obligatoire' };
      }
      return E164_PATTERN.test(value)
        ? null
        : { kind: 'pattern', message: 'Format attendu : +XXXXXXXX (E.164, sans espace)' };
    });

    validate(schema.apiBaseUrl, (ctx) => {
      const value = (ctx.value() ?? '').trim();
      if (!value) return null;
      try {
        return new URL(value).protocol === 'https:'
          ? null
          : { kind: 'pattern', message: 'L’adresse doit commencer par https://' };
      } catch {
        return { kind: 'pattern', message: 'Adresse invalide' };
      }
    });
  });

  public readonly isSimulated = computed(() => this.formSchema.simulated().value());

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const channel = this.data.channel;
      const request: SaveWhatsAppChannelRequest = {
        name: value.name.trim(),
        phoneNumberId: value.phoneNumberId.trim(),
        wabaId: value.wabaId.trim() || null,
        displayPhoneNumber: value.displayPhoneNumber.trim() || null,
        agencyId: value.agencyId || null,
        apiBaseUrl: value.apiBaseUrl.trim() || null,
        simulated: channel ? (channel.simulated ?? false) : value.simulated,
        // Sans la sentinelle, deux administrateurs qui enregistrent en même temps s'écrasent.
        expectedVersion: channel ? (channel.version ?? null) : null,
      };

      // `updateWhatsAppChannel` répond 204 : l'observable émet `null`, qu'on ne distingue pas
      // d'un repli sur EMPTY par la valeur. Le drapeau le dit sans ambiguïté.
      let saved = false;
      const call$ = channel?.id
        ? this._api.updateWhatsAppChannel(channel.id, request)
        : this._api.createWhatsAppChannel(request);

      await firstValueFrom(
        call$.pipe(
          tap(() => {
            saved = true;
          }),
          catchError((err: unknown) => {
            this._snackbar.error(
              'Enregistrement refusé',
              whatsAppErrorMessage(err, 'Le numéro n’a pas pu être enregistré.'),
            );
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );

      if (!saved) return;

      this._snackbar.success(
        this.isEdit ? 'Numéro enregistré' : 'Numéro connecté',
        this.isEdit
          ? 'Les modifications sont enregistrées.'
          : value.simulated
            ? 'Le numéro simulé est créé. Testez-le puis activez-le.'
            : 'Collez maintenant la clé API 360dialog sur la carte du numéro.',
      );
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}
