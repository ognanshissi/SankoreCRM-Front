import { Injectable, computed, signal } from '@angular/core';
import {
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * La session du client pendant son parcours de dépôt à distance (KRM-F-02/F-03).
 *
 * **Gardée en mémoire uniquement, et c'est une exigence et non une facilité.** Ni
 * `localStorage` ni `sessionStorage` : le jeton autorise le dépôt de pièces dans un
 * dossier KYC, il est émis pour vingt minutes, et le téléphone sur lequel il vit est
 * souvent partagé. Un rafraîchissement de page le perd — c'est voulu : le client
 * revient sur l'écran d'identification et **retrouve les photos déjà envoyées**, parce
 * que ce qui est persisté est côté serveur, pas dans le navigateur.
 *
 * Conséquence assumée : fermer l'onglet oblige à ressaisir numéro client et date de
 * naissance. C'est exactement le comportement qu'on veut d'un lien à usage unique dont
 * on ne sait pas qui regarde l'écran ensuite.
 */
@Injectable({ providedIn: 'root' })
export class KycRemoteSessionStore {
  private readonly _token = signal<string | null>(null);

  /**
   * Fin de validité annoncée par le serveur, pour avertir avant l'expiration plutôt que
   * de laisser un 409 surgir au milieu d'un envoi.
   */
  private readonly _expiresAt = signal<number | null>(null);

  public readonly hasSession = computed(() => this._token() !== null);

  /** Lu par l'intercepteur, pas par les écrans. */
  public token(): string | null {
    return this._token();
  }

  public secondsRemaining = computed(() => {
    const expiry = this._expiresAt();
    if (expiry === null) return null;
    return Math.max(0, Math.round((expiry - Date.now()) / 1000));
  });

  public open(token: string, expiresInSeconds: number): void {
    this._token.set(token);
    this._expiresAt.set(Date.now() + expiresInSeconds * 1000);
  }

  /**
   * Oublie la session. Appelé à la soumission, sur expiration, et quand le serveur
   * répond que le lien n'est plus utilisable — le jeton reste valide
   * cryptographiquement, c'est le lien derrière qui ne l'est plus, et le garder en
   * mémoire ne ferait que produire des 409 jusqu'à ce que le client recharge.
   */
  public close(): void {
    this._token.set(null);
    this._expiresAt.set(null);
  }
}

/**
 * Porte le jeton de session sur les seuls appels du parcours client.
 *
 * Un intercepteur et non un en-tête passé par appel, parce que le client HTTP est
 * **généré** : `KycPublicApiService` n'expose aucun moyen d'ajouter un en-tête, et le
 * modifier à la main serait écrasé à la prochaine génération.
 *
 * Il ne couvre volontairement **que** `/public/kyc/session` : le statut du lien et
 * l'identification sont anonymes, et y joindre un jeton n'aurait aucun sens — pire, cela
 * enverrait une session encore valide sur l'endpoint qui en délivre une nouvelle.
 */
export const kycRemoteSessionInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  if (!req.url.includes('public/kyc/session')) return next(req);

  const token = inject(KycRemoteSessionStore).token();
  if (!token) return next(req);

  return next(req.clone({ setHeaders: { authorization: `Bearer ${token}` } }));
};
