import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Anchor } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { ClientDetailStore } from '../../models/client-detail.store';

/**
 * Une adhésion du client à un groupe, telle que l'onglet l'affiche.
 *
 * Elle n'a pas d'équivalent direct dans le contrat : `GroupMemberDto` décrit un membre *vu depuis
 * le groupe* et ne porte ni le nom ni le type du groupe. La reconstituer côté client suppose donc
 * de connaître les groupes du client — c'est précisément ce que l'API ne permet pas (voir le
 * commentaire de la classe).
 */
interface GroupMembershipRow {
  membershipId: string;
  groupId: string;
  groupName: string;
  groupType: string;
  officeRole: string | null;
  joinedAt: string;
  leftAt: string | null;
  leaveReason: string | null;
}

/**
 * Onglet « Groupes » de la fiche client — US-M01-FE-13.
 *
 * **Le critère d'acceptation n'est pas couvert, faute d'endpoint.** Le contrat n'offre aucun moyen
 * de lister les groupes d'un client donné :
 *
 * - `GET /api/v1/client-groups` (`ClientGroupsApiService.listClientGroups`) filtre par `type`,
 *   `status`, `agencyId`, `search`, `page` et `pageSize` — aucun paramètre `clientId` ni
 *   `memberClientId`, et `search` porte sur le groupe, pas sur ses membres ;
 * - `GET /api/v1/client-groups/{groupId}` ne va que dans l'autre sens : il faut déjà connaître le
 *   groupe pour en lire les membres ;
 * - `ClientDetailDto` ne porte aucune liste d'adhésions.
 *
 * Balayer tous les groupes de l'institution puis lire les membres de chacun donnerait la bonne
 * réponse au prix d'une requête par groupe : ce n'est pas tenable et cela masquerait le manque.
 * L'onglet affiche donc un état vide explicite plutôt qu'une liste inventée, et `memberships`
 * reste le point d'entrée unique à brancher le jour où l'API expose la lecture par client.
 */
@Component({
  selector: 'client-groupes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasCard, TasIcon, TasTag, Anchor, RouterLink],
  template: `
    <div class="flex flex-col gap-4">
      <tas-card class="block">
        <div class="flex flex-wrap items-start justify-between gap-3 p-4">
          <div>
            <p class="text-sm font-medium text-slate-700">Groupes et adhésions</p>
            <p class="mt-1 text-xs text-slate-500">
              Les groupes solidaires, associations et coopératives auxquels
              {{ store.client()?.displayName || 'ce client' }} appartient.
            </p>
          </div>
          <a tas-outlined-button color="primary" [routerLink]="['/customers/groupes']">
            <tas-icon iconName="feather:users" style="font-size:14px"></tas-icon>
            Parcourir les groupes
          </a>
        </div>
      </tas-card>

      <tas-card class="block">
        <div class="flex items-center gap-2 border-b border-slate-200 p-4">
          <tas-icon iconName="feather:user-plus" style="font-size:16px" class="text-primary"></tas-icon>
          <p class="text-sm font-medium text-slate-700">Adhésions actives</p>
          <span class="text-xs text-slate-500 tabular-nums">({{ activeMemberships().length }})</span>
        </div>

        @if (activeMemberships().length === 0) {
          <div class="p-6">
            <div class="flex items-start gap-3">
              <tas-icon
                iconName="feather:alert-circle"
                style="font-size:16px"
                class="mt-0.5 text-slate-400"
              ></tas-icon>
              <div class="text-sm">
                <p class="font-medium text-slate-700">Adhésions indisponibles</p>
                <p class="mt-1 text-slate-500">
                  L'API ne propose aucune lecture des groupes d'un client : la liste des groupes
                  se filtre par type, statut, agence et nom de groupe, jamais par membre. Tant que
                  ce point de lecture n'existe pas, cet onglet ne peut rien afficher de fiable.
                </p>
                <p class="mt-2 text-slate-500">
                  Ouvrez la fiche d'un groupe depuis la liste des groupes pour voir ses membres.
                </p>
              </div>
            </div>
          </div>
        } @else {
          <ul class="divide-y divide-slate-100">
            @for (membership of activeMemberships(); track membership.membershipId) {
              <li class="flex flex-wrap items-center justify-between gap-3 p-4">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <a
                      tas-text-button
                      color="primary"
                      [routerLink]="['/customers/groupes', membership.groupId]"
                    >
                      {{ membership.groupName }}
                    </a>
                    <tas-tag severity="info">{{ membership.groupType }}</tas-tag>
                    @if (membership.officeRole) {
                      <tas-tag severity="primary">{{ membership.officeRole }}</tas-tag>
                    }
                  </div>
                  <p class="mt-1 text-xs text-slate-500">
                    Membre depuis le {{ formatDate(membership.joinedAt) }}
                  </p>
                </div>
              </li>
            }
          </ul>
        }
      </tas-card>

      <tas-card class="block">
        <div class="flex items-center gap-2 border-b border-slate-200 p-4">
          <tas-icon iconName="feather:archive" style="font-size:16px" class="text-slate-400"></tas-icon>
          <p class="text-sm font-medium text-slate-700">Adhésions passées</p>
          <span class="text-xs text-slate-500 tabular-nums">({{ pastMemberships().length }})</span>
        </div>

        @if (pastMemberships().length === 0) {
          <div class="p-6 text-sm text-slate-500">Aucune adhésion passée à afficher.</div>
        } @else {
          <ul class="divide-y divide-slate-100">
            @for (membership of pastMemberships(); track membership.membershipId) {
              <li class="p-4">
                <div class="flex items-center gap-2">
                  <a
                    tas-text-button
                    color="primary"
                    [routerLink]="['/customers/groupes', membership.groupId]"
                  >
                    {{ membership.groupName }}
                  </a>
                  <tas-tag severity="neutral">{{ membership.groupType }}</tas-tag>
                  @if (membership.officeRole) {
                    <tas-tag severity="neutral">{{ membership.officeRole }}</tas-tag>
                  }
                </div>
                <p class="mt-1 text-xs text-slate-500">
                  Du {{ formatDate(membership.joinedAt) }} au {{ formatDate(membership.leftAt) }}
                  @if (membership.leaveReason) {
                    · {{ membership.leaveReason }}
                  }
                </p>
              </li>
            }
          </ul>
        }
      </tas-card>
    </div>
  `,
})
export class ClientGroupsTabPage {
  protected readonly store = inject(ClientDetailStore);

  /**
   * Point d'entrée unique des adhésions. Il reste vide faute d'endpoint : brancher ici la lecture
   * des groupes du client suffira à faire vivre les deux sections ci-dessus.
   */
  protected readonly memberships = signal<GroupMembershipRow[]>([]);

  protected readonly activeMemberships = computed(() =>
    this.memberships().filter((m) => !m.leftAt),
  );
  protected readonly pastMemberships = computed(() =>
    this.memberships()
      .filter((m) => !!m.leftAt)
      .sort((a, b) => (b.leftAt ?? '').localeCompare(a.leftAt ?? '')),
  );

  /**
   * Les dates du contrat arrivent en `yyyy-MM-dd` : `DatePipe` les interprète en UTC et peut
   * afficher la veille selon le fuseau, alors que le découpage de la chaîne ne décale rien.
   */
  protected formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const [year, month, day] = value.slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : value;
  }
}

export default ClientGroupsTabPage;
