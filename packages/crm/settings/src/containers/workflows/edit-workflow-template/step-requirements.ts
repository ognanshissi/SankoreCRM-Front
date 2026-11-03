import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgClass } from '@angular/common';
import { RouterLink } from '@angular/router';
import { InstanceRequirementsDto } from '@sankore/crm-api';
import { Anchor } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';

/** Les champs du lead que son tiroir « Modifier les informations » permet de remplir. */
const LEAD_DRAWER_FIELDS = new Set([
  'firstName', 'lastName', 'email', 'gender', 'dateOfBirth', 'companyName', 'companyEmail', 'companyPhone',
  'website', 'interestedProduct', 'campaign', 'preferredLanguage', 'preferredAgencyId', 'comment',
]);
/** Ceux de l'onglet « Détails du lead » (situation et adresse), toujours modifiable. */
const LEAD_DETAIL_FIELDS = new Set(['profession', 'maritalStatus', 'addressLine', 'postalCode', 'city', 'countryCode']);

/**
 * « Avant d'approuver » : ce que l'étape ouverte attend du dossier, point par point, lu avant le clic.
 * Sans cette liste, on ne découvrait le champ manquant — souvent sur le lead d'un projet — qu'au refus
 * du serveur, sans savoir où le remplir. Partagé par l'écran d'instance et « Ma file ».
 */
@Component({
  selector: 'workflow-step-requirements',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, RouterLink, Anchor, TasIcon],
  template: `
    @if (items().length) {
      <div class="rounded-lg border px-3 py-2.5"
           [ngClass]="missing() ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm font-medium" [ngClass]="missing() ? 'text-amber-900' : 'text-green-800'">
            @if (missing()) {
              Avant d'approuver : {{ missing() }} point{{ missing() > 1 ? 's' : '' }} à compléter
            } @else {
              Le dossier est prêt : l'étape peut être approuvée
            }
          </p>
          @if (missing() && completeLink(); as link) {
            <a tas-raised-button color="primary" size="small" [routerLink]="link.commands" [queryParams]="link.queryParams">
              <tas-icon iconName="feather:edit-2" style="font-size:13px"></tas-icon>
              Compléter le dossier
            </a>
          }
        </div>
        <ul class="mt-2 flex flex-col gap-1">
          @for (item of items(); track $index) {
            <li class="flex items-start gap-2 text-sm">
              @if (item.satisfied) {
                <tas-icon iconName="feather:check-circle" class="mt-0.5 shrink-0 text-green-600" style="font-size:14px"></tas-icon>
                <span class="text-slate-700">{{ item.label }}</span>
              } @else {
                <tas-icon iconName="feather:x-circle" class="mt-0.5 shrink-0 text-amber-600" style="font-size:14px"></tas-icon>
                <span class="font-medium text-amber-900">{{ item.label }}</span>
              }
            </li>
          }
        </ul>
        @if (missing() && requirements()?.completeOnEntityType === 'Lead' && entityType() === 'Opportunity') {
          <p class="mt-2 text-xs text-amber-800">Ces champs se remplissent sur le lead du projet.</p>
        }
      </div>
    }
  `,
})
export class WorkflowStepRequirements {
  public readonly requirements = input<InstanceRequirementsDto | null>(null);
  public readonly instanceId = input.required<string>();
  /** Le type de dossier de l'instance (`Opportunity` pour un projet). */
  public readonly entityType = input<string | null | undefined>(null);

  public readonly items = computed(() => this.requirements()?.items ?? []);
  public readonly missing = computed(() => this.items().filter((i) => !i.satisfied).length);

  /**
   * Le dossier qui porte les points de l'étape (le lead pour un projet), ouvert là où le champ manquant
   * se remplit : le tiroir de modification du lead (qui ramène à l'instance après l'enregistrement),
   * sinon l'onglet « Détails du lead » pour la situation et l'adresse, sinon l'onglet Informations
   * (champs personnalisés). Le tiroir passe d'abord ; la liste relue dit ensuite ce qu'il reste.
   */
  public readonly completeLink = computed<{ commands: unknown[]; queryParams: Record<string, string> | null } | null>(() => {
    const req = this.requirements();
    if (!req?.completeOnEntityId) return null;
    const id = req.completeOnEntityId;
    switch (req.completeOnEntityType) {
      case 'Lead': {
        const missing = this.items().filter((i) => !i.satisfied).map((i) => i.fieldKey ?? '');
        if (missing.some((k) => LEAD_DRAWER_FIELDS.has(k))) {
          return {
            commands: ['/leads', id, 'informations'],
            queryParams: { modifier: '1', retour: `/settings/workflows/instances/${this.instanceId()}` },
          };
        }
        if (missing.some((k) => LEAD_DETAIL_FIELDS.has(k))) return { commands: ['/leads', id, 'identite'], queryParams: null };
        return { commands: ['/leads', id, 'informations'], queryParams: null };
      }
      case 'Opportunity': return { commands: ['/leads/projets', id], queryParams: null };
      case 'Account': return { commands: ['/customers', id], queryParams: null };
      default: return null;
    }
  });
}
