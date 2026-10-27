import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PageEvent } from '@angular/material/paginator';
import { catchError, EMPTY, finalize, of } from 'rxjs';
import { ConnectedAccountDto, ConnectedAccountsApiService, ConnectedMailboxApiService, MailThreadSummaryDto } from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { MailComposeDrawer, MailComposeDrawerData } from './mail-compose-drawer';
import { partyLabel, shortDate } from './mail-labels';
import { MailThreadView } from './mail-thread-view';

const ALL = 'toutes';
const PAGE_SIZE = 25;

/**
 * « Messagerie » (messagerie connectée, lot 5) : les conversations des boîtes de l'agent qui
 * concernent un lead ou un client — le serveur n'en garde pas d'autres — à gauche, la conversation
 * ouverte à droite. Les filtres et la conversation ouverte vivent dans l'URL (`boite`, `nonlus`,
 * `fil`), comme les autres listes : un lien ou un retour arrière rouvre le même état.
 *
 * Pas de recherche texte : les objets et adresses sont chiffrés côté serveur, chercher dedans
 * voudrait tout déchiffrer.
 */
@Component({
  selector: 'mailbox-page',
  templateUrl: './mailbox-page.html',
  imports: [FormsModule, RouterLink, Anchor, Button, TasIcon, TasSelect, TasSpinner, TasTable, MailThreadView],
})
export class MailboxPage implements OnInit {
  private readonly _accountsApi = inject(ConnectedAccountsApiService);
  private readonly _mailApi = inject(ConnectedMailboxApiService);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _breadcrumb = inject(BreadcrumbService);

  public readonly loadingAccounts = signal(true);
  public readonly accounts = signal<ConnectedAccountDto[]>([]);
  public readonly mailboxes = computed(() => this.accounts().filter((a) => a.mailEnabled));

  public readonly accountFilter = signal(ALL);
  public readonly unreadOnly = signal(false);
  public readonly selected = signal<string | null>(null);

  public readonly threads = signal<MailThreadSummaryDto[]>([]);
  public readonly isLoading = signal(false);
  public readonly loadFailed = signal(false);

  public readonly config = signal<TableConfig>({
    property: 'mail-threads',
    pagination: { serverSide: true, pageIndex: 0, pageSize: PAGE_SIZE, pageSizeOptions: [25, 50], totalElements: 0 },
  });

  public readonly accountOptions = computed(() => [
    { label: 'Toutes mes boîtes', value: ALL },
    ...this.mailboxes().map((a) => ({ label: a.label ?? a.email ?? '', value: a.id ?? '' })),
  ]);

  /** Une boîte à reconnecter ne se lit plus : l'agent doit le savoir ici, pas seulement dans Mon compte. */
  public readonly brokenMailboxes = computed(() => this.mailboxes().filter((a) => a.status === 'NeedsReconnect' || a.mailLastError));

  public readonly partyLabel = partyLabel;
  public readonly shortDate = shortDate;

  ngOnInit(): void {
    this._breadcrumb.set([{ label: 'Messagerie' }]);

    const params = this._route.snapshot.queryParamMap;
    this.accountFilter.set(params.get('boite') ?? ALL);
    this.unreadOnly.set(params.get('nonlus') === '1');
    this.selected.set(params.get('fil'));

    this._accountsApi
      .listMyConnectedAccounts()
      .pipe(
        catchError(() => of({ accounts: [] })),
        finalize(() => this.loadingAccounts.set(false)),
      )
      .subscribe((result) => {
        this.accounts.set(result.accounts ?? []);
        if (this.mailboxes().length > 0) this.load();
      });
  }

  public load(): void {
    const { pageIndex, pageSize } = this.config().pagination!;
    this.isLoading.set(true);
    this.loadFailed.set(false);

    this._mailApi
      .listMyMailThreads(this.accountFilter() === ALL ? undefined : this.accountFilter(), this.unreadOnly(), pageIndex + 1, pageSize)
      .pipe(
        catchError(() => {
          this.loadFailed.set(true);
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((page) => {
        this.threads.set(page.items ?? []);
        this.config.update((c) => ({ ...c, pagination: { ...c.pagination!, totalElements: page.totalCount ?? 0 } }));
      });
  }

  public setAccount(value: string): void {
    this.accountFilter.set(value || ALL);
    this._firstPage();
  }

  public setUnreadOnly(value: boolean): void {
    this.unreadOnly.set(value);
    this._firstPage();
  }

  public onPage(event: PageEvent): void {
    this.config.update((c) => ({ ...c, pagination: { ...c.pagination!, pageIndex: event.pageIndex, pageSize: event.pageSize } }));
    this.load();
  }

  public open(thread: MailThreadSummaryDto): void {
    this.selected.set(thread.latestMessageId ?? null);
    this._syncUrl();
  }

  public closeThread(): void {
    this.selected.set(null);
    this._syncUrl();
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

  public counterparts(thread: MailThreadSummaryDto): string {
    if (thread.lastDirection === 'Sent') return 'À ' + (thread.to ?? []).map((p) => partyLabel(p)).join(', ');
    return partyLabel(thread.from);
  }

  private _firstPage(): void {
    this.config.update((c) => ({ ...c, pagination: { ...c.pagination!, pageIndex: 0 } }));
    this._syncUrl();
    this.load();
  }

  private _syncUrl(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        boite: this.accountFilter() === ALL ? null : this.accountFilter(),
        nonlus: this.unreadOnly() ? '1' : null,
        fil: this.selected(),
      },
      replaceUrl: true,
    });
  }
}

export default MailboxPage;
