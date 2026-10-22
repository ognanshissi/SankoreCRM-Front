import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { catchError, debounceTime, filter, forkJoin, map, Observable, of } from 'rxjs';
import { KYCApiService, LeadsApiService, WhatsAppApiService, WorkflowAnalyticsApiService } from '@sankore/crm-api';
import { PERMISSIONS } from '../../../models/permissions';
import { AuthenticationService } from '../../../services/authentification.service';
import { PermissionsService } from '../../../services/permissions.service';
import { NavBadgeKey } from './portal-navigation';

/** Un travail en attente toutes les deux minutes suffit : ce sont des rappels, pas des alarmes. */
const REFRESH_MS = 120_000;

/**
 * Les compteurs de la barre latérale. Chacun dit « il y a du travail pour vous ici » et vient
 * d'un endpoint qui existe déjà pour l'écran qu'il annonce, pour que le chiffre de la barre et
 * celui de l'écran ne puissent pas se contredire :
 *
 * - WhatsApp : l'onglet « À traiter » de la boîte (`counts.ToHandle`), dans le périmètre de
 *   l'utilisateur — un client attend une personne ;
 * - Leads : les leads de l'utilisateur encore « Nouveau », pas encore contactés ;
 * - Dossiers KYC : ceux qui attendent SA décision (`awaitingMeCount`) ;
 * - Suivi des workflows : les instances bloquées et les étapes en retard.
 *
 * Un compteur dont le droit manque n'est pas demandé, et un échec le laisse à zéro sans bruit :
 * la barre ne doit jamais afficher une erreur pour un rappel.
 */
@Injectable({ providedIn: 'root' })
export class NavBadges {
  private readonly _whatsapp = inject(WhatsAppApiService);
  private readonly _leads = inject(LeadsApiService);
  private readonly _kyc = inject(KYCApiService);
  private readonly _workflows = inject(WorkflowAnalyticsApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _router = inject(Router);
  private readonly _isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly _counts = signal<Partial<Record<NavBadgeKey, number>>>({});
  public readonly counts = this._counts.asReadonly();

  private _started = false;

  /** Appelé par la mise en page ; sans effet côté serveur, et une seule fois. */
  public start(destroyRef: DestroyRef): void {
    if (!this._isBrowser || this._started) return;
    this._started = true;

    this.refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') this.refresh();
    }, REFRESH_MS);

    // Après une action (un lead contacté, un dossier décidé), le retour à une autre page remet
    // les chiffres à jour sans attendre deux minutes.
    const nav = this._router.events
      .pipe(filter((e) => e instanceof NavigationEnd), debounceTime(1500))
      .subscribe(() => this.refresh());

    destroyRef.onDestroy(() => {
      clearInterval(timer);
      nav.unsubscribe();
      this._started = false;
    });
  }

  public refresh(): void {
    const me = this._auth.connectedUser()?.id;
    if (!me) return;

    const calls: Partial<Record<NavBadgeKey, Observable<number>>> = {};

    if (this._permissions.has(PERMISSIONS.WHATSAPP_SEND, PERMISSIONS.WHATSAPP_REPLY, PERMISSIONS.WHATSAPP_SUPERVISE)) {
      calls.whatsapp = this._whatsapp
        .listWhatsAppConversations('ToHandle', undefined, undefined, undefined, undefined, 1)
        .pipe(map((inbox) => inbox.counts?.['ToHandle'] ?? 0));
    }

    if (this._permissions.has(PERMISSIONS.LEAD_READ)) {
      calls.leads = this._leads.listLeads(1, 1, 'New', undefined, undefined, me).pipe(map((page) => page.totalCount ?? 0));
    }

    if (this._permissions.has(PERMISSIONS.KYC_READ)) {
      calls.kyc = this._kyc
        .listKycFiles(undefined, undefined, undefined, undefined, undefined, 1, 1)
        .pipe(map((page) => page.awaitingMeCount ?? 0));
    }

    if (this._permissions.has(PERMISSIONS.WORKFLOW_ANALYTICS_VIEW)) {
      calls.workflows = forkJoin([this._workflows.getExecutionMonitor(), this._workflows.getSlaDashboard()]).pipe(
        map(([monitor, sla]) => (monitor.stuckInstances?.length ?? 0) + (sla.overdueSteps?.length ?? 0)),
      );
    }

    for (const [key, call] of Object.entries(calls) as [NavBadgeKey, Observable<number>][]) {
      call.pipe(catchError(() => of(0))).subscribe((count) => this._counts.update((c) => ({ ...c, [key]: count })));
    }
  }
}
