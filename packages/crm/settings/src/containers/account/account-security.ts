import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, EMPTY, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { LoginHistoryDto, SecurityOverviewDto, UserSessionDto, UsersApiService } from '@sankore/crm-api';
import { AuthenticationService } from '@sankore/crm/common';
import { ChangePasswordDrawer } from './change-password-drawer';
import { KycAccessDrawer } from './kyc-access-drawer';
import { ReportLoginDrawer, ReportLoginDrawerData } from './report-login-drawer';
import { describeDevice, describeLoginOutcome, deviceIcon } from './security-labels';

const ACTIVITY_STEP = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
/** En deçà, une session est « active maintenant » : son activité n'est notée qu'à quelques minutes près. */
const ACTIVE_NOW_MS = 5 * 60 * 1000;

interface SessionRow extends UserSessionDto {
  device: string;
  icon: string;
  activeNow: boolean;
}

interface ActivityRow extends LoginHistoryDto {
  key: string;
  device: string;
  outcomeLabel: string;
  failed: boolean;
}

/** Une table qui affiche tout ce qu'on lui passe : pas de pagination visible. */
const UNPAGED: TableConfig = {
  property: 'id',
  pagination: { serverSide: false, pageIndex: 0, pageSize: 100, pageSizeOptions: [100] },
};

@Component({
  selector: 'account-security',
  imports: [DatePipe, Button, TasIcon, TasTable, TimeagoPipe],
  templateUrl: './account-security.html',
})
export class AccountSecurity implements OnInit {
  private readonly _usersApi = inject(UsersApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public readonly tableConfig = UNPAGED;

  public overview = signal<SecurityOverviewDto | null>(null);
  public sessions = signal<SessionRow[]>([]);
  public sessionsLoading = signal(true);
  public activity = signal<ActivityRow[]>([]);
  public activityLoading = signal(true);
  public activityLimit = signal(ACTIVITY_STEP);
  /** Le serveur ne donne pas de total : une page pleine laisse supposer qu'il en reste. */
  public activityHasMore = signal(false);
  public endingSessionId = signal<string | null>(null);
  public endingOthers = signal(false);

  public readonly hasOtherSessions = computed(() => this.sessions().some((s) => !s.isCurrent));

  public readonly passwordExpiresInDays = computed(() => {
    const expires = this.overview()?.passwordExpiresAt;
    if (!expires) return null;
    return Math.ceil((new Date(expires).getTime() - Date.now()) / DAY_MS);
  });

  ngOnInit(): void {
    this._usersApi.getMySecurityOverview().pipe(catchError(() => of(null))).subscribe((o) => this.overview.set(o));
    this._loadSessions();
    this._loadActivity();
  }

  // ——— Mot de passe ———

  public openChangePassword(): void {
    const ref = this._drawer.open<boolean, unknown, ChangePasswordDrawer>(ChangePasswordDrawer, {
      width: '100%', height: '100%', panelClass: 'side-drawer-panel',
    });
    // Le serveur a fermé toutes les sessions, celle-ci comprise : rester sur l'écran ne
    // servirait qu'à voir la prochaine requête échouer.
    ref.closed.subscribe((changed) => {
      if (changed) this._auth.logout();
    });
  }

  // ——— Sessions ———

  public endSession(row: SessionRow): void {
    if (!row.id) return;
    this.endingSessionId.set(row.id);
    this._usersApi.endMySession(row.id).pipe(
      catchError((err: HttpErrorResponse) => {
        this._snackbar.error('Déconnexion impossible', err.error?.detail ?? 'La session n’a pas pu être fermée.');
        this.endingSessionId.set(null);
        return EMPTY;
      }),
    ).subscribe(() => {
      this.endingSessionId.set(null);
      this._snackbar.success('Session fermée', `${row.device} est déconnecté.`);
      this._loadSessions();
    });
  }

  public endOtherSessions(): void {
    this._confirm.confirm({
      title: 'Déconnecter les autres sessions ?',
      message: 'Tous vos autres appareils devront se reconnecter avec votre mot de passe. Cette session reste ouverte.',
      closable: true,
      acceptButtonProps: { label: 'Déconnecter', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.endingOthers.set(true);
        this._usersApi.endMyOtherSessions().pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Déconnexion impossible', err.error?.detail ?? 'Les sessions n’ont pas pu être fermées.');
            this.endingOthers.set(false);
            return EMPTY;
          }),
        ).subscribe((result) => {
          this.endingOthers.set(false);
          this._snackbar.success('Sessions fermées', `${result.endedSessions ?? 0} session(s) déconnectée(s).`);
          this._loadSessions();
        });
      },
    });
  }

  // ——— Activité ———

  public showMoreActivity(): void {
    this.activityLimit.update((n) => n + ACTIVITY_STEP * 2);
    this._loadActivity();
  }

  public reportLogin(loginId?: string): void {
    const data: ReportLoginDrawerData = { loginId };
    const ref = this._drawer.open<boolean, ReportLoginDrawerData, ReportLoginDrawer>(ReportLoginDrawer, {
      width: '100%', height: '100%', panelClass: 'side-drawer-panel', data,
    });
    ref.closed.subscribe((reported) => {
      if (!reported) return;
      this._loadSessions();
      this._loadActivity();
    });
  }

  // ——— Accès aux données ———

  public openKycAccess(): void {
    this._drawer.open(KycAccessDrawer, { width: '100%', height: '100%', panelClass: 'side-drawer-panel' });
  }

  // ——— Chargement ———

  private _loadSessions(): void {
    this.sessionsLoading.set(true);
    this._usersApi.listMySessions().pipe(catchError(() => of([]))).subscribe((sessions) => {
      const now = Date.now();
      this.sessions.set(sessions.map((s) => ({
        ...s,
        device: describeDevice(s),
        icon: deviceIcon(s),
        activeNow: !!s.isCurrent || (!!s.lastSeenAt && now - new Date(s.lastSeenAt).getTime() < ACTIVE_NOW_MS),
      })));
      this.sessionsLoading.set(false);
    });
  }

  private _loadActivity(): void {
    this.activityLoading.set(true);
    const limit = this.activityLimit();
    this._usersApi.getMyLoginHistory(1, limit).pipe(catchError(() => of([]))).subscribe((items) => {
      this.activity.set(items.map((item, i) => {
        const outcome = describeLoginOutcome(item.outcome);
        return {
          ...item,
          key: item.id ?? `${item.occuredAt}-${i}`,
          device: describeDevice(item),
          outcomeLabel: outcome.label,
          failed: outcome.failed,
        };
      }));
      this.activityHasMore.set(items.length >= limit && limit < 100);
      this.activityLoading.set(false);
    });
  }
}

export default AccountSecurity;
