import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import {
  email,
  form,
  FormField,
  FormRoot,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map, of } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasSwitch } from '@talisoft/ui/switch';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import {
  NotificationSettingsApiService,
  NotificationSettingsDto,
  TestEmailResult,
} from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';

/**
 * `providerType` est une **chaîne libre** au contrat : aucune énumération n'est déclarée, donc aucune
 * valeur n'est vérifiable à la compilation. Ces cinq littéraux sont les seuls que le serveur
 * définisse — ne pas les deviner d'après les libellés affichés, et ne pas en inventer : `Platform`
 * et `Mailgun`, présents dans une version antérieure de cet écran, n'en font pas partie.
 *
 * Tous exigent un secret, et tous envoient réellement : il n'y a pas de fournisseur accepté puis
 * routé vers un émetteur factice.
 *
 * « L'envoi assuré par la plateforme » n'est pas une valeur de cette liste : c'est l'état d'un tenant
 * qui n'a pas encore choisi de fournisseur, que le serveur rapporte par
 * `NotificationSettingsDto.useDefaultPlatformProvider` — **dérivé côté serveur**, absent de
 * `UpdateNotificationSettingsCommand`, donc jamais envoyé et affiché en lecture seule.
 */
const EMAIL_PROVIDER_OPTIONS: { value: string; label: string }[] = [
  { value: 'Smtp', label: 'SMTP' },
  { value: 'Brevo', label: 'Brevo' },
  { value: 'SendGrid', label: 'SendGrid' },
  { value: 'AmazonSes', label: 'Amazon SES' },
  { value: 'Postmark', label: 'Postmark' },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Le champ `credential` n'est **jamais** relu : le DTO n'expose que `hasCredential`. Le modèle part
 * donc toujours vide, et un champ vide à l'envoi signifie « conserver le secret stocké » — ne pas
 * pré-remplir de points, qui feraient croire à une valeur récupérable et rendraient la ressaisie
 * obligatoire à chaque enregistrement.
 */
class EmailSettingsFormModel {
  public providerType!: string;
  public fromEmail!: string;
  public fromName!: string;
  public replyToEmail!: string;
  public sendingDomain!: string;
  public credential!: string;
  public smtpHost!: string;
  /** Chaîne, comme partout dans ce repo : l'input rend du texte, la conversion se fait à l'envoi. */
  public smtpPort!: string;
  public smtpUsername!: string;
  public smtpUseSsl!: boolean;
  public smtpUseStartTls!: boolean;

  public static fromSettings(dto: NotificationSettingsDto | null): EmailSettingsFormModel {
    const m = new EmailSettingsFormModel();
    // Vide tant que rien n'est configuré : le tenant est alors sur l'envoi plateforme, qui n'est
    // pas une valeur de `providerType`.
    m.providerType = dto?.providerType ?? '';
    m.fromEmail = dto?.fromEmail ?? '';
    m.fromName = dto?.fromName ?? '';
    m.replyToEmail = dto?.replyToEmail ?? '';
    m.sendingDomain = dto?.sendingDomain ?? '';
    m.credential = '';
    m.smtpHost = dto?.smtpHost ?? '';
    m.smtpPort = dto?.smtpPort != null ? String(dto.smtpPort) : '';
    m.smtpUsername = dto?.smtpUsername ?? '';
    m.smtpUseSsl = dto?.smtpUseSsl ?? false;
    m.smtpUseStartTls = dto?.smtpUseStartTls ?? false;
    return m;
  }
}

/**
 * Le quota a son propre endpoint (`PATCH /notification-settings/quota`) et sa propre permission
 * (`notification:settings:quota`) : il est isolé dans son formulaire, et non fondu dans celui de la
 * configuration, pour qu'un enregistrement de l'un n'emporte pas l'autre.
 */
class QuotaFormModel {
  /** Chaîne : l'input rend du texte. Vide = pas de limite. */
  public monthlyQuotaLimit!: string;

  public static fromSettings(dto: NotificationSettingsDto | null): QuotaFormModel {
    const m = new QuotaFormModel();
    m.monthlyQuotaLimit = dto?.monthlyQuotaLimit != null ? String(dto.monthlyQuotaLimit) : '';
    return m;
  }
}

class TestEmailFormModel {
  public recipientEmail!: string;

  public static instantiate(): TestEmailFormModel {
    const m = new TestEmailFormModel();
    m.recipientEmail = '';
    return m;
  }
}

/**
 * Paramétrage du fournisseur e-mail du tenant.
 *
 * | Route | Permission |
 * |---|---|
 * | `GET /notification-settings`          | `notification:settings:read` |
 * | `PUT /notification-settings`          | `notification:settings:manage` |
 * | `POST /notification-settings/test-send` | `notification:settings:manage` |
 * | `PATCH /notification-settings/quota`  | `notification:settings:quota` |
 *
 * C'est un **formulaire**, pas une liste : la règle « toute liste passe par `tas-table` » ne s'y
 * applique pas, et introduire une table pour afficher trois valeurs de statut serait un contresens.
 */
@Component({
  selector: 'notification-parametrage',
  templateUrl: './notification-parametrage.html',
  imports: [
    DecimalPipe,
    TimeagoPipe,
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    Button,
    TasSwitch,
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
export class NotificationParametrage implements OnInit {
  private readonly _permissions = inject(PermissionsService);
  public readonly canManageSettings = this._permissions.can('notification:settings:manage');
  public readonly canSetQuota = this._permissions.can('notification:settings:quota');

  private readonly _api = inject(NotificationSettingsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);

  public readonly providerOptions = EMAIL_PROVIDER_OPTIONS;

  public isLoading = signal(true);
  public loadError = signal(false);
  public settings = signal<NotificationSettingsDto | null>(null);

  // ——— Configuration du fournisseur ———
  public model = signal(EmailSettingsFormModel.fromSettings(null));
  public formSchema = form(this.model, (schema) => {
    // Le fournisseur vaut toujours l'un des cinq littéraux : « plateforme » en est un, ce n'est pas
    // une absence de choix.
    required(schema.providerType, { message: 'Choisissez un fournisseur' });

    validate(schema.fromEmail, (ctx) => {
      const value = (ctx.value() ?? '').trim();
      if (!value) return null;
      return EMAIL_PATTERN.test(value)
        ? null
        : { kind: 'email', message: "Renseignez une adresse e-mail valide" };
    });

    validate(schema.replyToEmail, (ctx) => {
      const value = (ctx.value() ?? '').trim();
      if (!value) return null;
      return EMAIL_PATTERN.test(value)
        ? null
        : { kind: 'email', message: "Renseignez une adresse e-mail valide" };
    });

    // L'hôte n'est obligatoire que pour SMTP : les autres fournisseurs n'en ont pas.
    validate(schema.smtpHost, (ctx) => {
      const isSmtp = ctx.valueOf(schema.providerType) === 'Smtp';
      const value = (ctx.value() ?? '').trim();
      if (!isSmtp || value) return null;
      return { kind: 'required', message: "L'hôte SMTP est obligatoire" };
    });

    // Port facultatif : omis, le serveur le déduit du mode de chiffrement. On ne refuse donc que
    // ce qui n'est pas un port.
    validate(schema.smtpPort, (ctx) => {
      const value = (ctx.value() ?? '').trim();
      if (!value) return null;
      const port = Number(value);
      return Number.isInteger(port) && port >= 1 && port <= 65535
        ? null
        : { kind: 'pattern', message: 'Le port doit être un entier entre 1 et 65535' };
    });

    // SSL et STARTTLS sont mutuellement exclusifs côté serveur : le dire ici évite un 400.
    validate(schema.smtpUseStartTls, (ctx) => {
      const ssl = ctx.valueOf(schema.smtpUseSsl);
      const startTls = ctx.value();
      return ssl && startTls
        ? {
            kind: 'exclusive',
            message: 'SSL et STARTTLS ne peuvent pas être activés ensemble',
          }
        : null;
    });

    /**
     * Les cinq fournisseurs exigent un secret, mais seulement à la **première** configuration :
     * ensuite, un champ vide conserve celui qui est stocké. Le cas de bascule est
     * `providerChangesProvider()` — changer de fournisseur remet `hasCredential` à faux côté
     * serveur, parce que le secret stocké appartenait au fournisseur précédent.
     */
    validate(schema.credential, (ctx) => {
      if (!ctx.valueOf(schema.providerType)) return null;
      if ((ctx.value() ?? '').trim()) return null;
      return this.hasUsableCredential()
        ? null
        : {
            kind: 'required',
            message: 'Ce fournisseur exige un secret : aucun n’est encore enregistré',
          };
    });
  });

  public isSaving = signal(false);

  public readonly isSmtp = computed(() => this.formSchema.providerType().value() === 'Smtp');

  /** Le fournisseur choisi diffère de celui qui est enregistré : le secret stocké sera invalidé. */
  public readonly providerChanges = computed(
    () => (this.settings()?.providerType ?? '') !== this.formSchema.providerType().value(),
  );

  /**
   * Un secret utilisable existe pour le fournisseur **choisi**. Changer de fournisseur remet
   * `hasCredential` à faux côté serveur : tant que le choix diffère de l'enregistré, on considère
   * qu'il n'y en a pas, sinon l'écran laisserait enregistrer une configuration muette.
   */
  public readonly hasUsableCredential = computed(
    () => (this.settings()?.hasCredential ?? false) && !this.providerChanges(),
  );

  // ——— Envoi de test ———
  public testModel = signal(TestEmailFormModel.instantiate());
  public testFormSchema = form(this.testModel, (schema) => {
    required(schema.recipientEmail, { message: 'Le destinataire est obligatoire' });
    email(schema.recipientEmail, { message: 'Renseignez une adresse e-mail valide' });
  });
  public testResult = signal<TestEmailResult | null>(null);

  // ——— Quota ———
  public quotaModel = signal(QuotaFormModel.fromSettings(null));
  public quotaFormSchema = form(this.quotaModel, (schema) => {
    required(schema.monthlyQuotaLimit, { message: 'Renseignez une limite, ou supprimez-la' });
    validate(schema.monthlyQuotaLimit, (ctx) => {
      const value = (ctx.value() ?? '').trim();
      if (!value) return null;
      const limit = Number(value);
      return Number.isInteger(limit) && limit >= 0
        ? null
        : { kind: 'pattern', message: 'La limite doit être un entier positif' };
    });
  });
  public isSavingQuota = signal(false);

  public readonly quotaLimit = computed(() => this.settings()?.monthlyQuotaLimit ?? null);
  public readonly currentUsage = computed(() => this.settings()?.currentMonthUsageCount ?? 0);
  public readonly quotaPercent = computed(() => {
    const limit = this.quotaLimit();
    if (!limit) return 0;
    return Math.min(100, (this.currentUsage() / limit) * 100);
  });
  public readonly quotaReached = computed(() => {
    const limit = this.quotaLimit();
    return !!limit && this.currentUsage() >= limit;
  });

  ngOnInit(): void {
    this._load();
  }

  /**
   * `tas-switch` n'implémente pas `FormValueControl` : il ne peut pas être relié par `[formField]`.
   * On écrit donc directement dans le signal du champ, qui reste la source de vérité — et non dans
   * un signal parallèle qui divergerait du formulaire.
   */
  public setSmtpUseSsl(checked: boolean): void {
    this.formSchema.smtpUseSsl().value.set(checked);
    // Les deux modes s'excluent : activer l'un retire l'autre, plutôt que de laisser
    // l'utilisateur buter sur le message de validation.
    if (checked) this.formSchema.smtpUseStartTls().value.set(false);
  }

  public setSmtpUseStartTls(checked: boolean): void {
    this.formSchema.smtpUseStartTls().value.set(checked);
    if (checked) this.formSchema.smtpUseSsl().value.set(false);
  }

  public save(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const credential = value.credential.trim();
      const port = value.smtpPort.trim();

      const outcome = await firstValueFrom(
        this._api
          .updateNotificationSettings({
            // L'un des cinq littéraux définis, garanti non vide par le validateur `required`.
            providerType: value.providerType,
            fromEmail: value.fromEmail.trim() || null,
            fromName: value.fromName.trim() || null,
            replyToEmail: value.replyToEmail.trim() || null,
            sendingDomain: value.sendingDomain.trim() || null,
            // Champ vide = conserver le secret stocké. On envoie donc `null`, jamais une chaîne
            // vide, qui l'écraserait : un admin changeant juste l'expéditeur effacerait le mot de
            // passe.
            credential: credential || null,
            smtpHost: value.smtpHost.trim() || null,
            // Port omis : le serveur le déduit du mode de chiffrement.
            smtpPort: port ? Number(port) : null,
            smtpUsername: value.smtpUsername.trim() || null,
            smtpUseSsl: value.smtpUseSsl,
            smtpUseStartTls: value.smtpUseStartTls,
            // `useDefaultPlatformProvider` est dérivé serveur et absent de la commande : ne pas
            // l'envoyer. `resourceType`/`resourceId` sont `readOnly` au contrat.
          })
          .pipe(
            // Le PUT répond 204 : le corps est vide en succès comme en échec. Sans ce `map`, rien
            // ne distinguerait les deux et l'écran afficherait « Enregistré » sur un refus.
            map(() => ({ ok: true })),
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error('Erreur', this._apiErrorMessage(error, 'Sauvegarde échouée.'));
              // `of(...)` et non `EMPTY` : `firstValueFrom` sur un flux vide rejette avec une
              // EmptyError, qui ferait échouer la soumission après l'affichage du message.
              return of({ ok: false });
            }),
          ),
      );

      if (!outcome.ok) return;

      this._snackbar.success('Enregistré', 'Configuration e-mail mise à jour.');
      // On recharge pour lire ce que le serveur a réellement retenu : `hasCredential`, le port
      // qu'il a déduit, et le fournisseur effectif.
      this._load({ keepTestResult: true });
    });
  }

  /**
   * `POST /notification-settings/test-send` répond **HTTP 200 même en échec** : le refus du
   * fournisseur est dans `TestEmailResult.delivered` / `.error`. Un `catchError` seul afficherait
   * donc « envoyé » sur une clé d'API invalide.
   */
  public sendTest(): void {
    this.testResult.set(null);

    submit(this.testFormSchema, async (field) => {
      const recipientEmail = (field()?.value()?.recipientEmail ?? '').trim();

      const result = await firstValueFrom(
        this._api.sendTestEmail({ recipientEmail }).pipe(
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error(
              'Erreur',
              this._apiErrorMessage(error, "L'envoi de test n'a pas pu être lancé."),
            );
            return of(null);
          }),
        ),
      );

      if (!result) return;

      this.testResult.set(result);

      if (result.delivered) {
        const provider = result.providerType?.trim();
        this._snackbar.success(
          'Test accepté',
          provider
            ? `Le fournisseur ${provider} a accepté le message pour ${recipientEmail}.`
            : `Le message pour ${recipientEmail} a été accepté.`,
        );
      } else {
        // Pas de `warning` sur SnackbarService : `error` est juste, c'est une anomalie à corriger.
        this._snackbar.error(
          'Test refusé',
          result.error?.trim() || "Le fournisseur a refusé le message, sans préciser pourquoi.",
        );
      }
    });
  }

  public saveQuota(): void {
    submit(this.quotaFormSchema, async (field) => {
      const raw = (field()?.value()?.monthlyQuotaLimit ?? '').trim();
      if (!raw) return;
      const limit = Number(raw);
      this._patchQuota(limit, `Limite mensuelle fixée à ${limit} envoi(s).`);
    });
  }

  public confirmClearQuota(): void {
    this._confirmDialog.confirm({
      title: 'Supprimer la limite mensuelle',
      message:
        "Les envois ne seront plus plafonnés pour ce tenant. Continuer ?",
      closable: true,
      acceptButtonProps: { label: 'Supprimer la limite', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      // `monthlyQuotaLimit: null` efface la limite, au contrat.
      accept: () => this._patchQuota(null, "Les envois ne sont plus plafonnés."),
    });
  }

  public reloadSettings(): void {
    this._load();
  }

  private _patchQuota(monthlyQuotaLimit: number | null, successMessage: string): void {
    this.isSavingQuota.set(true);
    this._api
      .setMonthlyEmailQuota({ monthlyQuotaLimit })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Erreur',
            this._apiErrorMessage(error, "Le quota n'a pas été mis à jour."),
          );
          this.isSavingQuota.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.isSavingQuota.set(false);
        this._snackbar.success('Quota mis à jour', successMessage);
        // Le PATCH répond 204 : la consommation du mois et la limite retenue se relisent.
        this._load({ keepTestResult: true });
      });
  }

  private _load(options?: { keepTestResult?: boolean }): void {
    this.isLoading.set(true);
    this.loadError.set(false);
    if (!options?.keepTestResult) this.testResult.set(null);

    this._api
      .getNotificationSettings()
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Erreur',
            this._apiErrorMessage(error, 'Impossible de charger la configuration e-mail.'),
          );
          this.loadError.set(true);
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((dto: NotificationSettingsDto) => {
        this.settings.set(dto);
        // Le modèle est repoussé après la réponse : le secret repart vide, et le port affiché est
        // celui que le serveur a retenu, pas celui qui a été saisi.
        this.model.set(EmailSettingsFormModel.fromSettings(dto));
        this.quotaModel.set(QuotaFormModel.fromSettings(dto));
        this.isLoading.set(false);
      });
  }

  /**
   * Remonte le message du serveur plutôt qu'un texte générique : sur ces réglages, le refus (hôte
   * injoignable, secret rejeté, modes de chiffrement incompatibles) n'est diagnosticable que par lui.
   */
  private _apiErrorMessage(error: HttpErrorResponse, fallback: string): string {
    const body = error?.error;
    if (typeof body === 'string' && body.trim()) return body.trim();

    const validationErrors = body?.errors as Record<string, string[] | string> | undefined;
    if (validationErrors && typeof validationErrors === 'object') {
      const messages = Object.entries(validationErrors).map(([path, value]) => {
        const text = Array.isArray(value) ? value.join('. ') : String(value);
        return path ? `${path} : ${text}` : text;
      });
      if (messages.length > 0) return messages.join(' ; ');
    }
    if (body?.detail) return String(body.detail);
    if (body?.title) return String(body.title);
    if (error?.status === 403) return "Vous n'avez pas la permission de modifier ces réglages.";
    if (error?.status === 0) return 'Le serveur est injoignable.';
    return fallback;
  }
}

export default NotificationParametrage;
