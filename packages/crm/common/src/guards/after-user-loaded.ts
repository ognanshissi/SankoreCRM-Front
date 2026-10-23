import { inject, Injector } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, map, Observable, take } from 'rxjs';
import { AuthenticationService } from '../services/authentification.service';

/**
 * Évalue `decide` une fois le profil de l'utilisateur chargé.
 *
 * La garde parente `authorized` lance `getCurrentUserInfo()` sans l'attendre : à l'ouverture
 * directe d'une URL (rechargement, favori, lien d'un e-mail de notification), les gardes de
 * permission passaient AVANT la réponse, lisaient un profil vide et refusaient l'accès à un
 * utilisateur qui avait la permission. Pendant le chargement, on attend donc sa fin ; un échec
 * du chargement laisse un profil vide, et le refus redevient la bonne réponse.
 */
export function afterUserLoaded<T>(decide: () => T): T | Observable<T> {
  const auth = inject(AuthenticationService);
  if (!auth.loadingUserInfo()) return decide();

  const injector = inject(Injector);
  return toObservable(auth.loadingUserInfo, { injector }).pipe(
    filter((loading) => !loading),
    take(1),
    map(() => decide()),
  );
}
