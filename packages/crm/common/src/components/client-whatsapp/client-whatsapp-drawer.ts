import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { applyEach, form, FormField, FormRoot, maxLength, required, submit, validate } from '@angular/forms/signals';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { catchError, EMPTY, firstValueFrom, forkJoin, map } from 'rxjs';
import { ClientWhatsAppDto, WhatsAppApiService, WhatsAppComposeTemplateDto, WhatsAppMessageDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTitle } from '@talisoft/ui/title';
import { WHATSAPP_FAILURE_LABELS } from './whatsapp-failure-labels';

export interface ClientWhatsAppDrawerData {
  clientId: string;
  clientName: string;
  /** Écrit depuis une réclamation : chaque message envoyé la nomme, et le fil les signale. */
  complaintId?: string | null;
  complaintReference?: string | null;
}

const ERROR_LABELS: Record<string, string> = {
  CLIENT_PROCESSING_RESTRICTED: 'Le client a demandé l’effacement de ses données : nous ne le contactons plus à notre initiative.',
  CLIENT_NOT_FOUND: 'Ce client n’est pas dans votre périmètre.',
  WHATSAPP_PHONE_INVALID: 'Le client n’a pas de numéro utilisable au format international.',
  WHATSAPP_CHANNEL_INACTIVE: 'Aucun numéro WhatsApp actif pour l’agence de ce client.',
  WHATSAPP_CLIENT_OPTED_OUT: 'Le client a répondu STOP : il ne veut plus de messages WhatsApp.',
  WHATSAPP_NUMBER_IN_ANOTHER_RECORD: 'Ce numéro a déjà sa conversation sur un autre dossier (lead ou autre client).',
  WHATSAPP_TEMPLATE_COOLDOWN: 'Un modèle a déjà été envoyé il y a moins de 24 h, sans réponse.',
  WHATSAPP_TEMPLATE_NOT_APPROVED: 'Ce modèle n’est pas approuvé par Meta.',
  WHATSAPP_VARIABLES_INVALID: 'Chaque variable doit être renseignée, sur une seule ligne.',
  WHATSAPP_NOT_HOLDER: 'Vous n’avez pas la main sur cette conversation.',
  WHATSAPP_CONVERSATION_HELD_BY_ANOTHER: 'Un autre conseiller a la main sur cette conversation.',
  WHATSAPP_WINDOW_CLOSED: 'La fenêtre de 24 h est fermée : seul un modèle peut être envoyé.',
  COMPLAINT_NOT_FOUND: 'Cette réclamation n’est pas celle de ce client.',
};

const errorLabel = (error: HttpErrorResponse): string =>
  ERROR_LABELS[error.error?.detail ?? ''] ?? 'L’envoi n’a pas pu être fait.';

class VariableRow {
  public index!: number;
  public value!: string;
}

class TemplateFormModel {
  public templateId!: string;
  public variables!: VariableRow[];

  public static instantiate(): TemplateFormModel {
    return Object.assign(new TemplateFormModel(), { templateId: '', variables: [] });
  }
}

class TextFormModel {
  public text!: string;

  public static instantiate(): TextFormModel {
    return Object.assign(new TextFormModel(), { text: '' });
  }
}

/**
 * Écrire à un CLIENT sur WhatsApp (réclamations, lot 3) — depuis une réclamation, ou depuis la
 * boîte WhatsApp pour une conversation de client. Fenêtre de 24 h fermée : un modèle. Ouverte :
 * on prend la main, puis on répond librement. Le numéro n'est jamais affiché que masqué ; c'est le
 * serveur qui le lit.
 *
 * Le fil est rendu en bulles, comme celui des leads (exception tas-table validée pour les fils).
 */
@Component({
  selector: 'client-whatsapp-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormRoot, FormField, TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle,
    TasIcon, TasInput, TasFormField, TasLabel, TasError, TasSpinner, Button,
  ],
  template: `
    <tas-side-drawer width="640px">
      <tas-drawer-title>
        <tas-title>WhatsApp · {{ data.clientName }}</tas-title>
        @if (panel()?.maskedPhone; as phone) {
          <p class="text-xs text-slate-500">{{ phone }}@if (data.complaintReference) { · réclamation {{ data.complaintReference }} }</p>
        }
      </tas-drawer-title>

      <tas-drawer-content>
        @if (isLoading()) {
          <div class="flex justify-center py-16"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
        } @else {
          <div class="flex flex-col gap-4">
            <section aria-label="Fil de la conversation" class="flex max-h-[45vh] flex-col gap-2 overflow-y-auto rounded-2xl bg-[#e5ddd5] p-3">
              @for (m of thread(); track m.id) {
                <div class="max-w-[85%] rounded-xl px-3 py-2 text-sm shadow-sm"
                     [class]="m.direction === 'Outbound' ? 'ml-auto rounded-tr-sm bg-[#dcf8c6]' : 'mr-auto rounded-tl-sm bg-white'">
                  @if (m.templateName) { <p class="mb-0.5 text-[11px] font-semibold uppercase text-slate-500">Modèle · {{ m.templateName }}</p> }
                  <p class="whitespace-pre-line text-slate-900">{{ m.body || (m.hasMedia ? 'Pièce jointe' : '') }}</p>
                  <p class="mt-1 flex flex-wrap items-center justify-end gap-1.5 text-[11px] text-slate-500">
                    @if (data.complaintId && m.complaintId === data.complaintId) {
                      <span class="rounded bg-primary/10 px-1 text-primary">{{ data.complaintReference }}</span>
                    }
                    @if (m.authorName) { <span>{{ m.authorName }} ·</span> }
                    <span>{{ time(m.occurredAt) }}</span>
                  </p>
                  @if (m.status === 'Failed') {
                    <p class="mt-0.5 text-right text-[11px] text-red-700">Non envoyé : {{ failure(m.errorCode) }}</p>
                  }
                </div>
              } @empty {
                <p class="py-6 text-center text-sm text-slate-600">Aucun échange WhatsApp avec ce client pour l’instant.</p>
              }
            </section>

            @if (panel(); as p) {
              @if (canReply()) {
                <form [formRoot]="textForm" class="flex flex-col gap-2" (submit)="$event.preventDefault()">
                  <tas-form-field>
                    <tas-label>Votre message</tas-label>
                    <textarea tasInput rows="3" [formField]="textForm.text"></textarea>
                    @if (textForm.text().touched() && textForm.text().invalid()) {
                      <tas-error>{{ textForm.text().errors()[0].message }}</tas-error>
                    }
                  </tas-form-field>
                  <p class="text-xs text-slate-500">Fenêtre ouverte jusqu’à {{ time(p.windowExpiresAt) }} : réponse libre possible.</p>
                </form>
              } @else if (mustTakeOver()) {
                <div class="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p class="flex-1 text-sm text-slate-700">Le client vous a écrit : prenez la main pour lui répondre librement.</p>
                  <button tas-raised-button color="primary" type="button" [isLoading]="isTaking()" (click)="takeOver()">Prendre la main</button>
                </div>
              } @else if ((p.blockers ?? []).length > 0) {
                <div role="status" class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  @for (b of p.blockers; track b) { <p>{{ label(b) }}</p> }
                </div>
              } @else if ((p.templates ?? []).length === 0) {
                <p class="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-600">
                  Aucun modèle WhatsApp approuvé valable pour tous les produits : demandez-en un à l’administrateur
                  (par exemple « suivi de réclamation »).
                </p>
              } @else {
                <form [formRoot]="templateForm" class="flex min-w-0 flex-col gap-3" (submit)="$event.preventDefault()">
                  <p class="text-sm text-slate-700">La fenêtre de 24 h est fermée : ouvrez l’échange par un modèle.</p>
                  <!-- min-w-0 : un fieldset s'élargit sinon jusqu'au plus long modèle et pousse le tiroir hors de l'écran. -->
                  <fieldset class="flex min-w-0 flex-col gap-2">
                    <legend class="sr-only">Modèle</legend>
                    @for (t of p.templates; track t.id) {
                      <button type="button" role="radio"
                              class="w-full min-w-0 overflow-hidden rounded-xl border bg-white px-4 py-2.5 text-left"
                              [class]="templateModel().templateId === t.id ? 'border-2 border-primary' : 'border-slate-200 hover:border-slate-300'"
                              [attr.aria-checked]="templateModel().templateId === t.id"
                              (click)="choose(t)">
                        <span class="block text-sm font-semibold text-slate-900">{{ t.name }}</span>
                        <span class="block truncate text-xs text-slate-500">{{ t.bodyText }}</span>
                      </button>
                    }
                  </fieldset>
                  @if (preview(); as text) {
                    <section aria-label="Aperçu du message" class="rounded-2xl bg-[#e5ddd5] p-3">
                      <p class="ml-auto max-w-[85%] whitespace-pre-line rounded-xl rounded-tr-sm bg-[#dcf8c6] px-3 py-2 text-sm text-slate-900 shadow-sm">{{ text }}</p>
                    </section>
                  }
                  @for (row of templateForm.variables; track $index; let i = $index) {
                    <tas-form-field>
                      <tas-label>Variable {{ '{{' }}{{ templateModel().variables[i].index }}{{ '}}' }}</tas-label>
                      <input tasInput type="text" [formField]="row.value" />
                      @if (row.value().touched() && row.value().invalid()) {
                        <tas-error>{{ row.value().errors()[0].message }}</tas-error>
                      }
                    </tas-form-field>
                  }
                </form>
              }
            }
          </div>
        }
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-3">
          <button tas-outlined-button color="primary" type="button" (click)="close()">Fermer</button>
          @if (canReply()) {
            <button tas-raised-button color="primary" type="button"
                    [disabled]="textForm().invalid() || textForm().submitting()" [isLoading]="textForm().submitting()"
                    (click)="sendText()">
              <tas-icon iconName="feather:send" style="font-size:14px"></tas-icon> Envoyer
            </button>
          } @else if (canTemplate()) {
            <button tas-raised-button color="primary" type="button"
                    [disabled]="!templateModel().templateId || templateForm().invalid() || templateForm().submitting()"
                    [isLoading]="templateForm().submitting()"
                    (click)="sendTemplate()">
              <tas-icon iconName="feather:send" style="font-size:14px"></tas-icon> Envoyer le modèle
            </button>
          }
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ClientWhatsAppDrawer {
  private readonly _api = inject(WhatsAppApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  public readonly data = inject<ClientWhatsAppDrawerData>(DIALOG_DATA);

  public readonly isLoading = signal(true);
  public readonly isTaking = signal(false);
  public readonly panel = signal<ClientWhatsAppDto | null>(null);
  public readonly messages = signal<WhatsAppMessageDto[]>([]);
  private _sent = false;

  /** Du plus ancien au plus récent, comme une messagerie. */
  public readonly thread = computed(() => [...this.messages()].reverse());
  public readonly canReply = computed(() => {
    const p = this.panel();
    return !!p?.conversationId && !!p.heldByMe && !!p.windowOpen && !p.optedOut;
  });
  public readonly mustTakeOver = computed(() => {
    const p = this.panel();
    return !!p?.conversationId && !!p.windowOpen && !p.heldByMe && !p.optedOut;
  });
  public readonly canTemplate = computed(() => {
    const p = this.panel();
    return !!p && !this.canReply() && !this.mustTakeOver() && (p.blockers ?? []).length === 0 && (p.templates ?? []).length > 0;
  });

  /** Le corps du modèle choisi, ses variables remplacées — ou laissées visibles tant qu'elles manquent. */
  public readonly preview = computed(() => {
    const template = (this.panel()?.templates ?? []).find((t) => t.id === this.templateModel().templateId);
    if (!template) return null;
    const values = this.templateModel().variables;
    return (template.bodyText ?? '').replace(/\{\{\s*(\d{1,2})\s*\}\}/g, (match, n) =>
      values.find((v) => v.index === Number(n))?.value.trim() || match);
  });

  public readonly textModel = signal(TextFormModel.instantiate());
  public readonly textForm = form(this.textModel, (schema) => {
    required(schema.text, { message: 'Écrivez votre message' });
    maxLength(schema.text, 4096, { message: '4 096 caractères au maximum' });
  });

  public readonly templateModel = signal(TemplateFormModel.instantiate());
  public readonly templateForm = form(this.templateModel, (schema) => {
    required(schema.templateId, { message: 'Choisissez un modèle' });
    applyEach(schema.variables, (row) => {
      required(row.value, { message: 'Renseignez cette variable' });
      maxLength(row.value, 1024, { message: '1 024 caractères au maximum' });
      validate(row.value, (ctx) => (/[\n\t]/.test(ctx.value()) ? { kind: 'single-line', message: 'Une seule ligne, sans tabulation' } : null));
    });
  });

  constructor() {
    this._load();
  }

  public failure(code: string | null | undefined): string {
    return (code && WHATSAPP_FAILURE_LABELS[code]) || 'l’envoi a échoué.';
  }

  public label(code: string): string {
    return ERROR_LABELS[code] ?? code;
  }

  public time(value: string | null | undefined): string {
    return value ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '';
  }

  public choose(template: WhatsAppComposeTemplateDto): void {
    this.templateForm().reset(Object.assign(new TemplateFormModel(), {
      templateId: template.id ?? '',
      // Ce que la fiche remplit (le prénom du client, votre nom) ; le reste est à saisir. Deviner
      // une variable libre envoyait « Bonjour RCL-2026-000005 » (vu en recette) : l'aperçu montre
      // le message tel qu'il partira.
      variables: (template.variables ?? []).map((v) => Object.assign(new VariableRow(), {
        index: v.index ?? 0,
        value: v.value ?? '',
      })),
    }));
  }

  public takeOver(): void {
    this.isTaking.set(true);
    this._api.takeOverClientWhatsApp(this.data.clientId).pipe(
      catchError((error: HttpErrorResponse) => {
        this.isTaking.set(false);
        this._snackbar.error('WhatsApp', errorLabel(error));
        return EMPTY;
      }),
    ).subscribe(() => {
      this.isTaking.set(false);
      this._load();
    });
  }

  public sendText(): void {
    submit(this.textForm, async (field) => {
      const sent = await firstValueFrom(
        this._api.sendClientWhatsAppText(this.data.clientId, { text: field().value().text.trim(), complaintId: this.data.complaintId ?? null }).pipe(
          map(() => true),
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error('Envoi impossible', errorLabel(error));
            return EMPTY;
          }),
        ),
        { defaultValue: false },
      );
      if (!sent) return;
      this._sent = true;
      this.textForm().reset(TextFormModel.instantiate());
      this._load();
    });
  }

  public sendTemplate(): void {
    submit(this.templateForm, async (field) => {
      const value = field().value();
      const sent = await firstValueFrom(
        this._api.sendClientWhatsAppTemplate(this.data.clientId, {
          templateId: value.templateId,
          variables: value.variables.map((v) => v.value.trim()),
          complaintId: this.data.complaintId ?? null,
        }).pipe(
          map(() => true),
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error('Envoi impossible', errorLabel(error));
            return EMPTY;
          }),
        ),
        { defaultValue: false },
      );
      if (!sent) return;
      this._sent = true;
      this._snackbar.success('Message en cours d’envoi', `Le modèle part vers ${this.data.clientName}.`);
      this.templateForm().reset(TemplateFormModel.instantiate());
      this._load();
    });
  }

  public close(): void {
    this._dialogRef.close(this._sent);
  }

  private _load(): void {
    forkJoin({
      panel: this._api.getClientWhatsApp(this.data.clientId),
      messages: this._api.listClientWhatsAppMessages(this.data.clientId, undefined, undefined, 50),
    }).pipe(
      catchError((error: HttpErrorResponse) => {
        this.isLoading.set(false);
        this._snackbar.error('WhatsApp', errorLabel(error));
        return EMPTY;
      }),
    ).subscribe(({ panel, messages }) => {
      this.panel.set(panel);
      this.messages.set(messages?.items ?? []);
      this.isLoading.set(false);
      const templates = panel?.templates ?? [];
      if (templates.length === 1 && !this.templateModel().templateId) this.choose(templates[0]);
    });
  }
}
