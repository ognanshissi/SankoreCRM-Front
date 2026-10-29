import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY, finalize, map, of } from 'rxjs';
import { ConnectedMailboxApiService, MailAttachmentDto, MailLinkDto, MailMessageDto, MailThreadDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { MailBody } from './mail-body';
import { MailComposeDrawer, MailComposeDrawerData } from './mail-compose-drawer';
import { addressesOf, bodyPreview, initials, messageDate, partyLabel } from './mail-labels';
import { MailReplyBox } from './mail-reply-box';

/** Le lead ou le client de la conversation, et l'adresse à laquelle on lui écrit. */
export interface MailThreadContact {
  link: MailLinkDto;
  email: string | null;
}

/**
 * Une conversation de la Messagerie, du plus ancien au plus récent. Les messages sont des cartes
 * empilées et non un `tas-table` : c'est un FIL qu'on lit dans l'ordre, comme les fils WhatsApp et
 * support — la maquette du propriétaire (2026-10-28) le dessine ainsi. Les messages déjà lus sont
 * repliés sur une ligne ; le dernier et les non-lus sont ouverts. La réponse rapide est en bas.
 *
 * Ouvrir une conversation la marque lue chez le fournisseur comme ici.
 */
@Component({
  selector: 'mail-thread-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Button, TasIcon, TasSpinner, MailBody, MailReplyBox],
  host: { class: 'flex h-full min-h-0 flex-col' },
  template: `
    @if (isLoading()) {
      <div class="flex flex-1 items-center justify-center py-16"><tas-spinner size="8" class="text-primary"></tas-spinner></div>
    } @else if (loadFailed()) {
      <div class="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center" role="alert">
        <p class="text-sm text-slate-600">Cette conversation n’a pas pu être chargée.</p>
        <button tas-outlined-button color="primary" type="button" (click)="load()">Réessayer</button>
      </div>
    } @else if (thread(); as t) {
      <header class="flex items-start gap-3 border-b border-slate-100 px-5 pb-3 pt-4">
        <div class="min-w-0 flex-1">
          <h2 class="truncate text-lg font-bold text-slate-900">{{ t.subject || '(sans objet)' }}</h2>
          <p class="text-xs text-slate-500">
            {{ t.messages?.length }} message{{ (t.messages?.length ?? 0) > 1 ? 's' : '' }}
            @if (counterpart()) { avec {{ counterpart() }} }
          </p>
          <!-- Sous 1280 px le panneau du contact n'est plus là : ses liens restent ici. -->
          @if (links().length > 0) {
            <div class="mt-2 flex flex-wrap gap-1.5 xl:hidden">
              @for (l of links(); track l.entityId) {
                <a [routerLink]="linkRoute(l)" class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary hover:underline">
                  <tas-icon [iconName]="l.entityType === 'Client' ? 'feather:user' : 'feather:target'" iconClass="!size-3"></tas-icon>
                  {{ l.name || (l.entityType === 'Client' ? 'Client' : 'Lead') }}
                </a>
              }
            </div>
          }
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button type="button" class="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:border-primary hover:text-primary"
                  aria-label="Marquer comme non lu" title="Marquer comme non lu" (click)="markUnread()">
            <tas-icon iconName="feather:mail" iconClass="!size-4"></tas-icon>
          </button>
          @if (latest(); as last) {
            <button type="button" class="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:border-primary hover:text-primary"
                    aria-label="Transférer le dernier message" title="Transférer" (click)="forward(last)">
              <tas-icon iconName="feather:corner-up-right" iconClass="!size-4"></tas-icon>
            </button>
          }
        </div>
      </header>

      <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-5 py-4">
        @for (m of t.messages ?? []; track m.id; let last = $last) {
          @let open = last || expanded().has(m.id!);
          @let mine = m.direction === 'Sent';
          <article class="rounded-xl border border-slate-200 bg-white">
            @if (!open) {
              <button type="button" class="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-slate-50" aria-expanded="false" (click)="toggle(m)">
                <span class="grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold" [class]="avatarClass(mine)" aria-hidden="true">{{ avatar(m) }}</span>
                <span class="shrink-0 text-sm font-semibold text-slate-900">{{ mine ? 'Vous' : partyLabel(m.from) }}</span>
                <span class="min-w-0 flex-1 truncate text-sm text-slate-500">{{ preview(m) }}</span>
                <span class="shrink-0 text-xs tabular-nums text-slate-500">{{ messageDate(m.sentAt) }}</span>
              </button>
            } @else {
              <div class="flex items-center gap-3 px-3.5 pt-3">
                <span class="grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold" [class]="avatarClass(mine)" aria-hidden="true">{{ avatar(m) }}</span>
                <button type="button" class="min-w-0 flex-1 truncate text-left text-sm font-semibold text-slate-900" [disabled]="last" aria-expanded="true" (click)="toggle(m)">
                  {{ mine ? 'Vous' : partyLabel(m.from) }}
                </button>
                <span class="shrink-0 text-xs tabular-nums text-slate-500">{{ messageDate(m.sentAt) }}</span>
              </div>
              <div class="px-3.5 pb-3.5 sm:pl-[3.6rem]">
                <p class="mb-2 truncate text-xs text-slate-500">{{ route(m) }}</p>
                <mail-body [body]="m.body" [isHtml]="!!m.bodyIsHtml"></mail-body>
                @if (m.bodyTruncated) {
                  <p class="mt-2 text-xs text-slate-500">Message très long : la fin n’a pas été conservée. Ouvrez-le dans votre messagerie pour le lire en entier.</p>
                }
                @if (visibleAttachments(m).length > 0) {
                  <div class="mt-3 flex flex-wrap gap-2">
                    @for (a of visibleAttachments(m); track a.id) {
                      <button type="button" class="inline-flex max-w-64 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 hover:border-primary hover:text-primary"
                              [disabled]="downloading() === a.id" (click)="download(m, a)">
                        @if (downloading() === a.id) {
                          <tas-spinner size="3" class="text-primary"></tas-spinner>
                        } @else {
                          <tas-icon iconName="feather:paperclip" iconClass="!size-3"></tas-icon>
                        }
                        <span class="truncate">{{ a.name }}</span>
                      </button>
                    }
                  </div>
                }
              </div>
            }
          </article>
        }
      </div>

      @if (latest(); as last) {
        <div class="border-t border-slate-100 bg-white px-5 pb-4 pt-3">
          <mail-reply-box [source]="last" [context]="replyContext()" (sent)="afterSend()"></mail-reply-box>
        </div>
      }
    }
  `,
})
export class MailThreadView {
  private readonly _api = inject(ConnectedMailboxApiService);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);

  /** N'importe quel message de la conversation. */
  public readonly messageId = input.required<string>();

  /** Lu / non lu a changé, ou un message est parti : la liste doit se relire. */
  public readonly changed = output<void>();
  /** Le lead ou le client de la conversation, pour le panneau de droite ; `null` sans lien. */
  public readonly contact = output<MailThreadContact | null>();

  public readonly thread = signal<MailThreadDto | null>(null);
  public readonly isLoading = signal(true);
  public readonly loadFailed = signal(false);
  public readonly expanded = signal<Set<string>>(new Set());
  public readonly downloading = signal<string | null>(null);
  public readonly links = signal<MailLinkDto[]>([]);

  public readonly partyLabel = partyLabel;
  public readonly messageDate = messageDate;

  public readonly latest = computed(() => {
    const messages = this.thread()?.messages ?? [];
    return messages[messages.length - 1] ?? null;
  });

  /** L'interlocuteur : le lead ou le client, sinon l'adresse du dernier échange. */
  public readonly counterpart = computed(() => {
    const named = this.links().find((l) => l.name)?.name;
    if (named) return named;
    const last = this.latest();
    if (!last) return '';
    return last.direction === 'Sent' ? (last.to ?? []).map((p) => partyLabel(p)).join(', ') : partyLabel(last.from);
  });

  public readonly replyContext = computed(() => {
    const link = this.links()[0];
    return {
      leadId: link?.entityType === 'Lead' ? link.entityId : null,
      clientId: link?.entityType === 'Client' ? link.entityId : null,
    };
  });

  constructor() {
    effect(() => {
      const id = this.messageId();
      untracked(() => this.load(id));
    });
  }

  public load(id = this.messageId()): void {
    this.isLoading.set(true);
    this.loadFailed.set(false);

    this._api
      .getMyMailThread(id)
      .pipe(
        catchError(() => {
          this.loadFailed.set(true);
          this.contact.emit(null);
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((thread) => {
        const messages = thread.messages ?? [];
        this.thread.set(thread);
        // Ce qui n'avait pas été lu reste déplié : c'est ce que l'agent vient lire.
        this.expanded.set(new Set(messages.filter((m) => !m.isRead).map((m) => m.id!)));

        const seen = new Map<string, MailLinkDto>();
        for (const l of messages.flatMap((m) => m.links ?? [])) seen.set(`${l.entityType}:${l.entityId}`, l);
        this.links.set([...seen.values()]);

        const last = messages[messages.length - 1];
        const first = this.links()[0];
        this.contact.emit(first ? { link: first, email: last ? this._counterpartAddress(last) : null } : null);

        if (messages.some((m) => !m.isRead)) this._setRead(id, true);
      });
  }

  public toggle(message: MailMessageDto): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(message.id!)) next.delete(message.id!);
      else next.add(message.id!);
      return next;
    });
  }

  public markUnread(): void {
    this._setRead(this.messageId(), false);
  }

  public avatar(m: MailMessageDto): string {
    return initials(partyLabel(m.from)) || (m.direction === 'Sent' ? 'V' : '?');
  }

  public avatarClass(mine: boolean): string {
    return mine ? 'bg-primary text-white' : 'bg-slate-100 text-slate-700';
  }

  public preview(m: MailMessageDto): string {
    return bodyPreview(m);
  }

  /** « De vous à aya@… » / « De aya@… à vous » — qui a écrit à qui, en une ligne. */
  public route(m: MailMessageDto): string {
    const cc = addressesOf(m.cc);
    const copy = cc.length > 0 ? ` · Cc ${cc.join(', ')}` : '';
    return m.direction === 'Sent'
      ? `De vous à ${addressesOf(m.to).join(', ')}${copy}`
      : `De ${m.from?.address ?? ''} à vous${copy}`;
  }

  public visibleAttachments(m: MailMessageDto): MailAttachmentDto[] {
    return (m.attachments ?? []).filter((a) => !a.isInline);
  }

  public linkRoute(link: MailLinkDto): unknown[] {
    return link.entityType === 'Client' ? ['/customers', link.entityId] : ['/leads', link.entityId];
  }

  /** Les octets viennent du fournisseur à l'ouverture : rien n'est gardé dans SANKORÉ. */
  public download(m: MailMessageDto, a: MailAttachmentDto): void {
    this.downloading.set(a.id ?? null);

    this._api
      .getMailAttachment(m.id!, a.id!)
      .pipe(
        // Le client généré type la réponse `object` ; c'est bien un `Blob` qui arrive (`responseType: 'blob'`).
        map((body) => body as unknown as Blob),
        catchError(() => {
          this._snackbar.error('Pièce jointe indisponible', 'Elle n’a pas pu être récupérée chez le fournisseur.');
          return EMPTY;
        }),
        finalize(() => this.downloading.set(null)),
      )
      .subscribe((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = a.name ?? 'piece-jointe';
        link.click();
        URL.revokeObjectURL(url);
      });
  }

  public forward(source: MailMessageDto): void {
    this._drawer
      .open<boolean, MailComposeDrawerData, MailComposeDrawer>(MailComposeDrawer, {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: { mode: 'forward', source, context: this.replyContext() },
      })
      .closed.subscribe((sent) => {
        if (sent) this.afterSend();
      });
  }

  /** La copie envoyée arrive par la synchro qui suit l'envoi : on relit un peu plus tard. */
  public afterSend(): void {
    setTimeout(() => {
      this.load();
      this.changed.emit();
    }, 6000);
  }

  private _counterpartAddress(m: MailMessageDto): string | null {
    return (m.direction === 'Sent' ? m.to?.[0]?.address : m.from?.address) ?? null;
  }

  private _setRead(id: string, isRead: boolean): void {
    this._api
      .setMailThreadRead(id, { isRead })
      .pipe(
        map(() => true),
        catchError(() => of(false)),
      )
      .subscribe((ok) => {
        if (!ok) {
          if (!isRead) this._snackbar.error('Non modifié', 'La conversation n’a pas pu être marquée non lue.');
          return;
        }
        if (!isRead) this._snackbar.success('Marquée non lue', 'Elle reste en tête des non lus.');
        this.thread.update((t) => (t ? { ...t, messages: (t.messages ?? []).map((m) => ({ ...m, isRead })) } : t));
        this.changed.emit();
      });
  }
}
