import { computed, inject, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { OpportunitiesApiService, ProjectTemplateSummaryDto } from '@sankore/crm-api';
import { projectAmountLabel } from './project-amount';

/** Ce que le gabarit d'un produit impose à un projet qu'on est en train de créer. */
export interface ProjectCreationRules {
  /** Null tant que le gabarit n'est pas lu : le formulaire garde ses libellés par défaut. */
  template: Signal<ProjectTemplateSummaryDto | null>;
  /** « Montant du crédit », « Prime annuelle »… */
  amountLabel: Signal<string>;
  /** La date de clôture est une échéance : obligatoire à la création. */
  criticalCloseDate: Signal<boolean>;
  /** Faux pour un produit vendu au rendez-vous : ni probabilité ni clôture prévue. */
  tracksForecast: Signal<boolean>;
}

/**
 * Lit le gabarit que suivra un projet sur `product` (`GET opportunities/template`), pour qu'un
 * formulaire de création nomme le montant et exige la date critique AVANT l'envoi — sinon l'agent
 * découvre la règle par un refus. À appeler dans un contexte d'injection (initialiseur de champ).
 */
export function projectCreationRules(product: () => string | null | undefined): ProjectCreationRules {
  const api = inject(OpportunitiesApiService);
  const template = toSignal(
    toObservable(computed(() => (product() ?? '').trim())).pipe(
      debounceTime(150),
      distinctUntilChanged(),
      switchMap((p) => api.getProjectTemplateForProduct(p || undefined).pipe(catchError(() => of(null)))),
    ),
    { initialValue: null },
  );
  return {
    template,
    amountLabel: computed(() => projectAmountLabel(template()?.amountKind)),
    criticalCloseDate: computed(() => !!template()?.criticalCloseDate),
    tracksForecast: computed(() => template()?.tracksForecast !== false),
  };
}
