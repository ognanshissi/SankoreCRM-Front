import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, of, tap } from 'rxjs';
import {
  AgenciesApiService,
  AgencyDto,
  WhatsAppApiService,
  WhatsAppChannelDto,
} from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import {
  WhatsAppChannelDrawer,
  WhatsAppChannelDrawerData,
} from './whatsapp-channel-drawer';
import {
  WhatsAppSimulateInboundDrawer,
  WhatsAppSimulateInboundDrawerData,
} from './whatsapp-simulate-inbound-drawer';
import {
  channelStatusView,
  whatsAppCodeMessage,
  whatsAppErrorMessage,
} from './whatsapp-referential';

/**
 * La clé n'est jamais relue : le DTO n'en expose qu'un indice (`apiKeyHint`). Le champ part
 * donc toujours vide et n'est jamais pré-rempli — des points laisseraient croire à une valeur
 * récupérable.
 */
class ApiKeyFormModel {
  public apiKey!: string;

  public static instantiate(): ApiKeyFormModel {
    const m = new ApiKeyFormModel();
    m.apiKey = '';
    return m;
  }
}

const DRAWER_CONFIG = {
  width: '100%',
  height: '100%',
  panelClass: 'side-drawer-panel',
};

/**
 * Les numéros WhatsApp de l'institution (WA-FE-01).
 *
 * Le parcours est imposé par le serveur : un numéro naît inactif, reçoit sa clé 360dialog
 * (coffre, jamais relue), son webhook (jeton régénéré à chaque fois), puis un test réussi —
 * sans lequel l'activation répond 422 INTEGRATION_CONNECTION_NOT_HEALTHY. L'écran suit cet
 * ordre plutôt que de proposer tous les boutons comme s'ils se valaient.
 *
 * Pas d'Embedded Signup Meta pour l'instant : la saisie est manuelle.
 */
@Component({
  selector: 'whatsapp-settings-page',
  templateUrl: './whatsapp-settings-page.html',
  imports: [
    DatePipe,
    RouterLink,
    Anchor,
    Button,
    TasCard,
    TasIcon,
    TasTable,
    TasTag,
    TasFormField,
    TasLabel,
    TasHint,
    TasError,
    TasInput,
    FormRoot,
    FormField,
  ],
})
export class WhatsAppSettingsPage implements OnInit {
  private readonly _api = inject(WhatsAppApiService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _snackbar = inject(SnackbarService);

  public isLoading = signal(true);
  public loadError = signal<string | null>(null);
  public channels = signal<WhatsAppChannelDto[]>([]);
  private readonly _agencies = signal<AgencyDto[]>([]);

  /** Identifiant du numéro sur lequel une action est en cours (un seul à la fois par carte). */
  public busyId = signal<string | null>(null);
  public busyAction = signal<string | null>(null);

  /** Numéro dont le formulaire de clé API est ouvert. */
  public editingKeyId = signal<string | null>(null);

  /**
   * URL renvoyée par la configuration du webhook. Le DTO ne la porte pas (seulement
   * `hasWebhookToken`) : elle n'est connue qu'au moment de l'appel, et gardée pour la session.
   */
  public webhookUrls = signal<Record<string, string>>({});

  public tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [10, 20],
      totalElements: 0,
    },
  });

  public readonly agencyNames = computed(() => {
    const names: Record<string, string> = {};
    for (const agency of this._agencies()) {
      if (agency.id) names[agency.id] = agency.name || agency.code || '—';
    }
    return names;
  });

  public readonly agencyOptions = computed(() => [
    { label: 'Tout l’établissement', value: '' },
    ...this._agencies().map((agency) => ({
      label: `${agency.name ?? agency.code ?? '—'}${agency.isActive === false ? ' (désactivée)' : ''}`,
      value: agency.id ?? '',
    })),
  ]);

  public keyModel = signal(ApiKeyFormModel.instantiate());

  public keyForm = form(this.keyModel, (schema) => {
    validate(schema.apiKey, (ctx) =>
      (ctx.value() ?? '').trim()
        ? null
        : { kind: 'required', message: 'Collez la clé API 360dialog' },
    );
  });

  ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'WhatsApp Business' },
    ]);
    this._loadAgencies();
    this.reload();
  }

  public statusOf(channel: WhatsAppChannelDto) {
    return channelStatusView(channel);
  }

  /** Le détail du dernier test peut être un code serveur : on le traduit quand on le connaît. */
  public healthDetail(channel: WhatsAppChannelDto): string | null {
    return channel.lastHealthDetail ? whatsAppCodeMessage(channel.lastHealthDetail) : null;
  }

  public agencyLabel(channel: WhatsAppChannelDto): string {
    if (!channel.agencyId) return 'Tout l’établissement';
    return this.agencyNames()[channel.agencyId] ?? 'Agence inconnue';
  }

  public isBusy(channel: WhatsAppChannelDto, action?: string): boolean {
    if (this.busyId() !== channel.id) return false;
    return action ? this.busyAction() === action : true;
  }

  public reload(): void {
    this.isLoading.set(true);
    this.loadError.set(null);

    this._api
      .listWhatsAppChannels()
      .pipe(
        catchError((err: unknown) => {
          this.loadError.set(
            whatsAppErrorMessage(err, 'Les numéros WhatsApp n’ont pas pu être chargés.'),
          );
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((channels) => {
        this.channels.set(channels ?? []);
        this.tableConfig.update((c) => ({
          ...c,
          pagination: { ...c.pagination, totalElements: channels?.length ?? 0 },
        }));
        this.isLoading.set(false);
      });
  }

  // ── Création / édition ────────────────────────────────────────────────

  public openCreate(): void {
    this._openChannelDrawer(null);
  }

  public openEdit(channel: WhatsAppChannelDto): void {
    this._openChannelDrawer(channel);
  }

  private _openChannelDrawer(channel: WhatsAppChannelDto | null): void {
    const ref = this._sideDrawer.open<boolean, WhatsAppChannelDrawerData, WhatsAppChannelDrawer>(WhatsAppChannelDrawer, {
      ...DRAWER_CONFIG,
      data: { channel, agencyOptions: this.agencyOptions() },
    });
    ref.closed.subscribe((saved) => {
      if (saved) this.reload();
    });
  }

  // ── Clé API ───────────────────────────────────────────────────────────

  public startKeyEdit(channel: WhatsAppChannelDto): void {
    this.keyModel.set(ApiKeyFormModel.instantiate());
    this.editingKeyId.set(channel.id ?? null);
  }

  public cancelKeyEdit(): void {
    this.editingKeyId.set(null);
    this.keyModel.set(ApiKeyFormModel.instantiate());
  }

  public saveKey(channel: WhatsAppChannelDto): void {
    submit(this.keyForm, async (field) => {
      const value = field()?.value();
      if (!value || !channel.id) return;

      let saved = false;
      await firstValueFrom(
        this._api.setWhatsAppChannelApiKey(channel.id, { apiKey: value.apiKey.trim() }).pipe(
          tap(() => {
            saved = true;
          }),
          catchError((err: unknown) => {
            this._snackbar.error(
              'Clé refusée',
              whatsAppErrorMessage(err, 'La clé API n’a pas pu être enregistrée.'),
            );
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );

      if (!saved) return;

      this._snackbar.success(
        'Clé API enregistrée',
        'Elle est dans le coffre et ne sera plus jamais affichée. Testez maintenant la connexion.',
      );
      this.cancelKeyEdit();
      this.reload();
    });
  }

  // ── Test, activation ─────────────────────────────────────────────────

  public testConnection(channel: WhatsAppChannelDto): void {
    if (!channel.id) return;
    this._startBusy(channel, 'test');

    this._api
      .checkWhatsAppChannel(channel.id)
      .pipe(
        catchError((err: unknown) => {
          this._snackbar.error(
            'Test impossible',
            whatsAppErrorMessage(err, 'Le test n’a pas pu être lancé.'),
          );
          this._endBusy();
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        // Un 360dialog injoignable répond 200 avec `isHealthy: false` : c'est un verdict
        // enregistré sur le numéro, pas une panne de l'appel.
        if (result.isHealthy) {
          this._snackbar.success(
            'Connexion réussie',
            result.latencyMs != null
              ? `360dialog a répondu en ${result.latencyMs} ms.`
              : '360dialog a répondu.',
          );
        } else {
          this._snackbar.error(
            'Connexion en échec',
            result.detail ? whatsAppCodeMessage(result.detail) : '360dialog n’a pas répondu.',
          );
        }
        this._endBusy();
        // Le verdict est stocké sur le numéro (statut, dernier test, version) : on relit.
        this.reload();
      });
  }

  public activate(channel: WhatsAppChannelDto): void {
    if (!channel.id) return;
    this._startBusy(channel, 'toggle');

    this._api
      .activateWhatsAppChannel(channel.id)
      .pipe(
        catchError((err: unknown) => {
          this._snackbar.error(
            'Activation refusée',
            whatsAppErrorMessage(err, 'Le numéro n’a pas pu être activé.'),
          );
          this._endBusy();
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._snackbar.success('Numéro activé', 'Les agents peuvent écrire depuis ce numéro.');
        this._endBusy();
        this.reload();
      });
  }

  public confirmDeactivate(channel: WhatsAppChannelDto): void {
    this._confirm.confirm({
      title: 'Désactiver ce numéro ?',
      message:
        'Plus aucun message ne partira de ce numéro et les agents ne pourront plus l’utiliser. '
        + 'Sa configuration, sa clé et son historique sont conservés : il se réactive sans ressaisie.',
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Désactiver', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._deactivate(channel),
    });
  }

  private _deactivate(channel: WhatsAppChannelDto): void {
    if (!channel.id) return;
    this._startBusy(channel, 'toggle');

    this._api
      .deactivateWhatsAppChannel(channel.id)
      .pipe(
        catchError((err: unknown) => {
          this._snackbar.error(
            'Erreur',
            whatsAppErrorMessage(err, 'Le numéro n’a pas pu être désactivé.'),
          );
          this._endBusy();
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._snackbar.success('Numéro désactivé', 'Plus aucun message ne part de ce numéro.');
        this._endBusy();
        this.reload();
      });
  }

  // ── Webhook ──────────────────────────────────────────────────────────

  public confirmWebhook(channel: WhatsAppChannelDto): void {
    this._confirm.confirm({
      title: channel.hasWebhookToken ? 'Reconfigurer le webhook ?' : 'Configurer le webhook ?',
      message:
        'Un nouveau jeton secret est généré et 360dialog est configuré pour livrer les messages '
        + 'de ce numéro à cette plateforme. '
        + (channel.hasWebhookToken
          ? 'L’ancien jeton cesse aussitôt d’être accepté.'
          : 'Sans webhook, les réponses des clients n’arrivent pas dans le CRM.'),
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Configurer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._configureWebhook(channel),
    });
  }

  private _configureWebhook(channel: WhatsAppChannelDto): void {
    const id = channel.id;
    if (!id) return;
    this._startBusy(channel, 'webhook');

    this._api
      .configureWhatsAppWebhook(id)
      .pipe(
        catchError((err: unknown) => {
          this._snackbar.error(
            'Webhook non configuré',
            whatsAppErrorMessage(err, 'Le webhook n’a pas pu être configuré.'),
          );
          this._endBusy();
          return EMPTY;
        }),
      )
      .subscribe((response) => {
        if (response?.webhookUrl) {
          this.webhookUrls.update((urls) => ({ ...urls, [id]: response.webhookUrl! }));
        }
        this._snackbar.success(
          'Webhook configuré',
          '360dialog livrera désormais les messages de ce numéro à cette plateforme.',
        );
        this._endBusy();
        this.reload();
      });
  }

  // ── Simulation (développement) ──────────────────────────────────────

  public openSimulateInbound(channel: WhatsAppChannelDto): void {
    this._sideDrawer.open<boolean, WhatsAppSimulateInboundDrawerData, WhatsAppSimulateInboundDrawer>(
      WhatsAppSimulateInboundDrawer,
      { ...DRAWER_CONFIG, data: { channel } },
    );
  }

  // ── Interne ──────────────────────────────────────────────────────────

  private _startBusy(channel: WhatsAppChannelDto, action: string): void {
    this.busyId.set(channel.id ?? null);
    this.busyAction.set(action);
  }

  private _endBusy(): void {
    this.busyId.set(null);
    this.busyAction.set(null);
  }

  private _loadAgencies(): void {
    // `listAgencies(includeDeleted, page, pageSize)` : pageSize = 0 renvoie toutes les agences.
    // Une panne ici n'empêche pas l'écran : la carte dit « Agence inconnue » au lieu du nom.
    this._agenciesApi
      .listAgencies(false, 1, 0)
      .pipe(catchError(() => of(null)))
      .subscribe((result) => this._agencies.set(result?.items ?? []));
  }
}

export default WhatsAppSettingsPage;
