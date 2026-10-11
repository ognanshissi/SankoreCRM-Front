import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, of, shareReplay, tap } from 'rxjs';
import {
  ComplianceSettingsApiService,
  ComplianceSettingsResponse,
} from '@sankore/crm-api';

/**
 * Réglages de conformité du tenant, lus une fois pour toute la session.
 *
 * Ils existent pour une raison précise : `pepEnabled` est un drapeau **du tenant**, et c'est
 * lui qui décide si le bloc PPE est proposé sur les leads et les dossiers clients. Or FATCA,
 * lui, est porté par la réponse de chaque dossier (`LeadFatcaDto.enabled`) : il n'y a pas
 * d'équivalent pour la PPE au contrat, donc le seul endroit où lire le drapeau est
 * `GET /api/v1/compliance-settings`.
 *
 * Deux choix à connaître :
 *
 * 1. **Un seul appel, partagé.** `shareReplay` plutôt qu'un appel par écran : sans lui, chaque
 *    onglet qui affiche un bloc PPE referait la requête, et l'ouverture d'une fiche en
 *    déclencherait trois.
 * 2. **En cas d'échec ou de champ absent, la PPE reste active.** Un 403 (l'agent d'agence n'a pas
 *    forcément `kyc:read`), une panne réseau, ou un back qui n'expose pas encore `pepEnabled`
 *    ne doivent pas faire disparaître la saisie PPE : masquer une obligation de vigilance sur
 *    une erreur de lecture serait le pire des deux comportements possibles. L'absence du champ
 *    vaut donc « activé », et seul un `false` explicite désactive.
 */
@Injectable({ providedIn: 'root' })
export class ComplianceConfigService {
  private readonly _api = inject(ComplianceSettingsApiService);

  private readonly _settings = signal<ComplianceSettingsResponse | null>(null);
  private readonly _loaded = signal(false);

  private readonly _request$ = this._api.getComplianceSettings().pipe(
    tap((response) => {
      this._settings.set(response);
      this._loaded.set(true);
    }),
    catchError(() => {
      this._loaded.set(true);
      return of(null);
    }),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  public readonly settings = this._settings.asReadonly();
  public readonly isLoaded = this._loaded.asReadonly();

  /**
   * Vigilance PPE active pour le tenant. Vrai tant qu'on n'a pas lu un `false` explicite —
   * cf. le point 2 ci-dessus.
   */
  public readonly pepEnabled = computed(() => this._settings()?.pepEnabled !== false);

  /** Durée de maintien du statut PPE après la fin de fonction, en mois. */
  public readonly pepPostMandateMonths = computed(
    () => this._settings()?.pepPostMandateMonths ?? 0,
  );

  /**
   * À appeler depuis un composant qui affiche un bloc PPE. Idempotent : les appels suivants
   * sont servis par le `shareReplay`.
   */
  public load(): void {
    this._request$.subscribe();
  }

  /**
   * Après l'enregistrement des réglages : l'écran d'administration vient de changer le drapeau,
   * et les fiches ouvertes ensuite doivent en tenir compte sans recharger l'application.
   */
  public patch(settings: ComplianceSettingsResponse | null): void {
    this._settings.set(settings);
    this._loaded.set(true);
  }
}
