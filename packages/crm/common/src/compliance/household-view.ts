import {
  CustomersHouseholdMemberDto,
  CustomersPersonIdentityDto,
  LeadsHouseholdMemberDto,
  LeadsPersonIdentityDto,
} from '@sankore/crm-api';
import {
  householdMemberTypeLabel,
  spouseUnionTypeLabel,
} from './compliance-labels';
import { PepStatus, pepFromDto } from './pep-wire';
import { identityLabel } from './person-identity';

/** Une désignation portée par un membre, telle que la fiche client l'affiche. */
export interface HouseholdDesignationView {
  holdingId: string;
  productLabel: string;
  roleLabel: string;
  statusLabel: string;
  toReview: boolean;
}

/**
 * Vue normalisée d'un membre du foyer, indépendante du côté lead ou client.
 *
 * BNF-F-09 exige explicitement « mêmes composants que l'onglet Foyer du lead
 * (réutilisation, aucune duplication) ». Or les deux côtés ont deux DTO distincts
 * (`Leads.HouseholdMemberDto` et `Customers.HouseholdMemberDto`), des APIs
 * d'écriture distinctes et des champs que l'un a et l'autre pas
 * (`sourceLeadMemberId`, `relatedClientId`). Cette vue est le point de rencontre :
 * `household-members-list` ne connaît qu'elle, chaque côté fournit son mappeur et
 * garde son propre chemin d'écriture.
 */
export interface HouseholdMemberView {
  memberId: string;
  /** `Spouse`, `Child`, `Dependent`… tel que l'API le renvoie. */
  type: string | null;
  typeLabel: string;
  spouseUnionType: string | null;
  unionLabel: string | null;
  displayName: string;
  /**
   * Identité complète, conservée telle que l'API l'a renvoyée : le drawer de
   * modification repart d'elle. Reconstituer prénom et nom en découpant
   * `displayName` perdrait les noms composés dès la première modification.
   */
  identity: LeadsPersonIdentityDto | CustomersPersonIdentityDto | null;
  birthDate: string | null;
  age: number | null;
  city: string | null;
  usesPrincipalAddress: boolean;
  isPepExposed: boolean;
  pep: PepStatus;
  isActive: boolean;
  removedAt: string | null;
  removalReason: string | null;
  /** Membre repris de la conversion d'un lead (BNF-F-09). */
  fromLead: boolean;
  /** Fiche client rattachée au membre, quand il en a une. */
  relatedClientId: string | null;
  designations: HouseholdDesignationView[];
}

export function householdMemberFromLead(
  dto: LeadsHouseholdMemberDto,
): HouseholdMemberView {
  return {
    memberId: dto.memberId ?? '',
    type: dto.type ?? null,
    typeLabel: householdMemberTypeLabel(dto.type),
    spouseUnionType: dto.spouseUnionType ?? null,
    unionLabel: dto.spouseUnionType ? spouseUnionTypeLabel(dto.spouseUnionType) : null,
    displayName: identityLabel(dto.identity),
    identity: dto.identity ?? null,
    birthDate: dto.identity?.birthDate ?? null,
    age: dto.age ?? null,
    city: dto.identity?.city ?? null,
    usesPrincipalAddress: dto.usesPrincipalAddress === true,
    isPepExposed: dto.isPepExposed === true,
    pep: pepFromDto(dto.pep),
    isActive: dto.isActive !== false,
    removedAt: dto.removedAt ?? null,
    removalReason: dto.removalReason ?? null,
    fromLead: false,
    relatedClientId: null,
    designations: [],
  };
}

export function householdMemberFromClient(
  dto: CustomersHouseholdMemberDto,
  designations: HouseholdDesignationView[] = [],
): HouseholdMemberView {
  return {
    memberId: dto.memberId ?? '',
    type: dto.type ?? null,
    typeLabel: householdMemberTypeLabel(dto.type),
    spouseUnionType: dto.spouseUnionType ?? null,
    unionLabel: dto.spouseUnionType ? spouseUnionTypeLabel(dto.spouseUnionType) : null,
    displayName: dto.displayName?.trim() || identityLabel(dto.identity),
    identity: dto.identity ?? null,
    birthDate: dto.identity?.birthDate ?? null,
    age: dto.age ?? null,
    city: dto.identity?.city ?? null,
    usesPrincipalAddress: dto.usesPrincipalAddress === true,
    isPepExposed: dto.isPepExposed === true,
    pep: pepFromDto(dto.pep),
    isActive: dto.isActive !== false,
    removedAt: dto.validTo ?? null,
    removalReason: dto.closeReason ?? null,
    fromLead: !!dto.sourceLeadMemberId,
    relatedClientId: dto.relatedClientId ?? null,
    designations,
  };
}
