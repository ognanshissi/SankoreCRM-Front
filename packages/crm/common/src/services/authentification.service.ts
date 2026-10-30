import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import {
  catchError,
  finalize, forkJoin,
  map,
  Observable, of,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs';
import {
  AuthApiService,
  CurrentUserDto,
  ImpersonationStartedDto,
  LoginRequest,
  LoginResult,
  UserDto,
  UserPermissionsDto,
  UsersApiService,
} from '@sankore/crm-api';

export const TOKEN_STORAGE_KEY = 'SANKORE_ACCESS_TOKEN';
const IMPERSONATION_STORAGE_KEY = 'SANKORE_IMPERSONATION';
const SESSION_KEYS = [TOKEN_STORAGE_KEY, 'expiresIn', 'refreshToken', 'refreshTokenExpiresAt'] as const;

/**
 * Usurpation en cours. Le compte de l'administrateur est mis de côté tel quel (jeton d'accès et
 * de rafraîchissement) et restauré à la sortie : il n'a pas à se reconnecter.
 */
export interface ImpersonationState {
  targetUserId: string;
  targetName: string;
  expiresAt: string;
  /** Écran où revenir à la sortie — la fiche de l'utilisateur usurpé. */
  returnUrl: string;
  original: Record<string, string | null>;
}

@Injectable({
  providedIn: 'root',
})
export class AuthenticationService {
  private readonly _platformId = inject(PLATFORM_ID);
  private storage: Storage | null = null;

  private readonly _authService = inject(AuthApiService);
  private readonly _usersApiService = inject(UsersApiService);

  private readonly _router = inject(Router);
  // User signals
  private readonly _connectedUser = signal<CurrentUserDto | null>(null);
  public connectedUser = this._connectedUser.asReadonly();

  private readonly _userPermissions = signal<UserPermissionsDto | null>(null);
  public readonly userPermissions = this._userPermissions.asReadonly();

  // Access token
  private readonly _accessToken = signal<string | null>(null);
  public accessToken = this._accessToken.asReadonly();

  // loading states
  private readonly _loadingUserInfo = signal<boolean>(false);
  public loadingUserInfo = this._loadingUserInfo.asReadonly();

  // Errors
  private readonly _errorMessage = signal<string | null>(null);
  public errorMessage = this._errorMessage.asReadonly();

  private tokenExpiresIn = signal<number>(0);

  private readonly _impersonation = signal<ImpersonationState | null>(null);
  /** Non nul pendant une usurpation d'identité. */
  public readonly impersonation = this._impersonation.asReadonly();

  /** La session travaille sur la copie d'essai de l'institution (« Mode test »). */
  public readonly testMode = computed(() => this._connectedUser()?.testMode === true);

  public constructor() {
    if (isPlatformBrowser(this._platformId)) {
      this.storage = window.localStorage;
      try {
        const raw = localStorage.getItem(IMPERSONATION_STORAGE_KEY);
        if (raw) this._impersonation.set(JSON.parse(raw) as ImpersonationState);
      } catch {
        localStorage.removeItem(IMPERSONATION_STORAGE_KEY);
      }
    }
  }

  /**
   * Bascule sur le jeton d'usurpation et recharge l'application : permissions, menus et données
   * en cache doivent être ceux de l'utilisateur usurpé, et un rechargement est la seule façon de
   * n'en oublier aucun. Pas de jeton de rafraîchissement : à l'expiration, on revient à soi.
   */
  public startImpersonation(started: ImpersonationStartedDto, returnUrl: string): void {
    if (this._impersonation()) return;
    const original: Record<string, string | null> = {};
    for (const key of SESSION_KEYS) original[key] = localStorage.getItem(key);

    const state: ImpersonationState = {
      targetUserId: started.userId ?? '',
      targetName: started.userFullName ?? '',
      expiresAt: started.expiresAt ?? '',
      returnUrl,
      original,
    };
    localStorage.setItem(IMPERSONATION_STORAGE_KEY, JSON.stringify(state));
    this.setAccessToken(started.accessToken, started.expiresAt, '', null);
    window.location.assign('/');
  }

  /** Ferme la session d'usurpation côté serveur, puis restaure le compte de l'administrateur. */
  public endImpersonation(): void {
    const state = this._impersonation();
    if (!state) return;
    // Que le serveur réponde ou non, on revient à soi : un jeton d'usurpation expiré ne doit pas
    // retenir l'administrateur dans l'identité d'un autre.
    this._usersApiService.endImpersonation().pipe(catchError(() => of(null))).subscribe(() => this._restoreOriginal(state));
  }

  private _restoreOriginal(state: ImpersonationState): void {
    for (const key of SESSION_KEYS) {
      const value = state.original[key];
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    localStorage.removeItem(IMPERSONATION_STORAGE_KEY);
    window.location.assign(state.returnUrl || '/');
  }

  public login(loginRequest: LoginRequest): Observable<LoginResult> {
    this._errorMessage.set(null);
    this._connectedUser.set(null);
    return this._authService.login(loginRequest).pipe(
      switchMap((response) => {
        this.setAccessToken(
          response.accessToken,
          response.expiresAt,
          response.refreshToken ?? '',
          response.refreshTokenExpiresAt,
        );
        return this.getCurrentUserInfo().pipe(
          map(() => {
            return response;
          }),
        );
      }),
      catchError((error) => {
        this._errorMessage.set('Email/Mot de passe incorrect !');
        throw error;
      }),
    );
  }

  public getCurrentUserInfo(): Observable<any> {
    this._loadingUserInfo.set(true);
    this._connectedUser.set(null);
    return this._usersApiService.getCurrentUser().pipe(
      shareReplay(1),
      map((currentUser) => {
        this._connectedUser.set(currentUser);
      }),
      finalize(() => this._loadingUserInfo.set(false)),
    );
  }

  public loadAccessToken(): string | null {
    if (!this._accessToken()) {
      const token = localStorage.getItem(TOKEN_STORAGE_KEY) ?? null;

      if (!token) return null;
      this._accessToken.set(token);

      this.getCurrentUserInfo().subscribe()
    }
    return this.accessToken();
  }

  // public refreshToken(
  //   refreshRequest: RefreshTokenCommand,
  // ): Observable<AccessTokenResponse> {
  //   return this._authService
  //     .authControllerRefreshTokenV1(refreshRequest)
  //     .pipe(tap((accessToken) => this.setAccessToken(accessToken)));
  // }

  public verifyToken(): Observable<boolean> {
    return of(true);
  }

  /** Attempts to refresh the access token using the stored refresh token. */
  public refreshAccessToken(): Observable<LoginResult | null> {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return of(null);

    return this._authService.refreshToken({ token: refreshToken }).pipe(
      tap((result: LoginResult) => {
        if (result.accessToken) {
          this.setAccessToken(
            result.accessToken,
            result.expiresAt,
            result.refreshToken ?? refreshToken,
            result.refreshTokenExpiresAt,
          );
        }
      }),
      catchError(() => of(null)),
    );
  }

  /**
   * Entre en « Mode test » ou en sort : même compte, même session, une nouvelle paire de jetons
   * qui désigne la copie d'essai — ou la production. L'appelant recharge l'application : tout ce
   * qui est en mémoire appartient à l'autre mode.
   */
  public switchTestMode(test: boolean): Observable<LoginResult> {
    const refreshToken = localStorage.getItem('refreshToken') ?? '';
    return this._authService.switchTestMode({ test, refreshToken }).pipe(
      tap((result) => this.setAccessToken(result.accessToken, result.expiresAt, result.refreshToken, result.refreshTokenExpiresAt)),
    );
  }

  public isTokenExpired(): boolean {
    const expiresIn = localStorage.getItem('expiresIn');
    if (!expiresIn) return true;
    try {
      const expiresAt = new Date(JSON.parse(expiresIn)).getTime();
      return Date.now() >= expiresAt;
    } catch { return true; }
  }

  public logout(): void {
    // Pendant une usurpation, « se déconnecter » — ou un jeton d'usurpation expiré, que
    // l'intercepteur traite comme une déconnexion — ramène au compte de l'administrateur.
    const impersonation = this._impersonation();
    if (impersonation) {
      this._restoreOriginal(impersonation);
      return;
    }
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    this._connectedUser.set(null);
    this._accessToken.set(null);
    this._router.navigate(['/auth', 'login']);
  }

  private setAccessToken(
    accessToken: any,
    expiresIn: any,
    refreshToken: any,
    refreshTokenExpiresAt?: string | null,
  ): void {
    const expiresTime = +new Date(expiresIn);
    const time = +new Date()
    this.tokenExpiresIn.set(Math.ceil((expiresTime - time) / 100));
    this._accessToken.set(accessToken);
    localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
    localStorage.setItem('expiresIn', JSON.stringify(expiresIn));
    localStorage.setItem('refreshToken', refreshToken);
    localStorage.setItem(
      'refreshTokenExpiresAt',
      JSON.stringify(refreshTokenExpiresAt),
    );
  }
}
