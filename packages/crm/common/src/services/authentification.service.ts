import { inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
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
  LoginRequest,
  LoginResult,
  UserDto,
  UserPermissionsDto,
  UsersApiService,
} from '@sankore/crm-api';

export const TOKEN_STORAGE_KEY = 'SANKORE_ACCESS_TOKEN';

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
  private readonly _connectedUser = signal<UserDto | null>(null);
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

  public constructor() {
    if (isPlatformBrowser(this._platformId)) {
      this.storage = window.localStorage;
    }
  }

  public login(loginRequest: LoginRequest): Observable<LoginResult> {
    this._errorMessage.set(null);
    this._connectedUser.set(null);
    return this._authService.login(loginRequest).pipe(
      switchMap((response) => {
        this.setAccessToken(response.accessToken);
        return this.getCurrentUserInfo(response.userId ?? '').pipe(
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

  public getCurrentUserInfo(userId: string): Observable<any> {
    this._loadingUserInfo.set(true);
    this._connectedUser.set(null);
    return forkJoin([
      this._usersApiService.getUser(userId),
      this._usersApiService.getUserPermissions(userId),
    ]).pipe(
      shareReplay(1),
      tap(([userDto, userPermissionDto]) => {
        this._connectedUser.set(userDto);
        this._userPermissions.set(userPermissionDto);
      }),
      finalize(() => this._loadingUserInfo.set(false)),
    );
  }

  public loadAccessToken(): string | null {
    // when the token is used, I should load user information
    if (!this._accessToken()) {
      const storage = JSON.parse(
        this.storage?.getItem(TOKEN_STORAGE_KEY) || '',
      ) as string | null;
      if (storage === null) return null;
      this._accessToken.set(storage ?? '');
    }
    // if (!this._connectedUser() && !this._loadingUserInfo()) {
    //   this.getCurrentUserInfo().subscribe();
    // }
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

  public logout(): void {
    this.storage?.removeItem(TOKEN_STORAGE_KEY);
    this._connectedUser.set(null);
    this._accessToken.set(null);
    this._router.navigate(['/auth', 'login']);
  }

  private setAccessToken(accessToken: any): void {
    this.tokenExpiresIn.set(Math.ceil(accessToken.expiresIn / 100));
    this._accessToken.set(accessToken.accessToken);
    console.log(this.accessToken());
    this.storage?.setItem(TOKEN_STORAGE_KEY, JSON.stringify(accessToken));
  }
}
