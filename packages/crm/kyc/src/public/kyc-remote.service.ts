import { inject, Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, map, Observable, of, tap, throwError } from 'rxjs';
import {
  KycIdentifyResponse,
  KycLinkStatusResponse,
  KYCPublicApiService,
  KycSessionResponse,
  KycUploadResponse,
} from '@sankore/crm-api';
import { KycRemoteSessionStore } from './kyc-remote-session.store';

/** Les états qu'un lien peut avoir, tels que le serveur les nomme. */
export type KycLinkState =
  | 'Usable'
  | 'Expired'
  | 'Consumed'
  | 'Revoked'
  | 'Locked'
  | 'FileClosed'
  | 'Unknown'
  | 'WrongTenant'
  /** Le serveur n'a pas répondu. Distinct d'un lien invalide : réessayer a du sens. */
  | 'Unreachable';

/** Ce que l'écran d'identification apprend d'une tentative. */
export type KycIdentifyOutcome = 'Identified' | 'Failed' | 'Locked' | 'Unreachable';

/**
 * Le seul point d'entrée du parcours client vers le serveur (KRM-F-02 à F-05).
 *
 * **Séparé de `KycFacadeService` exprès.** Celui-là parle aux endpoints du back-office,
 * sous le jeton d'un employé ; celui-ci parle à la surface publique, sous une session de
 * vingt minutes émise à un client anonyme. Les mélanger dans un service unique ferait
 * qu'une erreur d'import suffirait à appeler un endpoint authentifié depuis la page
 * publique, ou l'inverse.
 *
 * **Aucun écran n'appelle `KycPublicApiService` en direct**, même règle que côté
 * back-office : le jour où un code d'erreur change, il se cherche dans un fichier.
 */
@Injectable({ providedIn: 'root' })
export class KycRemoteService {
  private readonly _api = inject(KYCPublicApiService);
  private readonly _session = inject(KycRemoteSessionStore);

  /**
   * `POST /public/kyc/link/status` — l'état du lien, et rien sur le client.
   *
   * Un POST pour une lecture : le jeton passerait sinon en query string, donc dans les
   * journaux nginx et dans les en-têtes `Referer`. C'est tout l'intérêt de l'avoir mis
   * dans le fragment de l'URL.
   */
  public linkStatus(token: string): Observable<KycLinkState> {
    return this._api.getKycRemoteLinkStatus({ token }).pipe(
      map((response: KycLinkStatusResponse) =>
        (response.status ?? 'Unknown') as KycLinkState,
      ),
      catchError((error: HttpErrorResponse) =>
        of<KycLinkState>(error.status === 403 ? 'WrongTenant' : 'Unreachable'),
      ),
    );
  }

  /**
   * `POST /public/kyc/link/identify` — numéro client et date de naissance contre une session.
   *
   * Le serveur répond le même 401 pour un numéro inconnu, une date fausse et les deux :
   * on ne peut donc pas dire lequel était en cause, et ce service n'essaie pas de le
   * deviner. C'est la propriété qui empêche la page de devenir un oracle à numéros
   * clients.
   */
  public identify(
    token: string,
    clientNumber: string,
    birthDate: string,
  ): Observable<KycIdentifyOutcome> {
    return this._api
      .identifyKycRemoteCustomer({ token, clientNumber, birthDate })
      .pipe(
        tap((response: KycIdentifyResponse) => {
          if (response.sessionToken) {
            this._session.open(
              response.sessionToken,
              response.expiresInSeconds ?? 20 * 60,
            );
          }
        }),
        map((): KycIdentifyOutcome => 'Identified'),
        catchError((error: HttpErrorResponse) => {
          if (error.status === 423) return of<KycIdentifyOutcome>('Locked');
          if (error.status === 401 || error.status === 403) {
            return of<KycIdentifyOutcome>('Failed');
          }
          return of<KycIdentifyOutcome>('Unreachable');
        }),
      );
  }

  /** `GET /public/kyc/session` — ce qu'il reste à faire, tel que le produit le définit. */
  public session(): Observable<KycSessionResponse> {
    return this._api.getKycRemoteSession() as Observable<KycSessionResponse>;
  }

  /** `POST /public/kyc/session/consent`. */
  public consent(textVersion: string): Observable<void> {
    return this._api.giveKycRemoteConsent({ textVersion }).pipe(map(() => undefined));
  }

  /**
   * `POST /public/kyc/session/documents` — une photo, et un verdict qualité immédiat.
   *
   * Le 422 n'est **pas** une erreur à remonter comme telle : c'est la réponse normale
   * d'une photo floue, et son corps porte les causes à afficher. Le convertir en un
   * `throwError` obligerait chaque appelant à savoir qu'un échec HTTP est parfois un
   * résultat métier.
   */
  public upload(
    kind: string,
    file: File,
    documentType?: string,
  ): Observable<KycUploadResponse> {
    return this._api
      .uploadKycRemoteDocument(
        kind as never,
        file,
        documentType as never,
      )
      .pipe(
        map((response) => response as KycUploadResponse),
        catchError((error: HttpErrorResponse) => {
          if (error.status === 422 && error.error) {
            return of(error.error as KycUploadResponse);
          }
          return throwError(() => error);
        }),
      );
  }

  /** `DELETE /public/kyc/session/documents/{kind}` — pour reprendre une photo. */
  public removeDocument(kind: string): Observable<void> {
    return this._api.deleteKycRemoteDocument(kind as never).pipe(map(() => undefined));
  }

  /**
   * `POST /public/kyc/session/submit` — envoie le dossier.
   *
   * La session est oubliée dès le succès : le lien est consommé côté serveur, et garder
   * le jeton en mémoire ne produirait que des 409 si le client touchait un bouton.
   */
  public submit(): Observable<{ submitted: boolean; missing: string[] }> {
    return this._api.submitKycRemoteSession().pipe(
      tap(() => this._session.close()),
      map(() => ({ submitted: true, missing: [] as string[] })),
      catchError((error: HttpErrorResponse) => {
        if (error.status === 400 && Array.isArray(error.error?.missingDocuments)) {
          return of({
            submitted: false,
            missing: error.error.missingDocuments as string[],
          });
        }
        return throwError(() => error);
      }),
    );
  }
}
