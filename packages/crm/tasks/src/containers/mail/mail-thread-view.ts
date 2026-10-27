import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY, finalize, map, of } from 'rxjs';
import { ConnectedMailboxApiService, MailAttachmentDto, MailLinkDto, MailMessageDto, MailThreadDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { MailBody } from './mail-body';
import { MailComposeDrawer, MailComposeDrawerData, MailComposeMode } from './mail-compose-drawer';
import { addressesOf, partyLabel } from './mail-labels';

/**
 * Une conversation de la messagerie (lot 5), du plus ancien au plus récent. Les messages sont des
 * cartes empilées et non un `tas-table` : c'est un FIL qu'on lit dans l'ordre, comme le fil
 * WhatsApp et celui des tickets de support (mêmes exceptions validées) — pas une liste qu'on trie
 * ou qu'on pagine. Les messages lus d'avant sont repliés ; un clic les déplie.
 *
 * Ouvrir une conversation la marque lue chez le fournisseur comme ici.
 */
@Component({
  selector: 'mail-thread-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, Button, TasIcon, TasSpinner, MailBody],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-16"><tas-spinner size="8" class="text-primary"></tas-spinner></div>
    } @else if (loadFailed()) {
      <div class="flex flex-col items-center gap-3 py-16 text-center" role="alert">
        <p class="text-sm text-slate-600">Cette conversation n’a pas pu être chargée.</p>
        <button tas-outlined-button color="primary" type="button" (click)="load()">Réessayer</button>
      </div>
    } @else if (thread(); as t) {
      <header class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div class="min-w-0 flex-1">
          <h2 class="text-lg font-semibold text-slate-900">{{ t.subject || '(sans objet)' }}</h2>
          <p class="mt-0.5 text-xs text-slate-500">{{ t.accountLabel }} · {{ t.messages?.length }} message{{ (t.messages?.length ?? 0) > 1 ? 's' : '' }}</p>
          @if (links().length > 0) {
            <div class="mt-2 flex flex-wrap gap-1.5">
              @for (l of links(); track l.entityId) {
                <a [routerLink]="linkRoute(l)" class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary hover:underline">
                  <tas-icon [iconName]="l.entityType === 'Client' ? 'feather:user' : 'feather:target'" iconClass="!size-3"></tas-icon>
                  {{ l.name || (l.entityType === 'Client' ? 'Client' : 'Lead') }}
                </a>
              }
            </div>
          }
        </div>
        <button tas-text-button type="button" (click)="markUnread()">
          <tas-icon iconName="feather:mail" iconClass="!size-3.5"></tas-icon> Marquer non lu
        </button>
      </header>

      <div class="flex flex-col gap-3 pt-4">
        @for (m of t.messages ?? []; track m.id; let last = $last) {
          @let open = last || expanded().has(m.id!);
          <article class="rounded-xl border bg-white" [class]="m.direction === 'Sent' ? 'border-primary/20' : 'border-slate-200'">
            <button type="button" class="flex w-full items-start gap-3 px-4 py-3 text-left" [attr.aria-expanded]="open" (click)="toggle(m)">
              <span class="grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold"
                    [class]="m.direction === 'Sent' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'" aria-hidden="true">
                {{ initials(m) }}
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-baseline justify-between gap-3">
                  <span class="truncate text-sm font-semibold text-slate-900">
                    {{ m.direction === 'Sent' ? 'Vous' : partyLabel(m.from) }}
                    @if (m.direction !== 'Sent' && m.from?.name) { <span class="font-normal text-slate-500">&lt;{{ m.from.address }}&gt;</span> }
                  </span>
                  <span class="shrink-0 text-xs text-slate-500 tabular-nums">{{ m.sentAt | date: 'dd/MM/yyyy HH:mm' }}</span>
                </span>
                <span class="block truncate text-xs text-slate-500">
                  À {{ recipients(m) }}
                </span>
              </span>
            </button>

            @if (open) {
              <div class="border-t border-slate-100 px-4 py-3">
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

                <div class="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  <button tas-outlined-button color="primary" type="button" (click)="compose('reply', m)">
                    <tas-icon iconName="feather:corner-up-left" iconClass="!size-3.5"></tas-icon> Répondre
                  </button>
                  @if (canReplyAll(m)) {
                    <button tas-outlined-button type="button" (click)="compose('replyAll', m)">
                      <tas-icon iconName="feather:corner-up-left" iconClass="!size-3.5"></tas-icon> Répondre à tous
                    </button>
                  }
                  <button tas-outlined-button type="button" (click)="compose('forward', m)">
                    <tas-icon iconName="feather:corner-up-right" iconClass="!size-3.5"></tas-icon> Transférer
                  </button>
                </div>
              </div>
            }
          </article>
        }
      </div>
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

  public readonly thread = signal<MailThreadDto | null>(null);
  public readonly isLoading = signal(true);
  public readonly loadFailed = signal(false);
  public readonly expanded = signal<Set<string>>(new Set());
  public readonly downloading = signal<string | null>(null);
  public readonly links = signal<MailLinkDto[]>([]);

  public readonly partyLabel = partyLabel;

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

  public initials(m: MailMessageDto): string {
    if (m.direction === 'Sent') return 'V';
    const label = partyLabel(m.from);
    return label.slice(0, 1).toUpperCase() || '?';
  }

  public recipients(m: MailMessageDto): string {
    const to = addressesOf(m.to);
    const cc = addressesOf(m.cc);
    return to.join(', ') + (cc.length ? ` · Cc ${cc.join(', ')}` : '');
  }

  public canReplyAll(m: MailMessageDto): boolean {
    return addressesOf(m.to).length + addressesOf(m.cc).length > 1;
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

  public compose(mode: MailComposeMode, source: MailMessageDto): void {
    const link = this.links()[0];
    this._drawer
      .open<boolean, MailComposeDrawerData, MailComposeDrawer>(MailComposeDrawer, {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: {
          mode,
          source,
          context: {
            leadId: link?.entityType === 'Lead' ? link.entityId : null,
            clientId: link?.entityType === 'Client' ? link.entityId : null,
          },
        },
      })
      .closed.subscribe((sent) => {
        // La copie envoyée arrive par la synchro qui suit l'envoi : on relit un peu plus tard.
        if (sent) setTimeout(() => {
          this.load();
          this.changed.emit();
        }, 6000);
      });
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
        this.thread.update((t) => (t ? { ...t, messages: (t.messages ?? []).map((m) => ({ ...m, isRead })) } : t));
        this.changed.emit();
      });
  }
}
