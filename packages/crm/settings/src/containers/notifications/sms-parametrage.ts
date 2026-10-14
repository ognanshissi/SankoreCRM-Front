import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { SMSSettingsApiService, SmsSettingsDto } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';

/**
 * Les trois valeurs que le serveur accepte. **Lues sur le DTO** (`availableProviders`) plutôt que
 * codées ici : la liste est servie avec la configuration précisément pour que l'écran ne puisse pas
 * dériver de celle du serveur. Ce tableau n'est que la table des libellés.
 */
const PROVIDER_LABELS: Record<string, string> = {
  Disabled: 'Aucun — canal SMS désactivé',
  Brevo: 'Brevo',
  Twilio: 'Twilio',
};

/**
 * Le secret n'est **jamais** relu : le DTO n'expose que `hasCredential`. Le modèle part donc
 * toujours vide, et un champ vide à l'envoi veut dire « conserver celui qui est stocké ». Même
 * règle que l'écran e-mail — ne pas pré-remplir de points, qui feraient croire à une valeur
 * récupérable.
 */
class SmsSettingsFormModel {
  public providerType!: string;
  public senderId!: string;
  public accountSid!: string;
  public defaultCallingCode!: string;
  public credential!: string;

  public static fromSettings(dto: SmsSettingsDto | null): SmsSettingsFormModel {
    const m = new SmsSettingsFormModel();
    m.providerType = dto?.providerType ?? 'Disabled';
    m.senderId = dto?.senderId ?? '';
    m.accountSid = dto?.accountSid ?? '';
    m.defaultCallingCode = dto?.defaultCallingCode ?? '';
    m.credential = '';
    return m;
  }
}

/**
 * Le plafond a son propre endpoint et sa propre permission : isolé dans son formulaire pour qu'un
 * enregistrement de l'un n'emporte pas l'autre. Même découpage que côté e-mail, et pour la même
 * raison — ce sont deux personnes différentes qui les règlent.
 */
class SmsQuotaFormModel {
  /** Chaîne : l'input rend du texte. Vide = pas de plafond. */
  public monthlyQuotaLimit!: string;

  public static fromSettings(dto: SmsSettingsDto | null): SmsQuotaFormModel {
    const m = new SmsQuotaFormModel();
    m.monthlyQuotaLimit = dto?.monthlyQuotaLimit != null ? String(dto.monthlyQuotaLimit) : '';
    return m;
  }
}

/**
 * Paramétrage du canal SMS du tenant.
 *
 * | Route | Permission |
 * |---|---|
 * | `GET /sms-settings`       | `notification:settings:read` |
 * | `PUT /sms-settings`       | `notification:settings:manage` |
 * | `PUT /sms-settings/quota` | `notification:settings:quota` |
 *
 * **Un écran à part de celui de l'e-mail, pas une section de plus dedans.** Les deux canaux ne
 * partagent ni fournisseur, ni secret, ni plafond, et un tenant fait tourner l'un sans l'autre ;
 * les fondre aurait donné un formulaire de neuf cents lignes dont un enregistrement touche deux
 * configurations indépendantes.
 *
 * **Trois choses que cet écran dit et que le serveur seul sait** : si le canal peut réellement
 * envoyer (`canSend` — un fournisseur sans expéditeur a l'air configuré et n'envoie rien), ce que
 * le fournisseur choisi attend comme expéditeur (`senderIdHint`), et l'URL de rappel à coller chez
 * Brevo. Aucune de ces trois n'est déduite côté client : elles dépendent du fournisseur et de la
 * clé de plateforme.
 */
@Component({
  selector: 'sms-parametrage',
  templateUrl: './sms-parametrage.html',
  imports: [
    DecimalPipe,
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    Button,
    TasFormField,
    TasLabel,
    TasHint,
    TasError,
    TasInput,
    TasSelect,
    FormRoot,
    FormField,
  ],
})
export class SmsParametrage implements OnInit {
  private readonly _api = inject(SMSSettingsApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly canManageSettings = this._permissions.can('notification:settings:manage');
  public readonly canSetQuota = this._permissions.can('notification:settings:quota');

  public isLoading = signal(true);
  public loadError = signal(false);
  public settings = signal<SmsSettingsDto | null>(null);
  public isSaving = signal(false);
  public isSavingQuota = signal(false);

  public model = signal(SmsSettingsFormModel.fromSettings(null));

  public formSchema = form(this.model, (schema) => {
    required(schema.providerType, { message: 'Choisissez un fournisseur' });

    // Tout ce qui suit ne vaut que pour un canal qu'on ACTIVE. Désactiver doit rester possible
    // sans expéditeur et sans clé, sinon un tenant dont le fournisseur l'a lâché ne pourrait pas
    // couper le canal sans d'abord le réparer.
    validate(schema.senderId, (ctx) => {
      if (ctx.valueOf(schema.providerType) === 'Disabled') return null;
      return (ctx.value() ?? '').trim()
        ? null
        : {
            kind: 'required',
            message: "Un identifiant d'expéditeur est obligatoire : les deux fournisseurs "
                   + "refusent un message qui n'en porte pas",
          };
    });

    // L'indicatif : la condition la plus facile à oublier et la plus difficile à diagnostiquer.
    // Sans lui, tout client enregistré au format local est injoignable et rien ne dit pourquoi.
    validate(schema.defaultCallingCode, (ctx) => {
      if (ctx.valueOf(schema.providerType) === 'Disabled') return null;

      const digits = (ctx.value() ?? '').replace(/\D/g, '');

      if (digits.length === 0) {
        return {
          kind: 'required',
          message: "L'indicatif pays est obligatoire : les numéros enregistrés au format local "
                 + 'ne peuvent pas être composés sans lui',
        };
      }

      return digits.length <= 3
        ? null
        : { kind: 'pattern', message: 'Un indicatif compte 1 à 3 chiffres (225, 221, 33…)' };
    });

    validate(schema.accountSid, (ctx) => {
      if (ctx.valueOf(schema.providerType) !== 'Twilio') return null;

      const value = (ctx.value() ?? '').trim();

      if (!value) {
        return { kind: 'required', message: 'Le SID de compte Twilio est obligatoire' };
      }

      return value.length === 34
        ? null
        : { kind: 'pattern', message: 'Un SID de compte Twilio fait 34 caractères' };
    });

    /**
     * Le secret n'est exigé qu'à la PREMIÈRE configuration : ensuite un champ vide conserve celui
     * qui est stocké. Le cas de bascule est le changement de fournisseur — le serveur remet alors
     * `hasCredential` à faux, parce que la clé stockée appartenait au fournisseur précédent.
     */
    validate(schema.credential, (ctx) => {
      if (ctx.valueOf(schema.providerType) === 'Disabled') return null;
      if ((ctx.value() ?? '').trim()) return null;

      return this.hasUsableCredential()
        ? null
        : {
            kind: 'required',
            message: 'Ce fournisseur exige une clé : aucune n’est encore enregistrée',
          };
    });
  });

  public quotaModel = signal(SmsQuotaFormModel.fromSettings(null));

  public quotaForm = form(this.quotaModel, (schema) => {
    validate(schema.monthlyQuotaLimit, (ctx) => {
      const value = (ctx.value() ?? '').trim();
      if (!value) return null;

      const limit = Number(value);

      // Zéro est refusé côté serveur et le dire ici évite un 400 : il couperait tout message, y
      // compris un code de vérification, et celui qui veut ça désactive le canal.
      return Number.isInteger(limit) && limit >= 1
        ? null
        : {
            kind: 'pattern',
            message: 'Un plafond est un entier positif. Laissez vide pour ne pas en fixer ; '
                   + 'pour couper le canal, désactivez-le.',
          };
    });
  });

  // ── Ce que l'écran déduit ────────────────────────────────────────────────

  public readonly providerOptions = computed(() =>
    (this.settings()?.availableProviders ?? ['Disabled', 'Brevo', 'Twilio']).map((value) => ({
      value,
      label: PROVIDER_LABELS[value] ?? value,
    })),
  );

  public readonly selectedProvider = computed(() =>
    this.formSchema.providerType().value(),
  );

  public readonly isDisabled = computed(() => this.selectedProvider() === 'Disabled');
  public readonly isTwilio = computed(() => this.selectedProvider() === 'Twilio');
  public readonly isBrevo = computed(() => this.selectedProvider() === 'Brevo');

  /** Le fournisseur choisi diffère de l'enregistré : le secret stocké sera invalidé. */
  public readonly providerChanges = computed(
    () => (this.settings()?.providerType ?? 'Disabled') !== this.selectedProvider(),
  );

  public readonly hasUsableCredential = computed(
    () => (this.settings()?.hasCredential ?? false) && !this.providerChanges(),
  );

  /**
   * Ce que le fournisseur choisi attend comme expéditeur. Vient du SERVEUR (`senderIdHint`) et
   * n'est pas recopié ici : la règle appartient au fournisseur, et un écran qui l'aurait figée
   * dirait « 11 caractères maximum » après un passage à Twilio.
   *
   * Le DTO ne porte l'indication que du fournisseur ENREGISTRÉ ; tant que le choix à l'écran
   * diffère, on n'affiche rien plutôt qu'une indication fausse.
   */
  public readonly senderIdHint = computed(() =>
    this.providerChanges() ? null : (this.settings()?.senderIdHint ?? null),
  );

  public readonly quotaPercent = computed(() => {
    const limit = this.settings()?.monthlyQuotaLimit;
    if (!limit) return 0;
    return ((this.settings()?.currentMonthUsageCount ?? 0) / limit) * 100;
  });

  ngOnInit(): void {
    this._load();
  }

  public reload(): void {
    this._load();
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      this.isSaving.set(true);

      const saved = await firstValueFrom(
        this._api
          .updateSmsSettings({
            providerType: value.providerType,
            senderId: value.senderId.trim() || undefined,
            // Envoyé seulement pour Twilio : le serveur efface de toute façon celui d'un
            // fournisseur qui n'en a pas, et l'envoyer pour Brevo brouillerait l'audit.
            accountSid: this.isTwilio() ? value.accountSid.trim() || undefined : undefined,
            defaultCallingCode: value.defaultCallingCode.replace(/\D/g, '') || undefined,
            // Vide = conserver la clé stockée. Ne jamais envoyer une chaîne vide, qui serait
            // indistinguable d'une demande d'effacement.
            credential: value.credential.trim() || undefined,
          })
          .pipe(
            catchError((error: unknown) => {
              this._snackbar.error(
                'Enregistrement refusé', this._errorMessage(error as HttpErrorResponse));
              this.isSaving.set(false);
              return EMPTY;
            }),
          ),
      ).then(() => true, () => false);

      this.isSaving.set(false);
      if (!saved) return;

      this._snackbar.success(
        'Canal SMS enregistré',
        value.providerType === 'Disabled'
          ? 'Le canal est désactivé. L’expéditeur et la clé sont conservés.'
          : 'Les prochains messages partiront par ce fournisseur.',
      );

      // Rechargé plutôt que supposé : `canSend` et `hasCredential` sont calculés côté serveur, et
      // un 204 ne dit pas lesquels ont basculé.
      this._load();
    });
  }

  public handleQuotaSubmit(): void {
    submit(this.quotaForm, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const limit = value.monthlyQuotaLimit.trim();

      this.isSavingQuota.set(true);

      const saved = await firstValueFrom(
        this._api
          .setSmsMonthlyQuota({ monthlyQuotaLimit: limit ? Number(limit) : undefined })
          .pipe(
            catchError((error: unknown) => {
              this._snackbar.error(
                'Plafond refusé', this._errorMessage(error as HttpErrorResponse));
              this.isSavingQuota.set(false);
              return EMPTY;
            }),
          ),
      ).then(() => true, () => false);

      this.isSavingQuota.set(false);
      if (!saved) return;

      this._snackbar.success(
        'Plafond enregistré',
        limit ? `${limit} messages par mois.` : 'Aucun plafond : la dépense n’est pas bornée.',
      );

      this._load();
    });
  }

  private _load(): void {
    this.isLoading.set(true);
    this.loadError.set(false);

    this._api
      .getSmsSettings()
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((dto: SmsSettingsDto) => {
        this.settings.set(dto);
        this.model.set(SmsSettingsFormModel.fromSettings(dto));
        this.quotaModel.set(SmsQuotaFormModel.fromSettings(dto));
        this.isLoading.set(false);
      });
  }

  private _errorMessage(error: HttpErrorResponse): string {
    // `error.error` is `any` on the generated client, so each read is narrowed explicitly rather
    // than trusted: a server that answered HTML would otherwise put a document in a snackbar.
    // Les messages de validation du serveur sont en français et nomment le champ en cause : les
    // remonter tels quels vaut mieux qu'un message générique, qui cache exactement l'information
    // qui fait gagner une heure.
    const detail = error.error?.error ?? error.error?.detail;

    if (typeof detail === 'string' && detail.length > 0) return detail;

    const errors = error.error?.errors;
    if (errors && typeof errors === 'object') {
      const first = Object.values(errors).flat()[0];
      if (typeof first === 'string') return first;
    }

    return error.status === 403
      ? "Vous n'avez pas le droit de configurer les canaux de notification."
      : "La configuration n'a pas pu être enregistrée.";
  }
}

export default SmsParametrage;
