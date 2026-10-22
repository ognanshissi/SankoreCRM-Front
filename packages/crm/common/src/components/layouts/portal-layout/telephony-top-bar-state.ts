import { Injectable, signal } from '@angular/core';

/** Ce que la barre supérieure affiche de la téléphonie. Rien de plus. */
export interface TelephonyTopBarPill {
  readonly label: string;
  /** L'action attendue, en infobulle. Jamais un diagnostic sans suite. */
  readonly hint: string;
  readonly tone: 'success' | 'warning' | 'error' | 'neutral';
  /** Nom d'icône du kit (`feather:…`). */
  readonly icon: string;
}

/**
 * État de la téléphonie de l'utilisateur dans la barre supérieure (TEL-F-11) : depuis la nouvelle
 * navigation, il se lit sur le profil (pastille de l'avatar, « téléphone non lié » sous le rôle)
 * et dans la carte en tête de son menu — voir `PortalUserMenu`.
 *
 * **Ce service existe pour que `common` ne dépende PAS de `telephony`.** La première
 * version importait le composant de la pastille depuis `@sankore/crm/telephony` dans
 * `portal-layout`, ce qui fermait un cycle : `common/index` → `portal-layout` →
 * `telephony/index` → `telephony.routes` → `hasPermissionGuard` de `common`, encore en
 * cours d'initialisation, donc `undefined`. Le symptôme n'était pas un avertissement de
 * lint mais un module qui ne s'évalue plus — un spec du module téléphonie ne pouvait même
 * plus être collecté. `common` est la bibliothèque de base que toutes les autres
 * importent : la flèche ne peut aller que dans l'autre sens.
 *
 * Le partage de responsabilités en découle, et il est volontaire :
 *
 * - `common` possède le CONTRAT (ce qu'est une pastille) et le RENDU. Il ne sait rien de
 *   la téléphonie et n'appelle aucun de ses endpoints.
 * - `telephony` possède la LOGIQUE : c'est lui qui lit `GET telephony/me`, qui tient la
 *   connexion temps réel, qui connaît ses libellés — et qui pose ici le résultat.
 *
 * `null` veut dire « rien à afficher », pas « état inconnu » : c'est le cas de tous les
 * établissements sans téléphonie active, et de toutes les sessions où le module n'est
 * jamais chargé.
 */
@Injectable({ providedIn: 'root' })
export class TelephonyTopBarState {
  private readonly _pill = signal<TelephonyTopBarPill | null>(null);
  public readonly pill = this._pill.asReadonly();

  /**
   * Ce que l'utilisateur peut faire lui-même pour réparer, ou `null` — « Lier mon compte » dans
   * le menu du profil. Même règle que la pastille : `common` affiche le bouton et l'appelle, le
   * module Téléphonie possède l'appel au serveur et ce qui s'ensuit.
   */
  private readonly _action = signal<TelephonyTopBarAction | null>(null);
  public readonly action = this._action.asReadonly();

  private readonly _actionBusy = signal(false);
  public readonly actionBusy = this._actionBusy.asReadonly();

  public set(pill: TelephonyTopBarPill | null): void {
    this._pill.set(pill);
  }

  public setAction(action: TelephonyTopBarAction | null): void {
    this._action.set(action);
  }

  public setActionBusy(busy: boolean): void {
    this._actionBusy.set(busy);
  }
}

export interface TelephonyTopBarAction {
  readonly label: string;
  readonly run: () => void;
}
