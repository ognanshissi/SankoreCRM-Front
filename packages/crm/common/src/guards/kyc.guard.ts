import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { from, isObservable, of, switchMap } from 'rxjs';
import { TenantKycService } from '../services/tenant-kyc.service';
import { AccessDeniedService } from '../components/access-denied/access-denied.service';
import { afterUserLoaded } from './after-user-loaded';

const KYC_DISABLED_TEXT =
  "Le KYC est désactivé pour votre institution. Un administrateur peut le réactiver depuis Paramétrage › Conformité.";

/** Écrans qui AGISSENT sur le KYC (enrôlement, contrôles) : seulement quand il est en vigueur. */
export function kycGuard(): CanActivateFn {
  return (_route, state) => {
    const kyc = inject(TenantKycService);
    const accessDenied = inject(AccessDeniedService);
    const router = inject(Router);

    return afterUserLoaded(() => {
      if (kyc.inForce()) return true;
      accessDenied.notifyMessage(state.url, 'KYC désactivé', KYC_DISABLED_TEXT);
      return router.createUrlTree(['/tasks/my-day']);
    });
  };
}

/**
 * Écrans de CONSULTATION (tableau de bord, dossier, onglet KYC du client) : ouverts aussi KYC coupé
 * tant qu'il reste des dossiers, en lecture seule.
 */
export function kycReadGuard(): CanActivateFn {
  return (_route, state) => {
    const kyc = inject(TenantKycService);
    const accessDenied = inject(AccessDeniedService);
    const router = inject(Router);

    const decide = (readable: boolean) => {
      if (readable) return true;
      accessDenied.notifyMessage(state.url, 'KYC désactivé', KYC_DISABLED_TEXT);
      return router.createUrlTree(['/tasks/my-day']);
    };
    const loaded = afterUserLoaded(() => true);
    return (isObservable(loaded) ? loaded : of(loaded)).pipe(
      switchMap(() => from(kyc.readableAsync())),
      switchMap((readable) => of(decide(readable))),
    );
  };
}
