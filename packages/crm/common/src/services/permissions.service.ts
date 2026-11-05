import { computed, inject, Injectable, Signal } from '@angular/core';
import { AuthenticationService } from './authentification.service';
import { PermissionCode, TEAM_WRITE_PERMISSIONS } from '../models/permissions';

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

  /**
   * Permissions accordées, en `Set` pour un test en temps constant. En mode test, celles qui
   * modifient l'équipe ou l'institution sont retirées : elles appartiennent à la production
   * (voir `TEAM_WRITE_PERMISSIONS`).
   */
  public readonly granted = computed(() => {
    const granted = new Set(this._auth.connectedUser()?.permissions ?? []);
    if (this._auth.testMode()) TEAM_WRITE_PERMISSIONS.forEach((p) => granted.delete(p));
    return granted;
  });

  /**
   * L'entrée « Paramétrage » du menu et son accueil. Un droit à part (propriétaire, 2026-11-05), et non
   * les droits de lecture : la lecture KYC, la téléphonie ou les imports ouvriraient des rubriques à
   * qui travaille seulement ses dossiers. La liste des rôles exclus laissait entrer tout rôle créé
   * par une institution.
   */
  public readonly seesSettings = computed(() => this.granted().has('settings:access'));

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
