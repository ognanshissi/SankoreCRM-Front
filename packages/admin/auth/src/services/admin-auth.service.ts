import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpContext } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, EMPTY, finalize, map, Observable, of, shareReplay, switchMap, tap, throwError } from 'rxjs';
import { AdminAuthTokens, AuthApiService, CurrentAdminResponse } from '@sankore/crm-admin-api';
import { ADMIN_EXPLICIT_TOKEN } from '../interceptors/admin-explicit-token';

/**
 * Clés propres à l'admin, distinctes de celles du CRM (`SANKORE_ACCESS_TOKEN`…) : les deux
 * fronts peuvent partager une origine en local, et une session tenant ne doit jamais être lue
 * comme une session d'opérateur, ni l'inverse.
 */
const STORAGE_KEYS = {
  accessToken: 'SANKORE_ADMIN_ACCESS_TOKEN',
  expiresAt: 'SANKORE_ADMIN_ACCESS_TOKEN_EXPIRES_AT',
  refreshToken: 'SANKORE_ADMIN_REFRESH_TOKEN',
  refreshExpiresAt: 'SANKORE_ADMIN_REFRESH_TOKEN_EXPIRES_AT',
} as const;

/** Marge avant expiration : un jeton qui expire pendant le trajet de la requête vaut un 401. */
const EXPIRY_MARGIN_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class AdminAuthService {
  private readonly _authApi = inject(AuthApiService);
  private readonly _router = inject(Router);

  /**
   * Faux pendant le rendu serveur (SSR / prérendu) : il n'y a pas de `localStorage` côté Node,
   * et une session n'a de toute façon de sens que dans le navigateur de l'opérateur.
   */
  private readonly _isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private _refreshInFlight$: Observable<AdminAuthTokens> | null = null;
  private _sessionInFlight$: Observable<boolean> | null = null;

  public readonly currentAdmin = signal<CurrentAdminResponse | null>(null);
  public readonly accessToken = signal<string | null>(this._read(STORAGE_KEYS.accessToken));
  public readonly isAuthenticated = computed(() => this.currentAdmin() !== null);

  public login(email: string, password: string): Observable<CurrentAdminResponse> {
    return this._authApi.login({ email, password }).pipe(
      tap((tokens) => this._store(tokens)),
      // Le profil est chargé tout de suite : un login réussi qui laisserait `currentAdmin` vide
      // ferait rejeter la première navigation par le garde.
      switchMap(() => this._fetchCurrentAdmin()),
    );
  }

  /**
   * Répond « y a-t-il une session utilisable ? » et charge le profil au passage. Appelé par le
   * garde à chaque navigation protégée, d'où le partage de l'appel en cours : dix routes
   * résolues d'un coup ne doivent pas faire dix `GET /auth/me`.
   */
  public ensureSession(): Observable<boolean> {
    if (!this._isBrowser) return of(false);
    if (this.currentAdmin()) return of(true);
    if (!this.accessToken() && !this.refreshTokenValue()) return of(false);

    this._sessionInFlight$ ??= this._fetchCurrentAdmin().pipe(
      map(() => true),
      catchError(() => {
        this.clearSession();
        return of(false);
      }),
      finalize(() => (this._sessionInFlight$ = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this._sessionInFlight$;
  }

  /**
   * Un seul rafraîchissement à la fois. Le serveur fait tourner le jeton à chaque usage et
   * traite la RÉUTILISATION d'un jeton déjà tourné comme un vol : il ferme alors toutes les
   * sessions du compte. Deux requêtes en 401 qui rafraîchiraient chacune de leur côté
   * déconnecteraient donc l'opérateur — c'est ce partage qui l'empêche.
   */
  public refresh(): Observable<AdminAuthTokens> {
    const refreshToken = this.refreshTokenValue();
    if (!refreshToken) return throwError(() => new Error('No refresh token'));

    this._refreshInFlight$ ??= this._authApi.refreshToken({ refreshToken }).pipe(
      tap((tokens) => this._store(tokens)),
      finalize(() => (this._refreshInFlight$ = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this._refreshInFlight$;
  }

  /** Ferme la session côté serveur (au mieux), puis localement, puis renvoie vers la connexion. */
  public logout(): void {
    const refreshToken = this.refreshTokenValue();
    const accessToken = this.accessToken();
    const accessUsable = !this.isAccessTokenExpired();
    this.clearSession();

    if (accessToken && refreshToken && accessUsable) {
      // Après le nettoyage local : une API injoignable ne doit pas laisser l'opérateur connecté.
      // Le jeton part donc par le contexte, la session locale étant déjà vide.
      this._authApi
        .logout({ refreshToken }, 'body', false, {
          context: new HttpContext().set(ADMIN_EXPLICIT_TOKEN, accessToken),
        })
        .pipe(catchError(() => EMPTY))
        .subscribe();
    }
    this._router.navigate(['/auth/login']).then();
  }

  public clearSession(): void {
    Object.values(STORAGE_KEYS).forEach((key) => this._remove(key));
    this.accessToken.set(null);
    this.currentAdmin.set(null);
  }

  public refreshTokenValue(): string | null {
    const token = this._read(STORAGE_KEYS.refreshToken);
    const expiresAt = Date.parse(this._read(STORAGE_KEYS.refreshExpiresAt) ?? '');
    return token && (Number.isNaN(expiresAt) || expiresAt > Date.now()) ? token : null;
  }

  public isAccessTokenExpired(): boolean {
    const expiresAt = Date.parse(this._read(STORAGE_KEYS.expiresAt) ?? '');
    return Number.isNaN(expiresAt) || expiresAt - EXPIRY_MARGIN_MS <= Date.now();
  }

  private _fetchCurrentAdmin(): Observable<CurrentAdminResponse> {
    return this._authApi.getCurrentAdmin().pipe(tap((admin) => this.currentAdmin.set(admin)));
  }

  private _store(tokens: AdminAuthTokens): void {
    this._write(STORAGE_KEYS.accessToken, tokens.accessToken);
    this._write(STORAGE_KEYS.expiresAt, tokens.expiresAt);
    this._write(STORAGE_KEYS.refreshToken, tokens.refreshToken);
    this._write(STORAGE_KEYS.refreshExpiresAt, tokens.refreshTokenExpiresAt);
    this.accessToken.set(tokens.accessToken ?? null);
  }

  private _read(key: string): string | null {
    return this._isBrowser ? localStorage.getItem(key) : null;
  }

  private _write(key: string, value: string | null | undefined): void {
    if (!this._isBrowser) return;
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  }

  private _remove(key: string): void {
    if (this._isBrowser) localStorage.removeItem(key);
  }
}
