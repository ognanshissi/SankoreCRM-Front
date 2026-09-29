import { computed, Injectable, signal } from '@angular/core';
import { LeadDto } from '@sankore/crm-api';

/**
 * État partagé de la fiche lead, fourni par la route `leads/:id` et alimenté par
 * `EditLeadNavigation`, qui charge déjà le lead pour son en-tête.
 *
 * Il existe pour une seule raison : **un lead converti n'est plus modifiable**.
 * Cette règle vaut sur tous les onglets, dont la plupart ne chargent pas le lead
 * (rappels, tâches, activités, opportunités…). Sans état partagé, chacun devrait
 * refaire un `getLead` pour connaître un statut que l'écran a déjà — et la règle
 * divergerait d'un onglet à l'autre, ce qui est exactement ce qu'on cherche à
 * éviter.
 */
@Injectable()
export class LeadEditContext {
  private readonly _lead = signal<LeadDto | null>(null);

  public readonly lead = this._lead.asReadonly();

  /** Le lead a été chargé : avant ça, on ne sait rien de son statut. */
  public readonly isKnown = computed(() => this._lead() !== null);

  /**
   * `status` est une chaîne en lecture au contrat (`'Converted'`), là où les
   * écritures de statut passent par des entiers. Ne pas « harmoniser ».
   */
  public readonly isConverted = computed(() => this._lead()?.status === 'Converted');

  public readonly convertedAt = computed(() => this._lead()?.convertedAt ?? null);
  public readonly customerId = computed(
    () => this._lead()?.convertedToCustomerId ?? null,
  );

  /**
   * Ce que les onglets lisent pour désactiver leurs actions. Tant que le lead
   * n'est pas chargé, on ne propose pas de le modifier : ouvrir l'édition puis
   * la retirer une fois le statut connu laisserait le temps d'un clic sur un
   * lead converti.
   */
  public readonly isReadOnly = computed(() => !this.isKnown() || this.isConverted());

  public set(lead: LeadDto | null): void {
    this._lead.set(lead);
  }
}
