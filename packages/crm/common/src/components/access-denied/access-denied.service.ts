import { Injectable, signal } from '@angular/core';
import { PermissionCode } from '../../models/permissions';
import { TenantModule } from '../../models/tenant-modules';

export interface AccessDenial {
  /** URL que l'utilisateur a tenté d'ouvrir. */
  attemptedUrl: string;
  /** Permission(s) qui auraient permis l'accès. */
  required: PermissionCode[];
  /** Renseigné quand c'est un module payant inactif, et non une permission, qui ferme la page. */
  modules?: TenantModule[];
}

/** Effacement automatique, pour que la bannière ne reste pas indéfiniment. */
const AUTO_DISMISS_MS = 10_000;

/**
 * Refus d'accès à signaler à l'utilisateur.
 *
 * Même forme que `Loading` / `PageLoadingService` : un état en signal, alimenté
 * par les gardes de route, lu par `<access-denied-banner>` monté globalement.
 */
@Injectable({ providedIn: 'root' })
export class AccessDeniedService {
  private readonly _notice = signal<AccessDenial | null>(null);
  public readonly notice = this._notice.asReadonly();

  /**
   * Un refus de garde déclenche une redirection, donc une navigation
   * supplémentaire. Sans ce drapeau, cette navigation-là effacerait la
   * bannière avant même qu'elle soit visible.
   */
  private _skipNextSettle = false;
  private _timer: ReturnType<typeof setTimeout> | null = null;

  /** Appelé par les gardes de permission au moment du refus. */
  public notify(attemptedUrl: string, required: PermissionCode[]): void {
    this._notice.set({ attemptedUrl, required });
    this._skipNextSettle = true;
    this._restartTimer();
  }

  /** Appelé par la garde de module : la page appartient à un module que l'institution n'a pas. */
  public notifyModule(attemptedUrl: string, modules: TenantModule[]): void {
    this._notice.set({ attemptedUrl, required: [], modules });
    this._skipNextSettle = true;
    this._restartTimer();
  }

  /**
   * À appeler à chaque navigation terminée. La première est celle de la
   * redirection : on la laisse passer. La suivante — un vrai déplacement de
   * l'utilisateur — efface la bannière.
   */
  public onNavigationSettled(): void {
    if (!this._notice()) return;
    if (this._skipNextSettle) {
      this._skipNextSettle = false;
      return;
    }
    this.dismiss();
  }

  public dismiss(): void {
    this._notice.set(null);
    this._skipNextSettle = false;
    this._clearTimer();
  }

  private _restartTimer(): void {
    this._clearTimer();
    this._timer = setTimeout(() => this.dismiss(), AUTO_DISMISS_MS);
  }

  private _clearTimer(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}
