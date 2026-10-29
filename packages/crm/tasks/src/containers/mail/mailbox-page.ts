import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, EMPTY, finalize, forkJoin, of, Subject } from 'rxjs';
import {
  ConnectedAccountsApiService,
  ConnectedMailboxApiService,
  MailThreadCountsDto,
  MailThreadSummaryDto,
} from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { MailAccountsStore } from './mail-accounts.store';
import { MailComposeDrawer, MailComposeDrawerData } from './mail-compose-drawer';
import { MailContactPanel } from './mail-contact-panel';
import { initials, partyLabel, shortDate, syncedAgo } from './mail-labels';
import { MailScheduledDrawer } from './mail-scheduled-drawer';
import { MailScheduledStore } from './mail-scheduled.store';
import { MailThreadContact, MailThreadView } from './mail-thread-view';

const ALL = 'toutes';
const PAGE_SIZE = 25;

type MailTab = 'tout' | 'nonlus' | 'leads' | 'clients';

const TABS: { key: MailTab; label: string; count: keyof MailThreadCountsDto }[] = [
  { key: 'tout', label: 'Tout', count: 'all' },
  { key: 'nonlus', label: 'Non lus', count: 'unread' },
  { key: 'leads', label: 'Leads', count: 'leads' },
  { key: 'clients', label: 'Clients', count: 'clients' },
];

/**
 * « Messagerie » : les conversations des boîtes de l'agent qui concernent un lead ou un client —
 * le serveur n'en garde pas d'autres —, la conversation ouverte au centre, et à droite le lead ou
 * le client à qui l'on parle (refonte d'après la maquette du propriétaire, 2026-10-28).
 *
 * La boîte, l'onglet, la recherche et la conversation ouverte vivent dans l'URL (`boite`, `onglet`,
 * `q`, `fil`), comme les autres listes : un lien ou un retour arrière rouvre le même état. La
 * recherche est faite par le serveur, sur les seuls messages de l'agent (objets et adresses sont
 * chiffrés : il déchiffre pour chercher).
 */
@Component({
  selector: 'mailbox-page',
  templateUrl: './mailbox-page.html',
  imports: [
    FormsModule, RouterLink, Anchor, Button, TasIcon, Menu, MenuItem, TasMenuTrigger, TasSpinner,
    MailThreadView, MailContactPanel,
  ],
})
export class MailboxPage implements OnInit {
  private readonly _accountsApi = inject(ConnectedAccountsApiService);
  private readonly _mailApi = inject(ConnectedMailboxApiService);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _search$ = new Subject<string>();
  private readonly _store = inject(MailAccountsStore);
  public readonly scheduled = inject(MailScheduledStore);

  public readonly tabs = TABS;

  public readonly loadingAccounts = signal(true);
  public readonly accounts = this._store.accounts;
  public readonly mailboxes = this._store.mailboxes;

  public readonly accountFilter = signal(ALL);
  public readonly tab = signal<MailTab>('tout');
  public readonly search = signal('');
  public readonly selected = signal<string | null>(null);
  public readonly contact = signal<MailThreadContact | null>(null);

  public readonly threads = signal<MailThreadSummaryDto[]>([]);
  public readonly counts = signal<MailThreadCountsDto | null>(null);
  public readonly isLoading = signal(false);
  public readonly loadFailed = signal(false);
  public readonly syncing = signal(false);

  /** Les conversations de l'onglet sous la même recherche : ce qui reste à « Afficher plus ». */
  public readonly total = signal(0);
  public readonly loadingMore = signal(false);
  public readonly remaining = computed(() => Math.max(0, this.total() - this.threads().length));

  /** La boîte de la pastille : celle choisie, ou la seule ; sinon « Toutes mes boîtes ». */
  public readonly currentMailbox = computed(() => {
    const boxes = this.mailboxes();
    return boxes.find((a) => a.id === this.accountFilter()) ?? (boxes.length === 1 ? boxes[0] : null);
  });

  public readonly mailboxLabel = computed(() => {
    const box = this.currentMailbox();
    return box ? box.email ?? box.label ?? '' : `Toutes mes boîtes (${this.mailboxes().length})`;
  });

  /** La lecture la plus ancienne des boîtes affichées : c'est elle qui dit jusqu'où la liste est à jour. */
  public readonly syncLabel = computed(() => {
    const box = this.currentMailbox();
    if (box) return syncedAgo(box.mailSyncedAt);
    const dates = this.mailboxes().map((b) => b.mailSyncedAt).filter((d): d is string => !!d).sort();
    return syncedAgo(dates[0]);
  });

  /** Une boîte à reconnecter ne se lit plus : l'agent doit le savoir ici, pas seulement dans Mon compte. */
  public readonly brokenMailboxes = computed(() => this.mailboxes().filter((a) => a.status === 'NeedsReconnect' || a.mailLastError));

  public readonly shortDate = shortDate;
  public readonly syncedAgo = syncedAgo;

  ngOnInit(): void {
    this._breadcrumb.set([{ label: 'Messagerie' }]);

    const params = this._route.snapshot.queryParamMap;
    this.accountFilter.set(params.get('boite') ?? ALL);
    // `nonlus=1` : les liens d'avant les onglets (compteur du menu, favoris) ouvrent toujours les non-lus.
    this.tab.set(TABS.find((t) => t.key === params.get('onglet'))?.key ?? (params.get('nonlus') === '1' ? 'nonlus' : 'tout'));
    this.search.set(params.get('q') ?? '');
    this.selected.set(params.get('fil'));

    // Différée de 300 ms : le serveur déchiffre pour chercher, pas à chaque frappe.
    this._search$.pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef)).subscribe(() => this._firstPage());

    this._loadAccounts();
    this.scheduled.refresh();
    // Le lien de la cloche (« un e-mail programmé n'est pas parti ») ouvre la liste.
    if (params.get('programmes') === '1') this.openScheduled();
  }

  public openScheduled(): void {
    this._drawer
      .open<boolean, unknown, MailScheduledDrawer>(MailScheduledDrawer, { width: '100%', height: '100%', panelClass: 'side-drawer-panel' })
      .closed.subscribe(() => this.scheduled.refresh());
    if (this._route.snapshot.queryParamMap.get('programmes')) {
      this._router.navigate([], { relativeTo: this._route, queryParams: { programmes: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  /**
   * Relit la liste depuis le début, en gardant ce qui est déjà affiché : après un envoi ou un
   * « marquer non lu », la liste ne doit pas retomber à 25 lignes sous les yeux de l'agent.
   */
  public load(): void {
    const shown = Math.ceil(this.threads().length / PAGE_SIZE) * PAGE_SIZE;
    this._fetch(1, Math.min(100, Math.max(PAGE_SIZE, shown)), false);
  }

  /** Les 25 conversations suivantes, ajoutées sous les autres. */
  public loadMore(): void {
    if (this.loadingMore() || this.remaining() === 0) return;
    this._fetch(Math.floor(this.threads().length / PAGE_SIZE) + 1, PAGE_SIZE, true);
  }

  private _fetch(page: number, pageSize: number, append: boolean): void {
    const tab = this.tab();
    (append ? this.loadingMore : this.isLoading).set(true);
    this.loadFailed.set(false);

    this._mailApi
      .listMyMailThreads(
        this.accountFilter() === ALL ? undefined : this.accountFilter(),
        tab === 'nonlus',
        page,
        pageSize,
        tab === 'leads' ? 'Lead' : tab === 'clients' ? 'Client' : undefined,
        this.search().trim() || undefined,
      )
      .pipe(
        catchError(() => {
          if (!append) this.loadFailed.set(true);
          else this._snackbar.error('Erreur', 'Les conversations suivantes n’ont pas pu être chargées.');
          return EMPTY;
        }),
        finalize(() => (append ? this.loadingMore : this.isLoading).set(false)),
      )
      .subscribe((result) => {
        const items = result.items ?? [];
        // Un e-mail arrivé entre deux pages décale la liste : une conversation ne s'affiche qu'une fois.
        this.threads.update((list) =>
          append ? [...list, ...items.filter((t) => !list.some((l) => l.latestMessageId === t.latestMessageId))] : items,
        );
        this.counts.set(result.counts ?? null);
        this.total.set(result.totalCount ?? 0);
      });
  }

  public setAccount(value: string): void {
    this.accountFilter.set(value || ALL);
    this._firstPage();
  }

  public setTab(tab: MailTab): void {
    if (this.tab() === tab) return;
    this.tab.set(tab);
    this._firstPage();
  }

  public onSearch(value: string): void {
    this.search.set(value);
    this._search$.next(value);
  }

  public clearSearch(): void {
    this.search.set('');
    this._firstPage();
  }

  public open(thread: MailThreadSummaryDto): void {
    this.selected.set(thread.latestMessageId ?? null);
    this._syncUrl();
  }

  public closeThread(): void {
    this.selected.set(null);
    this.contact.set(null);
    this._syncUrl();
  }

  /** Lit maintenant la boîte affichée (ou toutes) ; la liste se relit quand la lecture a eu le temps de finir. */
  public syncNow(): void {
    const box = this.currentMailbox();
    const boxes = box ? [box] : this.mailboxes();
    if (boxes.length === 0 || this.syncing()) return;
    this.syncing.set(true);

    forkJoin(boxes.map((b) => this._mailApi.syncMyMailbox(b.id!).pipe(catchError(() => of(null))))).subscribe(() => {
      this._snackbar.info('Lecture en cours', 'Les nouveaux e-mails arrivent dans quelques secondes.');
      setTimeout(() => {
        this.syncing.set(false);
        this._loadAccounts();
      }, 8000);
    });
  }

  public compose(): void {
    this._drawer
      .open<boolean, MailComposeDrawerData, MailComposeDrawer>(MailComposeDrawer, {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: { mode: 'new', accountId: this.accountFilter() === ALL ? null : this.accountFilter() },
      })
      .closed.subscribe((sent) => {
        if (sent) setTimeout(() => this.load(), 6000);
      });
  }

  /** La conversation ouverte appartient-elle à cette ligne ? Son identifiant est celui du DERNIER message, qui change à chaque réponse. */
  public isSelected(thread: MailThreadSummaryDto): boolean {
    return !!this.selected() && thread.latestMessageId === this.selected();
  }

  /** Le nom de la ligne : le lead ou le client s'il est connu, sinon l'interlocuteur. */
  public rowName(thread: MailThreadSummaryDto): string {
    const named = (thread.links ?? []).find((l) => l.name)?.name;
    if (named) return named;
    if (thread.lastDirection === 'Sent') return (thread.to ?? []).map((p) => partyLabel(p)).join(', ');
    return partyLabel(thread.from);
  }

  public rowInitials(thread: MailThreadSummaryDto): string {
    return initials(this.rowName(thread));
  }

  public rowKind(thread: MailThreadSummaryDto): 'Lead' | 'Client' | null {
    const kind = thread.links?.[0]?.entityType;
    return kind === 'Lead' || kind === 'Client' ? kind : null;
  }

  private _loadAccounts(): void {
    this._accountsApi
      .listMyConnectedAccounts()
      .pipe(
        catchError(() => of({ accounts: [] })),
        finalize(() => this.loadingAccounts.set(false)),
      )
      .subscribe((result) => {
        this._store.set(result.accounts ?? []);
        if (this.mailboxes().length > 0) this.load();
      });
  }

  private _firstPage(): void {
    this.threads.set([]);
    this._syncUrl();
    this.load();
  }

  private _syncUrl(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        boite: this.accountFilter() === ALL ? null : this.accountFilter(),
        onglet: this.tab() === 'tout' ? null : this.tab(),
        q: this.search().trim() || null,
        fil: this.selected(),
        nonlus: null,
      },
      replaceUrl: true,
    });
  }
}

export default MailboxPage;
