import { computed, effect, inject, Injectable, linkedSignal, Signal, signal } from '@angular/core';
import { firstValueFrom, catchError, of, map } from 'rxjs';
import { KYCApiService } from '@sankore/crm-api';
import { AuthenticationService } from './authentification.service';

/**
 * Le KYC de l'institution (docs/kyc-par-institution.md) : en vigueur, ou coupé par
 * l'administrateur en socle seul.
 *
 * - `inForce` vient du profil (`kycInForce`), vrai tant que le profil n'est pas chargé : les gardes
 *   attendent le profil, et un écran KYC montré une seconde de trop vaut mieux qu'un KYC caché à
 *   une institution qui le fait.
 * - Coupé, les dossiers déjà ouverts restent CONSULTABLES. `readable` le dit : en vigueur, ou au
 *   moins un dossier existe (lu une fois). Une institution qui n'en a jamais eu ne voit rien.
 */
@Injectable({ providedIn: 'root' })
export class TenantKycService {
  private readonly _auth = inject(AuthenticationService);
  private readonly _kycApi = inject(KYCApiService);

  /** Poussé par l'écran Conformité après une bascule, sans recharger le profil. */
  private readonly _inForce = linkedSignal<boolean>(() => this._auth.connectedUser()?.kycInForce ?? true);
  public readonly inForce = this._inForce.asReadonly();

  private readonly _hasFiles = signal<boolean | null>(null);
  private _loading: Promise<boolean> | null = null;

  /** Coupé : les écrans KYC se consultent sans pouvoir agir. */
  public readonly readOnly = computed(() => !this.inForce());

  public readonly readable = computed(() => this.inForce() || this._hasFiles() === true);

  constructor() {
    effect(() => {
      if (this._auth.connectedUser() && !this.inForce() && this._hasFiles() === null) void this.readableAsync();
    });
  }

  /** Pour les gardes : attend, si besoin, de savoir s'il reste des dossiers à consulter. */
  public async readableAsync(): Promise<boolean> {
    if (this.inForce()) return true;
    if (this._hasFiles() !== null) return this._hasFiles()!;
    this._loading ??= firstValueFrom(
      this._kycApi.listKycFiles(undefined, undefined, undefined, undefined, undefined, 1, 1).pipe(
        map((page) => (page.totalCount ?? page.rows?.length ?? 0) > 0),
        // Sans droit de lecture ou en panne : rien à consulter, le menu et l'onglet restent cachés.
        catchError(() => of(false)),
      ),
    ).then((has) => {
      this._hasFiles.set(has);
      this._loading = null;
      return has;
    });
    return this._loading;
  }

  /**
   * Un droit d'ÉCRITURE sur le KYC, seulement tant qu'il est en vigueur : coupé, le bouton se masque
   * plutôt que d'échouer en 409 `KYC_DISABLED`. Les droits de lecture ne passent pas par là.
   */
  public whileInForce(allowed: Signal<boolean>): Signal<boolean> {
    return computed(() => this.inForce() && allowed());
  }

  public sync(inForce: boolean): void {
    this._inForce.set(inForce);
    if (!inForce) this._hasFiles.set(null);
  }
}
