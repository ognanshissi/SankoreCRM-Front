import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { FormField, FormRoot, form, maxLength, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, finalize, firstValueFrom, forkJoin, map, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SideDrawerService, TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import {
  ClientComplaintDetailDto,
  ClientComplaintsApiService,
  ClientDetailDto,
  ClientsApiService,
  ConnectedMailboxApiService,
  UsersApiService,
  WhatsAppApiService,
} from '@sankore/crm-api';
import { ClientWhatsAppDrawer, ClientWhatsAppDrawerData, PermissionsService } from '@sankore/crm/common';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { MailComposeDrawer, MailComposeDrawerData } from '@sankore/crm/tasks';
import {
  complaintCategoryLabel,
  complaintChannelLabel,
  complaintStatus,
  formatComplaintDate,
  isOpenComplaint,
} from './client-complaints.labels';
import { isMergedStatus } from '../../models/client-labels';

export interface ClientComplaintDetailDrawerData {
  clientId: string;
  complaintId: string;
  canManage: boolean;
}

type Mode = 'view' | 'resolve' | 'close';

/**
 * Un échange de la réclamation : un message WhatsApp ou un e-mail. Le texte d'un e-mail n'est connu
 * que de la personne dont c'est la boîte ; les autres voient quand, dans quel sens et de qui.
 */
interface Exchange {
  key: string;
  channel: 'whatsapp' | 'mail';
  outbound: boolean;
  at: string;
  who: string | null;
  text: string | null;
  /** Un message WhatsApp que le fournisseur a refusé : le client ne l'a jamais reçu. */
  failed: boolean;
}

class ResolveFormModel {
  public response!: string;

  public static instantiate(): ResolveFormModel {
    const m = new ResolveFormModel();
    m.response = '';
    return m;
  }
}

class CloseFormModel {
  public reason!: string;

  public static instantiate(): CloseFormModel {
    const m = new CloseFormModel();
    m.reason = '';
    return m;
  }
}

/**
 * Le détail d'une réclamation et son traitement (2026-10-26) : accuser réception, répondre, ou
 * clôturer sans réponse (retirée par le client, hors périmètre). La liste se recharge à chaque
 * fermeture, quelle qu'en soit la manière : un tiroir fermé d'un clic à côté ne renvoie rien.
 */
@Component({
  selector: 'client-complaint-detail-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasIcon,
    TasSpinner,
    TasTag,
    Button,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-lg font-semibold text-slate-800">Réclamation {{ complaint()?.summary?.reference ?? '' }}</span>
          @if (complaint(); as c) {
            <tas-tag [severity]="status().severity">{{ status().label }}</tas-tag>
            @if (c.summary?.isOverdue) {
              <tas-tag severity="error">En retard</tas-tag>
            }
          }
        </div>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (isLoading()) {
          <div class="flex justify-center py-16"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
        } @else if (complaint(); as c) {
          <div class="flex flex-col gap-5">
            <div>
              <p class="text-base font-medium text-slate-800">{{ c.summary?.subject }}</p>
              <p class="mt-0.5 text-sm text-slate-500">
                {{ categoryLabel() }} · {{ channelLabel() }}
                @if (c.summary?.filedBySystem) {
                  · enregistrée par le bot WhatsApp
                }
              </p>
            </div>

            <dl class="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt class="text-xs text-slate-500">Reçue le</dt>
                <dd class="text-slate-800">{{ date(c.summary?.receivedAt) }}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">Attribuée à</dt>
                <dd class="text-slate-800">{{ assigneeName() ?? (c.summary?.assignedTo ? '—' : 'Personne') }}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">Accusé de réception</dt>
                <dd class="text-slate-800">
                  @if (c.summary?.acknowledgedAt) {
                    Fait le {{ date(c.summary.acknowledgedAt) }}
                  } @else if (c.summary?.closedAt) {
                    Non fait
                  } @else {
                    Attendu au plus tard le {{ date(c.summary?.acknowledgementDueAt) }}
                  }
                </dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">Réponse</dt>
                <dd class="text-slate-800">
                  @if (c.summary?.resolvedAt) {
                    Donnée le {{ date(c.summary.resolvedAt) }}
                  } @else if (c.summary?.closedAt) {
                    Clôturée le {{ date(c.summary.closedAt) }}
                  } @else {
                    Attendue au plus tard le {{ date(c.summary?.resolutionDueAt) }}
                  }
                </dd>
              </div>
            </dl>

            <div>
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Ce que dit le client</p>
              <p class="mt-1 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">{{ c.description || '—' }}</p>
              @if (c.sourceConversationId) {
                <a
                  [routerLink]="['/leads/whatsapp']"
                  [queryParams]="{ conversation: c.sourceConversationId }"
                  (click)="dismiss()"
                  class="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <tas-icon iconName="feather:message-circle" style="font-size:12px"></tas-icon>
                  Voir la conversation WhatsApp
                </a>
              }
            </div>

            <section aria-label="Échanges avec le client" class="flex flex-col gap-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Échanges avec le client</p>
                @if (canAct()) {
                  <div class="flex gap-2">
                    @if (canWhatsApp()) {
                      <button tas-outlined-button color="primary" type="button" class="text-xs" (click)="openWhatsApp()">
                        <tas-icon iconName="feather:message-circle" style="font-size:13px"></tas-icon> WhatsApp
                      </button>
                    }
                    @if (mailAddress(); as masked) {
                      <button tas-outlined-button color="primary" type="button" class="text-xs" [title]="'Écrire à ' + masked" (click)="openMail(masked)">
                        <tas-icon iconName="feather:mail" style="font-size:13px"></tas-icon> E-mail
                      </button>
                    }
                  </div>
                }
              </div>
              <!-- Un fil, en bulles comme les autres fils de l'application (exception tas-table des fils). -->
              <div class="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                @for (x of exchanges(); track x.key) {
                  <div class="max-w-[90%] rounded-lg px-3 py-2 text-sm shadow-sm"
                       [class]="x.outbound ? 'ml-auto bg-primary/10' : 'mr-auto bg-white'">
                    <p class="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <tas-icon [iconName]="x.channel === 'whatsapp' ? 'feather:message-circle' : 'feather:mail'" style="font-size:11px"></tas-icon>
                      @if (x.failed) { <span class="text-red-700">Non envoyé</span> } @else { {{ x.outbound ? 'Envoyé' : 'Reçu' }} }@if (x.who) { · {{ x.who }} } · {{ date(x.at) }}
                    </p>
                    @if (x.text) {
                      <p class="mt-0.5 whitespace-pre-line text-slate-800">{{ x.text }}</p>
                      @if (x.outbound && !x.failed && canAct()) {
                        <button type="button" class="mt-1 text-xs text-primary hover:underline" (click)="useAsResponse(x)">
                          Utiliser comme réponse officielle
                        </button>
                      }
                    } @else {
                      <p class="mt-0.5 text-xs italic text-slate-500">E-mail d’une autre boîte : son contenu n’est visible que de son propriétaire.</p>
                    }
                  </div>
                } @empty {
                  <p class="py-2 text-center text-sm text-slate-500">
                    Aucun échange enregistré sur cette réclamation. Les e-mails apparaissent après la synchronisation de la boîte.
                  </p>
                }
              </div>
            </section>

            @if (c.response) {
              <div>
                <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Réponse donnée</p>
                <p class="mt-1 whitespace-pre-wrap rounded-lg border border-slate-200 p-3 text-sm text-slate-800">{{ c.response }}</p>
              </div>
            }

            @if (c.closureReason) {
              <div>
                <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Motif de clôture</p>
                <p class="mt-1 text-sm text-slate-800">{{ c.closureReason }}</p>
              </div>
            }

            @if (mode() === 'resolve') {
              <form [formRoot]="resolveForm" class="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
                <tas-form-field>
                  <tas-label>Réponse donnée au client <span class="text-functional-error">*</span></tas-label>
                  <textarea tasInput rows="5" [formField]="resolveForm.response"></textarea>
                  <tas-hint>Enregistrer la réponse vaut aussi accusé de réception s'il n'a pas été fait.</tas-hint>
                  @if (resolveForm.response().touched() && resolveForm.response().invalid()) {
                    <tas-error>{{ resolveForm.response().errors()[0].message }}</tas-error>
                  }
                </tas-form-field>
              </form>
            } @else if (mode() === 'close') {
              <form [formRoot]="closeForm" class="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
                <tas-form-field>
                  <tas-label>Motif de clôture <span class="text-functional-error">*</span></tas-label>
                  <textarea tasInput rows="3" placeholder="Retirée par le client" [formField]="closeForm.reason"></textarea>
                  <tas-hint>Une clôture n'est pas une réponse : elle est comptée à part dans le registre.</tas-hint>
                  @if (closeForm.reason().touched() && closeForm.reason().invalid()) {
                    <tas-error>{{ closeForm.reason().errors()[0].message }}</tas-error>
                  }
                </tas-form-field>
              </form>
            }
          </div>
        } @else {
          <p class="py-10 text-center text-sm text-slate-500">La réclamation n'a pas pu être chargée.</p>
        }
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex flex-wrap items-center justify-end gap-2">
          @switch (mode()) {
            @case ('resolve') {
              <button tas-outlined-button color="primary" type="button" (click)="mode.set('view')">Retour</button>
              <button
                tas-raised-button
                color="primary"
                type="button"
                [disabled]="resolveForm().invalid() || resolveForm().submitting()"
                [isLoading]="resolveForm().submitting()"
                (click)="resolve()"
              >
                Enregistrer la réponse
              </button>
            }
            @case ('close') {
              <button tas-outlined-button color="primary" type="button" (click)="mode.set('view')">Retour</button>
              <button
                tas-raised-button
                color="warn"
                type="button"
                [disabled]="closeForm().invalid() || closeForm().submitting()"
                [isLoading]="closeForm().submitting()"
                (click)="closeComplaint()"
              >
                Clôturer
              </button>
            }
            @default {
              <button tas-outlined-button color="primary" type="button" (click)="dismiss()">Fermer</button>
              @if (canAct()) {
                <button tas-text-button color="warn" type="button" (click)="mode.set('close')">Clôturer sans réponse</button>
                @if (complaint()?.summary?.status === 'Received') {
                  <button tas-outlined-button color="primary" type="button" [isLoading]="isAcknowledging()" (click)="acknowledge()">
                    Accuser réception
                  </button>
                }
                <button tas-raised-button color="primary" type="button" (click)="mode.set('resolve')">Répondre</button>
              }
            }
          }
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ClientComplaintDetailDrawer implements OnInit {
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _api = inject(ClientComplaintsApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _whatsAppApi = inject(WhatsAppApiService);
  private readonly _mailApi = inject(ConnectedMailboxApiService);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _permissions = inject(PermissionsService);
  public readonly data = inject<ClientComplaintDetailDrawerData>(DIALOG_DATA);

  public readonly canWhatsApp = this._permissions.can('WhatsApp.Send');
  private readonly _canMail = this._permissions.can('ConnectedAccounts.Use');
  public readonly client = signal<ClientDetailDto | null>(null);
  public readonly exchanges = signal<Exchange[]>([]);

  /** L'adresse masquée à qui écrire, ou null — même règle que le bouton E-mail de la fiche client. */
  public readonly mailAddress = computed(() => {
    const client = this.client();
    if (!this._canMail() || !client || client.processingRestrictedAt || isMergedStatus(client.status)) return null;
    const emails = (client.contactPoints ?? [])
      .filter((cp) => cp.type === 'Email' && cp.isActive)
      .sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary));
    return emails[0] ? emails[0].valueMasked || 'adresse du dossier' : null;
  });

  private readonly _clientName = computed(() => this.client()?.displayName ?? this.client()?.clientNumber ?? 'Client');

  public readonly complaint = signal<ClientComplaintDetailDto | null>(null);
  public readonly assigneeName = signal<string | null>(null);
  public readonly isLoading = signal(true);
  public readonly isAcknowledging = signal(false);
  public readonly mode = signal<Mode>('view');

  public readonly status = computed(() => complaintStatus(this.complaint()?.summary?.status));
  public readonly categoryLabel = computed(() => complaintCategoryLabel(this.complaint()?.summary?.category));
  public readonly channelLabel = computed(() => complaintChannelLabel(this.complaint()?.summary?.channel));
  public readonly canAct = computed(() => this.data.canManage && isOpenComplaint(this.complaint()?.summary?.status));

  public readonly resolveModel = signal(ResolveFormModel.instantiate());
  public readonly resolveForm = form(this.resolveModel, (schema) => {
    required(schema.response, { message: 'La réponse est obligatoire' });
  });

  public readonly closeModel = signal(CloseFormModel.instantiate());
  public readonly closeForm = form(this.closeModel, (schema) => {
    required(schema.reason, { message: 'Le motif est obligatoire' });
    maxLength(schema.reason, 500, { message: '500 caractères au plus' });
  });

  public ngOnInit(): void {
    this._load();
    this._loadExchanges();
    this._clientsApi.getClient(this.data.clientId).pipe(catchError(() => EMPTY)).subscribe((client) => this.client.set(client));
  }

  public openWhatsApp(): void {
    this._drawer
      .open<boolean, ClientWhatsAppDrawerData, ClientWhatsAppDrawer>(ClientWhatsAppDrawer, {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: {
          clientId: this.data.clientId,
          clientName: this._clientName(),
          complaintId: this.data.complaintId,
          complaintReference: this.complaint()?.summary?.reference ?? null,
        },
      })
      .closed.subscribe(() => this._loadExchanges());
  }

  public openMail(maskedEmail: string): void {
    const reference = this.complaint()?.summary?.reference;
    this._drawer
      .open<boolean, MailComposeDrawerData, MailComposeDrawer>(MailComposeDrawer, {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: {
          mode: 'new',
          client: { id: this.data.clientId, name: this._clientName(), maskedEmail },
          context: { clientId: this.data.clientId },
          subject: reference ? `Votre réclamation ${reference}` : undefined,
          complaintId: this.data.complaintId,
        },
      })
      .closed.subscribe(() => this._loadExchanges());
  }

  /** Ce qu'on a écrit au client devient la réponse officielle — relue avant d'être enregistrée. */
  public useAsResponse(exchange: Exchange): void {
    this.resolveForm().reset(Object.assign(new ResolveFormModel(), { response: exchange.text ?? '' }));
    this.mode.set('resolve');
  }

  public date(value: string | null | undefined): string {
    return formatComplaintDate(value);
  }

  public acknowledge(): void {
    this.isAcknowledging.set(true);
    this._api
      .acknowledgeClientComplaint(this.data.clientId, this.data.complaintId)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._fail(err);
          return EMPTY;
        }),
        finalize(() => this.isAcknowledging.set(false)),
      )
      .subscribe(() => {
        this._snackbar.success('Accusé de réception enregistré', 'La réclamation est prise en charge.');
        this._load();
      });
  }

  public resolve(): void {
    submit(this.resolveForm, async (field) => {
      try {
        await firstValueFrom(
          this._api.resolveClientComplaint(this.data.clientId, this.data.complaintId, {
            response: field().value().response.trim(),
          }),
        );
        this._snackbar.success('Réponse enregistrée', 'La réclamation est résolue.');
        this.mode.set('view');
        this._load();
      } catch (err) {
        this._fail(err);
      }
      return undefined;
    });
  }

  public closeComplaint(): void {
    submit(this.closeForm, async (field) => {
      try {
        await firstValueFrom(
          this._api.closeClientComplaint(this.data.clientId, this.data.complaintId, {
            reason: field().value().reason.trim(),
          }),
        );
        this._snackbar.success('Réclamation clôturée', 'Elle reste dans le registre, comptée comme clôturée.');
        this.mode.set('view');
        this._load();
      } catch (err) {
        this._fail(err);
      }
      return undefined;
    });
  }

  public dismiss(): void {
    this._dialogRef.close(true);
  }

  private _load(): void {
    this.isLoading.set(true);
    this._api
      .getClientComplaint(this.data.clientId, this.data.complaintId)
      .pipe(
        catchError(() => of(null)),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((complaint) => {
        this.complaint.set(complaint);
        const assignee = complaint?.summary?.assignedTo;
        if (assignee && this.assigneeName() === null) {
          // Lire un collègue demande un droit que tous les rôles n'ont pas : sans lui, « — ».
          this._usersApi
            .getUser(assignee)
            .pipe(catchError(() => EMPTY))
            .subscribe((user) => this.assigneeName.set(user.fullName?.trim() || user.email?.trim() || null));
        }
      });
  }

  /** WhatsApp (si le droit le permet) et e-mails, du plus récent au plus ancien. */
  private _loadExchanges(): void {
    const whatsapp = this.canWhatsApp()
      ? this._whatsAppApi.listClientWhatsAppMessages(this.data.clientId, this.data.complaintId, undefined, 100).pipe(
          map((page) => page.items ?? []),
          catchError(() => of([])),
        )
      : of([]);
    const mails = this._mailApi.listComplaintMails(this.data.clientId, this.data.complaintId).pipe(catchError(() => of([])));

    forkJoin({ whatsapp, mails }).subscribe(({ whatsapp, mails }) => {
      const list: Exchange[] = [
        ...whatsapp.map((m) => ({
          key: `w-${m.id}`,
          channel: 'whatsapp' as const,
          outbound: m.direction === 'Outbound',
          at: m.occurredAt ?? '',
          who: m.authorName ?? null,
          text: m.body ?? null,
          failed: m.status === 'Failed',
        })),
        ...mails.map((m, i) => ({
          key: `m-${m.messageId ?? i}-${m.sentAt}`,
          channel: 'mail' as const,
          outbound: m.direction === 'Sent',
          at: m.sentAt ?? '',
          who: m.userName ?? null,
          text: m.mine ? [m.subject, m.snippet].filter(Boolean).join(' — ') || null : null,
          failed: false,
        })),
      ];
      this.exchanges.set(list.sort((a, b) => b.at.localeCompare(a.at)));
    });
  }

  private _fail(err: unknown): void {
    // Un autre agent est passé avant : le statut a changé entre l'ouverture et le clic.
    const code = err instanceof HttpErrorResponse ? err.error?.error : undefined;
    if (code === 'COMPLAINT_INVALID_TRANSITION') {
      this._snackbar.info('Déjà traitée', 'La réclamation a changé entre-temps ; elle est rechargée.');
      this.mode.set('view');
      this._load();
      return;
    }
    this._snackbar.error('Enregistrement impossible', "L'étape n'a pas pu être enregistrée.");
  }
}
