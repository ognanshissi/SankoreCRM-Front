import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY, of } from 'rxjs';
import {
  ProductDto,
  ProductsApiService,
  UsersApiService,
  WhatsAppApiService,
  WhatsAppInboxDto,
  WhatsAppInboxItemDto,
} from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { CONVERSATION_STATUS } from '../edit-lead/whatsapp/whatsapp-labels';
import { WhatsAppRealtime } from '../edit-lead/whatsapp/whatsapp-realtime';

type InboxTab = 'ToHandle' | 'Human' | 'AwaitingReply' | 'Bot' | 'Closed';

const TABS: ReadonlyArray<{ value: InboxTab; label: string }> = [
  { value: 'ToHandle', label: 'À traiter' },
  { value: 'Human', label: 'Pris en charge' },
  { value: 'AwaitingReply', label: 'En attente du client' },
  { value: 'Bot', label: 'Bot actif' },
  { value: 'Closed', label: 'Clôturées' },
];

const PAGE = 30;

/**
 * L'inbox WhatsApp (WA-FE-09) : la file de l'utilisateur, par onglet, triée par urgence — délai de
 * prise en charge pour ce qui attend une personne, fermeture de la fenêtre pour ce qu'un agent
 * tient. Un superviseur filtre par agent et par produit ; le périmètre, lui, est celui que le
 * serveur applique. Un clic ouvre l'onglet WhatsApp de la fiche.
 *
 * La liste passe par `tas-table` (une carte par ligne) ; la suite se charge par curseur avec
 * « Afficher plus », le tableau paginant ce qui est déjà chargé.
 */
@Component({
  selector: 'whatsapp-inbox-page',
  templateUrl: './whatsapp-inbox-page.html',
  imports: [FormsModule, TasTable, TasIcon, TasSelect, Button, TimeagoPipe],
  providers: [WhatsAppRealtime],
})
export class WhatsAppInboxPage implements OnInit {
  private readonly _api = inject(WhatsAppApiService);
  private readonly _users = inject(UsersApiService);
  private readonly _products = inject(ProductsApiService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  public readonly realtime = inject(WhatsAppRealtime);

  public readonly tabs = TABS;
  public readonly isSupervisor = this._permissions.can('WhatsApp.Supervise');

  public readonly tab = signal<InboxTab>('ToHandle');
  public readonly agentFilter = signal('');
  public readonly productFilter = signal('');
  public readonly unreadOnly = signal(false);

  public readonly isLoading = signal(true);
  public readonly isLoadingMore = signal(false);
  public readonly items = signal<WhatsAppInboxItemDto[]>([]);
  public readonly counts = signal<Record<string, number>>({});
  public readonly unreadConversations = signal(0);
  public readonly nextCursor = signal<string | null>(null);
  public readonly now = signal(Date.now());

  public readonly agentOptions = signal<{ label: string; value: string }[]>([]);
  public readonly productOptions = signal<{ label: string; value: string }[]>([]);

  public readonly tableConfig = computed<TableConfig>(() => ({
    property: 'whatsapp-inbox',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 50, pageSizeOptions: [50] },
  }));

  public readonly statusOf = (status: string | null | undefined) =>
    CONVERSATION_STATUS[status ?? ''] ?? { label: status ?? '', tone: 'bg-slate-100 text-slate-700', icon: 'feather:message-circle' };

  constructor() {
    const timer = setInterval(() => {
      this.now.set(Date.now());
      if (document.visibilityState === 'visible' && !this.realtime.connected()) this._load(false);
    }, 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  public ngOnInit(): void {
    this._breadcrumb.set([{ label: 'Leads', link: ['/leads'] }, { label: 'WhatsApp' }]);

    // Les filtres vivent dans l'URL, comme sur la liste des leads : un lien partagé rouvre la même vue.
    const params = this._route.snapshot.queryParamMap;
    const tab = params.get('onglet') as InboxTab | null;
    if (tab && TABS.some((t) => t.value === tab)) this.tab.set(tab);
    this.agentFilter.set(params.get('agent') ?? '');
    this.productFilter.set(params.get('produit') ?? '');
    this.unreadOnly.set(params.get('nonLus') === '1');

    // Une conversation sans fiche (un numéro inconnu, un client) s'ouvre ici, filtrée sur elle.
    const conversation = params.get('conversation');
    if (conversation) this.tab.set('ToHandle');

    this._load(false);
    this.realtime.connect(() => this._load(false), () => this._load(false));

    if (this.isSupervisor()) {
      this._users.listUsers('Active', undefined, undefined, 1, 500).pipe(catchError(() => of({ items: [] })))
        .subscribe((res) => this.agentOptions.set([
          { label: 'Tous les agents', value: '' },
          ...(res.items ?? []).filter((u) => u.id).map((u) => ({ label: u.fullName?.trim() || u.email || '—', value: u.id! }))
            .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
        ]));

      this._products.listProducts().pipe(catchError(() => of([] as ProductDto[])))
        .subscribe((products) => this.productOptions.set([
          { label: 'Tous les produits', value: '' },
          ...(products ?? []).filter((p) => p.id).map((p) => ({ label: p.name ?? p.code ?? '—', value: p.id! })),
        ]));
    }
  }

  public setTab(tab: InboxTab): void {
    this.tab.set(tab);
    this._persist();
    this._load(false);
  }

  public setAgent(value: string): void {
    this.agentFilter.set(value ?? '');
    this._persist();
    this._load(false);
  }

  public setProduct(value: string): void {
    this.productFilter.set(value ?? '');
    this._persist();
    this._load(false);
  }

  public toggleUnread(): void {
    this.unreadOnly.update((v) => !v);
    this._persist();
    this._load(false);
  }

  public loadMore(): void {
    this._load(true);
  }

  public open(item: WhatsAppInboxItemDto): void {
    if (item.route) this._router.navigateByUrl(item.route);
  }

  /** Le délai de prise en charge, ou la fenêtre, selon l'onglet — ce qui fait l'urgence. */
  public urgency(item: WhatsAppInboxItemDto): { label: string; tone: string } | null {
    if (item.status === 'PendingHuman' && item.takeoverDeadline) {
      const left = new Date(item.takeoverDeadline).getTime() - this.now();
      if (item.takeoverBreached || left <= 0) return { label: 'Délai dépassé', tone: 'bg-red-50 text-red-700' };
      const minutes = Math.max(1, Math.round(left / 60_000));
      return { label: `${minutes} min pour prendre la main`, tone: minutes <= 5 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800' };
    }
    if (item.status === 'Human' && item.windowExpiresAt) {
      const left = new Date(item.windowExpiresAt).getTime() - this.now();
      if (left <= 0) return { label: 'Fenêtre expirée', tone: 'bg-slate-100 text-slate-600' };
      const hours = Math.floor(left / 3_600_000);
      const minutes = Math.floor((left % 3_600_000) / 60_000);
      return {
        label: `Fenêtre : ${hours > 0 ? `${hours} h ${String(minutes).padStart(2, '0')}` : `${minutes} min`}`,
        tone: left < 2 * 3_600_000 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800',
      };
    }
    return null;
  }

  public who(item: WhatsAppInboxItemDto): string | null {
    if (item.status === 'Human') return item.ownerName ? `Pris par ${item.ownerName}` : null;
    if (item.status === 'PendingHuman') return item.targetAgentName ? `Attendu : ${item.targetAgentName}` : 'À attribuer';
    return null;
  }

  private _load(append: boolean): void {
    if (append) this.isLoadingMore.set(true);
    else this.isLoading.set(true);

    this._api.listWhatsAppConversations(
      this.tab(),
      this.agentFilter() || undefined,
      this.productFilter() || undefined,
      this.unreadOnly() || undefined,
      append ? this.nextCursor() ?? undefined : undefined,
      PAGE,
    ).pipe(
      catchError(() => {
        this.isLoading.set(false);
        this.isLoadingMore.set(false);
        return EMPTY;
      }),
    ).subscribe((page: WhatsAppInboxDto) => {
      this.items.update((current) => (append ? [...current, ...(page.items ?? [])] : page.items ?? []));
      this.counts.set(page.counts ?? {});
      this.unreadConversations.set(page.unreadConversations ?? 0);
      this.nextCursor.set(page.nextCursor ?? null);
      this.isLoading.set(false);
      this.isLoadingMore.set(false);
    });
  }

  private _persist(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      replaceUrl: true,
      queryParams: {
        onglet: this.tab() === 'ToHandle' ? null : this.tab(),
        agent: this.agentFilter() || null,
        produit: this.productFilter() || null,
        nonLus: this.unreadOnly() ? '1' : null,
      },
    });
  }
}

export default WhatsAppInboxPage;
