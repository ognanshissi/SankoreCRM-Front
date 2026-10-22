import { ComponentType } from '@angular/cdk/overlay';
import { Injectable, InjectionToken, Provider } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { PermissionCode } from '../../../models/permissions';

export type QuickCreateKind = 'lead' | 'task' | 'appointment';

/** Une entrée du menu « Créer » de la barre du haut. */
export interface QuickCreateAction {
  readonly kind: QuickCreateKind;
  readonly label: string;
  /** Nom d'icône du kit (`feather:…`). */
  readonly icon: string;
  /** L'un de ces droits suffit ; sans liste, tout utilisateur connecté voit l'entrée. */
  readonly anyOf?: PermissionCode[];
  /** Le tiroir de création, chargé au clic. Il se ferme avec l'identifiant créé, ou sans rien. */
  readonly load: () => Promise<ComponentType<unknown>>;
}

/**
 * Les créations rapides, déclarées par l'application et non ici : les tiroirs vivent dans
 * `lead-management` et `tasks`, qui importent `common` — l'inverse fermerait le même cycle
 * d'initialisation que celui décrit dans `TelephonyTopBarState`. Le chargement par `import()`
 * garde en plus ces tiroirs hors du bundle initial.
 */
export const QUICK_CREATE_ACTIONS = new InjectionToken<readonly QuickCreateAction[]>('QUICK_CREATE_ACTIONS');

export function provideQuickCreateActions(actions: readonly QuickCreateAction[]): Provider {
  return { provide: QUICK_CREATE_ACTIONS, useValue: actions };
}

export interface QuickCreated {
  readonly kind: QuickCreateKind;
  readonly id: string;
}

/**
 * Ce qui vient d'être créé depuis la barre du haut. La page ouverte n'a pas ouvert le tiroir et
 * n'en voit donc pas la fermeture : elle s'abonne ici pour se recharger quand c'est son sujet.
 */
@Injectable({ providedIn: 'root' })
export class QuickCreateEvents {
  private readonly _created = new Subject<QuickCreated>();
  public readonly created$: Observable<QuickCreated> = this._created.asObservable();

  public notify(created: QuickCreated): void {
    this._created.next(created);
  }
}
