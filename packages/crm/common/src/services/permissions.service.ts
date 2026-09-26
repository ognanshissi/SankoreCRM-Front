import { computed, inject, Injectable, Signal } from '@angular/core';
import { AuthenticationService } from './authentification.service';
import { PermissionCode } from '../models/permissions';

/**
 * Lecture des permissions de l'utilisateur connecté.
 *
 * Évite que chaque écran réécrive
 * `computed(() => (auth.connectedUser()?.permissions ?? []).includes('…'))`,
 * formulation qui avait déjà divergé d'un écran à l'autre.
 */
@Injectable({ providedIn: 'root' })
export class PermissionsService {
  private readonly _auth = inject(AuthenticationService);

  /** Permissions accordées, en `Set` pour un test en temps constant. */
  public readonly granted = computed(
    () => new Set(this._auth.connectedUser()?.permissions ?? []),
  );

  /**
   * Signal vrai si l'utilisateur détient AU MOINS une des permissions.
   * À stocker dans un champ du composant, puis à lire dans le template.
   */
  public can(...permissions: PermissionCode[]): Signal<boolean> {
    return computed(() => {
      const granted = this.granted();
      return permissions.some((p) => granted.has(p));
    });
  }

  /** Signal vrai si l'utilisateur détient TOUTES les permissions. */
  public canAll(...permissions: PermissionCode[]): Signal<boolean> {
    return computed(() => {
      const granted = this.granted();
      return permissions.every((p) => granted.has(p));
    });
  }

  /** Test ponctuel, hors contexte réactif (dans un gestionnaire d'évènement). */
  public has(...permissions: PermissionCode[]): boolean {
    const granted = this.granted();
    return permissions.some((p) => granted.has(p));
  }
}
