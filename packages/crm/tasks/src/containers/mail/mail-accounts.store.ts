import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, finalize, of } from 'rxjs';
import { ConnectedAccountDto, ConnectedAccountsApiService } from '@sankore/crm-api';

/**
 * Les boîtes de l'agent, lues une fois pour la Messagerie, la réponse rapide et le tiroir de
 * rédaction : chacun avait sa lecture, et la signature d'une boîte doit être la même partout —
 * celle qu'on vient d'enregistrer compris.
 */
@Injectable({ providedIn: 'root' })
export class MailAccountsStore {
  private readonly _api = inject(ConnectedAccountsApiService);
  private _loaded = false;

  public readonly accounts = signal<ConnectedAccountDto[]>([]);
  public readonly isLoading = signal(false);
  /** Une première lecture a répondu : avant, « aucune boîte » ne veut encore rien dire. */
  public readonly loaded = signal(false);
  public readonly mailboxes = computed(() => this.accounts().filter((a) => a.mailEnabled));

  /** Lit les boîtes ; sans `force`, une seule fois par session de page. */
  public load(force = false): void {
    if ((this._loaded && !force) || this.isLoading()) return;
    this.isLoading.set(true);
    this._api
      .listMyConnectedAccounts()
      .pipe(
        catchError(() => of({ accounts: [] })),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((result) => {
        this._loaded = true;
        this.loaded.set(true);
        this.accounts.set(result.accounts ?? []);
      });
  }

  /** La Messagerie lit les boîtes elle-même (pour « Lire maintenant ») et partage ce qu'elle a lu. */
  public set(accounts: ConnectedAccountDto[]): void {
    this._loaded = true;
    this.loaded.set(true);
    this.accounts.set(accounts);
  }

  public signatureOf(accountId: string | null | undefined): string | null {
    return this.accounts().find((a) => a.id === accountId)?.mailSignature ?? null;
  }

  /** Après un enregistrement : l'écran suit sans relire le serveur. */
  public setSignature(accountId: string, signature: string | null): void {
    this.accounts.update((list) => list.map((a) => (a.id === accountId ? { ...a, mailSignature: signature } : a)));
  }
}
