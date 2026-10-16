import { inject, Injectable, signal } from '@angular/core';
import { TelephonyApiService } from '@sankore/crm-api';
import { catchError, EMPTY, tap } from 'rxjs';
import { brokenLinkCount } from './user-link-presentation';

/**
 * Le nombre de rattachements CASSÉS, exposé pour le badge du menu.
 *
 * Pourquoi un service et pas un signal de l'écran : le badge s'affiche dans la barre de
 * navigation, c'est-à-dire exactement là où l'écran n'est pas chargé — il est en
 * `loadComponent`. La coquille appelle donc `refresh()` au démarrage (sous réserve de
 * `Telephony.Settings.Manage`, la permission de l'endpoint) et lit `brokenCount` ;
 * l'écran, lui, rappelle `refresh()` après chaque écriture pour que le badge ne reste pas
 * sur un chiffre périmé juste après la réparation.
 *
 * `brokenCount` vaut `null` tant que rien n'a répondu, et c'est volontairement distinct de
 * zéro : un badge « 0 » affirme qu'il n'y a rien à réparer, ce qu'une lecture en échec ne
 * permet pas de dire. Un échec est donc silencieux — pas de snackbar : un badge n'a pas à
 * interrompre quelqu'un qui faisait autre chose.
 */
@Injectable({ providedIn: 'root' })
export class TelephonyUserLinksBadgeService {
  private readonly _api = inject(TelephonyApiService);

  private readonly _brokenCount = signal<number | null>(null);
  public readonly brokenCount = this._brokenCount.asReadonly();

  /**
   * Relit la liste et recompte. `includeDisabled` reste à faux : un poste détaché avec un
   * motif est de l'histoire, pas une anomalie à réparer, et le compter ferait clignoter le
   * badge pour un départ d'agent réglé depuis six mois.
   */
  public refresh(): void {
    this._api
      .listTelephonyUserLinks(false)
      .pipe(
        tap((links) => this._brokenCount.set(brokenLinkCount(links ?? []))),
        catchError(() => EMPTY),
      )
      .subscribe();
  }

  /** Mise à jour depuis une liste déjà chargée par l'écran : évite un second appel. */
  public setFromLinks(links: Parameters<typeof brokenLinkCount>[0]): void {
    this._brokenCount.set(brokenLinkCount(links));
  }
}
