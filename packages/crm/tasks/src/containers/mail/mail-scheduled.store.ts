import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { ConnectedMailboxApiService, ScheduledMailDto } from '@sankore/crm-api';

/**
 * Les e-mails programmés de l'agent : le compteur « Programmés » de la Messagerie suit chaque
 * programmation faite depuis la réponse rapide ou le tiroir de rédaction.
 */
@Injectable({ providedIn: 'root' })
export class MailScheduledStore {
  private readonly _api = inject(ConnectedMailboxApiService);

  public readonly mails = signal<ScheduledMailDto[]>([]);
  public readonly count = computed(() => this.mails().length);
  public readonly failed = computed(() => this.mails().filter((m) => m.status === 'Failed').length);

  public refresh(): void {
    this._api.listMyScheduledMails().pipe(catchError(() => of(null))).subscribe((list) => {
      if (list) this.mails.set(list);
    });
  }
}
