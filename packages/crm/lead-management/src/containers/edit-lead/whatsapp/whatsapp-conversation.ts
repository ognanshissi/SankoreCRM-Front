import { RouterLink } from '@angular/router';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { form, FormField, FormRoot, maxLength, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map, Observable } from 'rxjs';
import { WhatsAppApiService, WhatsAppMessageDto, WhatsAppPanelDto } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { LeadEditContext } from '../lead-edit-context';
import { displayName } from '../lead-view.models';
import {
  SendWhatsAppTemplateDrawer,
  SendWhatsAppTemplateDrawerData,
  SendWhatsAppTemplateDrawerResult,
} from './send-whatsapp-template-drawer';
import { ReassignWhatsAppDrawer, ReassignWhatsAppDrawerData } from './reassign-whatsapp-drawer';
import { WhatsAppConsentBadge } from './whatsapp-contact-button';
import {
  CONVERSATION_STATUS,
  BOT_FIELD_TABS,
  ESCALATION_REASON_LABELS,
  whatsAppActionError,
  whatsAppBlockerLabel,
  whatsAppFailureLabel,
} from './whatsapp-labels';
import { WhatsAppPush, WhatsAppRealtime } from './whatsapp-realtime';

const PAGE_SIZE = 30;

/** Le relevé de secours, si le hub est injoignable ou qu'un poussé s'est perdu. */
const POLL_MS = 30_000;

/** Un jour du fil : son intitulé et ses bulles. */
interface ThreadDay {
  key: string;
  label: string;
  messages: WhatsAppMessageDto[];
}

/** La saisie de l'agent (WA-FE-07). */
class ComposerFormModel {
  public text!: string;

  public static instantiate(): ComposerFormModel {
    return Object.assign(new ComposerFormModel(), { text: '' });
  }
}

/** La clôture, avec son motif (WA-FE-08). */
class CloseFormModel {
  public reason!: string;

  public static instantiate(): CloseFormModel {
    return Object.assign(new CloseFormModel(), { reason: '' });
  }
}

/** Ce qu'une pièce jointe peut être, et jusqu'à quel poids — les limites de Meta et de la plateforme. */
const ATTACHMENT_RULES: Record<string, number> = {
  'image/jpeg': 5 * 1024 * 1024,
  'image/png': 5 * 1024 * 1024,
  'application/pdf': 10 * 1024 * 1024,
};

/** L'état de la fenêtre de 24 h, pour le bandeau (WA-FE-06). */
interface WindowView {
  tone: 'open' | 'closing' | 'expired' | 'none';
  label: string;
}

const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

/**
 * L'onglet WhatsApp de la fiche lead (WA-FE-05, WA-FE-06, WA-FE-13) : le bandeau d'état — qui a la
 * main, le compte à rebours de la fenêtre de 24 h — et le fil en bulles, client à gauche, agent et
 * bot à droite, avec le statut de chaque message envoyé.
 *
 * Le fil n'est PAS un `tas-table` : c'est une conversation qui se lit de bas en haut et se charge
 * vers le passé au défilement, par curseur — la pagination par pages du tableau ne s'y applique
 * pas. Exception à la règle des listes, validée par le propriétaire du projet.
 *
 * L'agent qui a la main y répond librement — texte, image, PDF — tant que la fenêtre est ouverte ;
 * il peut rendre la conversation au bot ou la clôturer, et un superviseur la réassigner (WA-FE-07,
 * WA-FE-08). La saisie disparaît pour qui n'a pas la main, et cède la place à « Envoyer un
 * template » quand la fenêtre est fermée.
 */
@Component({
  selector: 'lead-whatsapp-conversation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './whatsapp-conversation.html',
  imports: [RouterLink, TasIcon, TasSpinner, Button, WhatsAppConsentBadge, FormRoot, FormField, TasFormField, TasLabel, TasError, TasInput],
  providers: [WhatsAppRealtime],
})
export class LeadWhatsAppConversation {
  private readonly _api = inject(WhatsAppApiService);
  private readonly _context = inject(LeadEditContext);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sanitizer = inject(DomSanitizer);
  private readonly _permissions = inject(PermissionsService);
  private readonly _confirm = inject(ConfirmDialogService);
  public readonly realtime = inject(WhatsAppRealtime);

  public readonly id = input.required<string>();

  private readonly _scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  public readonly canSend = this._permissions.can('WhatsApp.Send');
  public readonly canReply = this._permissions.can('WhatsApp.Reply');
  public readonly canSupervise = this._permissions.can('WhatsApp.Supervise');

  private readonly _fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  public readonly acting = signal(false);
  public readonly isUploading = signal(false);
  public readonly closing = signal(false);

  public composerModel = signal(ComposerFormModel.instantiate());
  public composer = form(this.composerModel, (schema) => {
    required(schema.text, { message: 'Écrivez un message' });
    maxLength(schema.text, 4096, { message: '4 096 caractères au maximum' });
    validate(schema.text, (ctx) => (ctx.value().trim() ? null : { kind: 'blank', message: 'Écrivez un message' }));
  });

  public closeModel = signal(CloseFormModel.instantiate());
  public closeForm = form(this.closeModel, (schema) => {
    required(schema.reason, { message: 'Le motif est obligatoire' });
    maxLength(schema.reason, 300, { message: '300 caractères au maximum' });
  });

  public readonly isLoading = signal(true);
  public readonly loadFailed = signal(false);
  public readonly isLoadingOlder = signal(false);
  public readonly panel = signal<WhatsAppPanelDto | null>(null);
  public readonly messages = signal<WhatsAppMessageDto[]>([]);
  public readonly nextBefore = signal<string | null>(null);

  /** L'heure de référence du bandeau ; avance toutes les 30 s pour le compte à rebours. */
  public readonly now = signal(Date.now());

  /** Les images déjà chargées, par message : une URL d'objet, révoquée à la destruction. */
  public readonly images = signal<Record<string, SafeUrl>>({});
  private readonly _objectUrls: string[] = [];

  public readonly name = computed(() => displayName(this._context.lead()));
  public readonly conversation = computed(() => this.panel()?.conversation ?? null);

  public readonly status = computed(() => {
    const code = this.conversation()?.status;
    return code ? CONVERSATION_STATUS[code] ?? { label: code, tone: 'bg-slate-100 text-slate-700', icon: 'feather:message-circle' } : null;
  });

  public readonly window = computed<WindowView>(() => {
    const expires = this.conversation()?.windowExpiresAt;
    if (!expires) return { tone: 'none', label: 'Aucune fenêtre ouverte : seul un template peut être envoyé.' };
    const left = new Date(expires).getTime() - this.now();
    if (left <= 0) return { tone: 'expired', label: 'Fenêtre expirée : seul un template peut être envoyé.' };
    const hours = Math.floor(left / 3_600_000);
    const minutes = Math.floor((left % 3_600_000) / 60_000);
    const remaining = hours > 0 ? `${hours} h ${String(minutes).padStart(2, '0')}` : `${minutes} min`;
    return { tone: left < 2 * 3_600_000 ? 'closing' : 'open', label: `Fenêtre de 24 h ouverte · expire dans ${remaining}` };
  });

  public readonly blockers = computed(() => (this.panel()?.blockers ?? []).map(whatsAppBlockerLabel));

  /** Qui a la main, qui est attendu, pourquoi — la ligne « qui » du bandeau (WA-FE-06). */
  public readonly holderLine = computed(() => {
    const c = this.conversation();
    if (!c) return null;
    switch (c.status) {
      case 'Human':
        return c.isHolder ? 'Vous avez la main' : `Pris en charge par ${c.ownerName ?? 'un agent'}`;
      case 'PendingHuman':
        return c.targetAgentName
          ? `${c.isHolder ? '' : 'Attendu : '}${c.targetAgentName}`
          : 'Aucun agent attendu : à attribuer';
      case 'Closed':
        return c.closeReason === 'OPT_OUT' ? 'Le client a demandé à ne plus être contacté (STOP)' : c.closeReason ? `Clôturée · ${c.closeReason}` : 'Clôturée';
      default:
        return null;
    }
  });

  public readonly escalationLabel = computed(() => {
    const c = this.conversation();
    const reason = c?.escalationReason;
    return reason ? c?.escalationReasonLabel ?? ESCALATION_REASON_LABELS[reason] ?? reason : null;
  });

  /**
   * Le bloc de passation (WA-FE-12) : ce que le bot a compris et ce qu'il a recueilli. Affiché
   * tant qu'un humain attend ou tient la conversation — celui qui vient de prendre la main en a
   * le plus besoin — et seulement si le bot a eu la parole.
   */
  public readonly handover = computed(() => {
    const c = this.conversation();
    if (!c || (c.status !== 'PendingHuman' && c.status !== 'Human')) return null;
    const fields = (c.botCollectedFields ?? []).map((f) => ({
      label: f.label ?? f.code ?? '',
      value: f.value ?? null,
      link: ['/leads', this.id(), BOT_FIELD_TABS[f.code ?? ''] ?? 'informations'],
    }));
    const fromBot = (c.escalationReason ?? '').startsWith('BOT_');
    if (!c.escalationSummary && fields.length === 0 && !fromBot) return null;
    return { reason: this.escalationLabel(), summary: c.escalationSummary ?? null, fields };
  });

  /** Le délai de prise en charge, à rebours (WA-FE-06). */
  public readonly takeover = computed(() => {
    const c = this.conversation();
    if (!c || c.status !== 'PendingHuman' || !c.takeoverDeadline) return null;
    const left = new Date(c.takeoverDeadline).getTime() - this.now();
    if (c.takeoverBreached || left <= 0) return { late: true, label: 'Délai de prise en charge dépassé' };
    const minutes = Math.max(1, Math.round(left / 60_000));
    return { late: minutes <= 5, label: `À prendre en charge dans ${minutes} min` };
  });

  /** Peut prendre la main : la conversation attend quelqu'un, ou un bot, et n'est tenue par personne d'autre. */
  public readonly canTakeOver = computed(() => {
    const c = this.conversation();
    return !!c && this.canReply() && !c.isHolder && (c.status === 'PendingHuman' || c.status === 'Bot' || c.status === 'AwaitingReply' || c.status === 'Closed')
      && (c.closeReason !== 'OPT_OUT');
  });

  public readonly days = computed<ThreadDay[]>(() => {
    const days: ThreadDay[] = [];
    for (const message of this.messages()) {
      const at = new Date(message.occurredAt ?? '');
      const key = at.toDateString();
      let day = days[days.length - 1];
      if (!day || day.key !== key) {
        day = { key, label: this._dayLabel(at), messages: [] };
        days.push(day);
      }
      day.messages.push(message);
    }
    return days;
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => {
        this._load(id);
        this.realtime.connect((push) => this._onPush(push), () => this._refresh());
      });
    });

    // Le compte à rebours avance ; et, tant que le hub n'est pas joignable, le fil se relit seul.
    const timer = setInterval(() => {
      this.now.set(Date.now());
      if (document.visibilityState === 'visible' && !this.realtime.connected()) this._refresh();
    }, POLL_MS);

    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      for (const url of this._objectUrls) URL.revokeObjectURL(url);
    });
  }

  // ——— Lecture ———

  public retry(): void {
    this._load(this.id());
  }

  public onScroll(event: Event): void {
    const element = event.target as HTMLElement;
    if (element.scrollTop < 60) this.loadOlder();
  }

  /** Les messages plus anciens, ajoutés en haut sans faire sauter la position de lecture. */
  public loadOlder(): void {
    const before = this.nextBefore();
    if (!before || this.isLoadingOlder()) return;

    this.isLoadingOlder.set(true);
    const scroller = this._scroller()?.nativeElement;
    const heightBefore = scroller?.scrollHeight ?? 0;

    this._api.listLeadWhatsAppMessages(this.id(), before, PAGE_SIZE).pipe(
      catchError(() => {
        this.isLoadingOlder.set(false);
        return EMPTY;
      }),
    ).subscribe((page) => {
      const older = [...(page.items ?? [])].reverse();
      this.messages.update((current) => [...older.filter((m) => !current.some((c) => c.id === m.id)), ...current]);
      this.nextBefore.set(page.nextBefore ?? null);
      this.isLoadingOlder.set(false);
      requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop = scroller.scrollHeight - heightBefore;
      });
      this._loadImages(older);
    });
  }

  // ——— Affichage ———

  public time(message: WhatsAppMessageDto): string {
    const at = new Date(message.occurredAt ?? '');
    return Number.isNaN(at.getTime()) ? '' : TIME.format(at);
  }

  public isOutbound(message: WhatsAppMessageDto): boolean {
    return message.direction === 'Outbound';
  }

  public authorLabel(message: WhatsAppMessageDto): string {
    if (message.author === 'Bot') return 'Bot';
    if (message.author === 'System') return 'Message automatique';
    if (message.author === 'Agent') return message.authorName ? `Agent · ${message.authorName}` : 'Agent';
    return '';
  }

  public statusIcon(message: WhatsAppMessageDto): { icon: string; label: string; tone: string } | null {
    switch (message.status) {
      case 'Queued':
      case 'Sending':
        return { icon: 'feather:clock', label: 'En cours d’envoi', tone: 'text-slate-400' };
      case 'Sent':
        return { icon: 'feather:check', label: 'Envoyé', tone: 'text-slate-500' };
      case 'Delivered':
        return { icon: 'feather:check-circle', label: 'Reçu', tone: 'text-slate-500' };
      case 'Read':
        return { icon: 'feather:check-circle', label: 'Lu', tone: 'text-sky-600' };
      case 'Failed':
        return { icon: 'feather:alert-circle', label: 'Échec', tone: 'text-red-600' };
      default:
        return null;
    }
  }

  public failure(message: WhatsAppMessageDto): string {
    return whatsAppFailureLabel(message.errorCode);
  }

  public isImage(message: WhatsAppMessageDto): boolean {
    return !!message.hasMedia && (message.kind === 'Image' || message.kind === 'Sticker');
  }

  public mediaLabel(message: WhatsAppMessageDto): string {
    switch (message.kind) {
      case 'Document': return message.mediaFileName || 'Document';
      case 'Audio': return 'Message vocal';
      case 'Video': return 'Vidéo';
      default: return 'Pièce jointe';
    }
  }

  public placeholder(message: WhatsAppMessageDto): string | null {
    if (message.body) return null;
    switch (message.kind) {
      case 'Location': return 'Position partagée';
      case 'Contacts': return 'Contact partagé';
      case 'Unsupported': return 'Message non pris en charge';
      default: return null;
    }
  }

  /** Une pièce jointe autre qu'une image : téléchargée sous le nom que le client lui a donné. */
  public download(message: WhatsAppMessageDto): void {
    this._api.getLeadWhatsAppMedia(this.id(), message.id!).pipe(
      catchError(() => {
        this._snackbar.error('Pièce jointe', 'Elle n’a pas pu être récupérée.');
        return EMPTY;
      }),
    ).subscribe((blob) => {
      const url = URL.createObjectURL(blob as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = message.mediaFileName || 'piece-jointe';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });
  }

  // ——— Envoi ———

  public sendTemplate(): void {
    const data: SendWhatsAppTemplateDrawerData = {
      leadId: this.id(),
      leadName: this.name(),
      maskedPhone: this.panel()?.maskedPhone ?? null,
    };
    const ref = this._drawer.open<SendWhatsAppTemplateDrawerResult, SendWhatsAppTemplateDrawerData, SendWhatsAppTemplateDrawer>(
      SendWhatsAppTemplateDrawer,
      { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data },
    );
    ref.closed.subscribe((result) => {
      if (result) this._refresh();
    });
  }

  // ——— Prise en main (WA-FE-08) ———

  public takeOver(): void {
    const c = this.conversation();
    if (!c?.id) return;
    this._act(this._api.takeOverLeadWhatsApp(this.id(), c.id), 'Vous avez la main', 'Vous pouvez répondre librement tant que la fenêtre est ouverte.');
  }

  public returnToBot(): void {
    const c = this.conversation();
    if (!c?.id) return;
    this._confirm.confirm({
      title: 'Rendre la conversation au bot ?',
      message: 'Vous n’aurez plus la main ; le prochain message du client repassera par le bot, ou vers un agent tant que le bot n’est pas actif.',
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Rendre au bot', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._act(this._api.returnLeadWhatsAppToBot(this.id(), c.id!), 'Conversation rendue au bot', ''),
    });
  }

  public startClose(): void {
    this.closeForm().reset(CloseFormModel.instantiate());
    this.closing.set(true);
  }

  public confirmClose(): void {
    const c = this.conversation();
    if (!c?.id) return;
    submit(this.closeForm, async (field) => {
      const done = await this._run(this._api.closeLeadWhatsApp(this.id(), c.id!, { reason: field().value().reason.trim() }));
      if (!done) return;
      this.closing.set(false);
      this._snackbar.success('Conversation clôturée', 'Un nouveau message du client la rouvrira.');
      this._refresh();
    });
  }

  public reassign(): void {
    const c = this.conversation();
    if (!c?.id) return;
    const data: ReassignWhatsAppDrawerData = {
      leadId: this.id(),
      conversationId: c.id,
      currentAgentId: c.ownerUserId ?? c.targetAgentId ?? null,
    };
    const ref = this._drawer.open<boolean, ReassignWhatsAppDrawerData, ReassignWhatsAppDrawer>(
      ReassignWhatsAppDrawer,
      { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data },
    );
    ref.closed.subscribe((done) => {
      if (done) this._refresh();
    });
  }

  // ——— Réponse (WA-FE-07) ———

  public onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.sendText();
    }
  }

  public sendText(): void {
    const c = this.conversation();
    if (!c?.id || !c.canReply) return;
    submit(this.composer, async (field) => {
      const done = await this._run(this._api.sendLeadWhatsAppText(this.id(), c.id!, { text: field().value().text.trim() }));
      if (!done) return;
      this.composer().reset(ComposerFormModel.instantiate());
      this._refresh();
    });
  }

  public pickFile(): void {
    this._fileInput()?.nativeElement.click();
  }

  public onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const c = this.conversation();
    if (!file || !c?.id) return;

    const limit = ATTACHMENT_RULES[file.type];
    if (!limit) {
      this._snackbar.error('Pièce jointe refusée', 'Seules les images JPEG ou PNG et les PDF peuvent être envoyés.');
      return;
    }
    if (file.size > limit) {
      this._snackbar.error('Pièce jointe trop lourde', file.type === 'application/pdf' ? 'Un PDF ne doit pas dépasser 10 Mo.' : 'Une image ne doit pas dépasser 5 Mo.');
      return;
    }

    const caption = this.composerModel().text.trim() || undefined;
    this.isUploading.set(true);
    this._api.sendLeadWhatsAppMedia(this.id(), c.id, file, caption).pipe(
      catchError((error: HttpErrorResponse) => {
        this.isUploading.set(false);
        this._snackbar.error('Envoi impossible', whatsAppActionError(error));
        return EMPTY;
      }),
    ).subscribe((result) => {
      this.isUploading.set(false);
      if (result.status === 'Failed') {
        this._snackbar.error('Pièce jointe non envoyée', whatsAppFailureLabel(result.errorCode));
      } else if (caption) {
        this.composer().reset(ComposerFormModel.instantiate());
      }
      this._refresh();
    });
  }

  private _act(request: Observable<unknown>, title: string, detail: string): void {
    this._run(request).then((done) => {
      if (!done) return;
      this._snackbar.success(title, detail);
      this._refresh();
    });
  }

  private async _run(request: Observable<unknown>): Promise<boolean> {
    this.acting.set(true);
    const done = await firstValueFrom(
      request.pipe(
        map(() => true),
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error('Action impossible', whatsAppActionError(error));
          return EMPTY;
        }),
      ),
      { defaultValue: false },
    );
    this.acting.set(false);
    return done;
  }

  // ——— Chargement ———

  private _load(leadId: string): void {
    this.isLoading.set(true);
    this.loadFailed.set(false);

    this._api.getLeadWhatsApp(leadId).pipe(
      catchError(() => {
        this.isLoading.set(false);
        this.loadFailed.set(true);
        return EMPTY;
      }),
    ).subscribe((panel) => this.panel.set(panel));

    this._api.listLeadWhatsAppMessages(leadId, undefined, PAGE_SIZE).pipe(
      catchError(() => {
        this.isLoading.set(false);
        this.loadFailed.set(true);
        return EMPTY;
      }),
    ).subscribe((page) => {
      const items = [...(page.items ?? [])].reverse();
      this.messages.set(items);
      this.nextBefore.set(page.nextBefore ?? null);
      this.isLoading.set(false);
      this._scrollToBottom();
      this._loadImages(items);
      this._markRead();
    });
  }

  /** La page la plus récente, fusionnée : les nouveaux messages s'ajoutent, les statuts se mettent à jour. */
  private _refresh(): void {
    const leadId = this.id();

    this._api.getLeadWhatsApp(leadId).pipe(catchError(() => EMPTY)).subscribe((panel) => this.panel.set(panel));

    this._api.listLeadWhatsAppMessages(leadId, undefined, PAGE_SIZE).pipe(catchError(() => EMPTY)).subscribe((page) => {
      const latest = [...(page.items ?? [])].reverse();
      const scroller = this._scroller()?.nativeElement;
      const atBottom = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;

      let added = false;
      this.messages.update((current) => {
        const byId = new Map(current.map((m) => [m.id, m] as const));
        for (const m of latest) {
          if (!byId.has(m.id)) added = true;
          byId.set(m.id, m);
        }
        return [...byId.values()].sort((a, b) => (a.occurredAt ?? '').localeCompare(b.occurredAt ?? ''));
      });

      if (added) {
        this._loadImages(latest);
        this._markRead();
        if (atBottom) this._scrollToBottom();
      }
    });
  }

  private _onPush(push: WhatsAppPush): void {
    if (push.leadId && push.leadId !== this.id()) return;
    this._refresh();
  }

  private _markRead(): void {
    if ((this.conversation()?.unreadCount ?? 1) === 0) return;
    this._api.markLeadWhatsAppRead(this.id()).pipe(catchError(() => EMPTY)).subscribe(() => {
      this._context.reload();
    });
  }

  /** Les images du fil, chacune une fois : le serveur les relit chez le fournisseur à la demande. */
  private _loadImages(messages: WhatsAppMessageDto[]): void {
    for (const message of messages.filter((m) => this.isImage(m) && !this.images()[m.id!])) {
      this._api.getLeadWhatsAppMedia(this.id(), message.id!).pipe(catchError(() => EMPTY)).subscribe((blob) => {
        const url = URL.createObjectURL(blob as Blob);
        this._objectUrls.push(url);
        this.images.update((all) => ({ ...all, [message.id!]: this._sanitizer.bypassSecurityTrustUrl(url) }));
      });
    }
  }

  private _scrollToBottom(): void {
    requestAnimationFrame(() => {
      const scroller = this._scroller()?.nativeElement;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  }

  private _dayLabel(at: Date): string {
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (at.toDateString() === today.toDateString()) return 'Aujourd’hui';
    if (at.toDateString() === yesterday.toDateString()) return 'Hier';
    const label = DAY.format(at);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
}

export default LeadWhatsAppConversation;
