import { HttpErrorResponse } from '@angular/common/http';
import {
  BeneficialOwnerInputControlTypeEnum,
  ClientSearchItemDto,
  CreateIndividualClientRequestGenderEnum,
  CreateIndividualClientRequestIdentityDocumentTypeEnum,
  CreateIndividualClientRequestMaritalStatusEnum,
  DuplicateHit,
  PostalAddressInput,
} from '@sankore/crm-api';
import { clientTypeLabel, UEMOA_COUNTRIES } from '../../models/client-labels';
import { DuplicateCandidateView } from './duplicate-check-banner';

/**
 * Plomberie commune aux deux assistants de création (personne physique et
 * personne morale) : conversions d'énumérations et mise en forme des payloads.
 *
 * Les champs du formulaire sont des chaînes — `tas-select` ne travaille qu'avec
 * des chaînes et les inputs rendent du texte. La conversion vers le type du
 * contrat se fait ici, à la soumission, en vérifiant la valeur à l'exécution :
 * c'est ce qui permet de ne jamais écrire `as any` sur un champ d'énumération.
 */

/** Pays proposés : la valeur est le code ISO 3166-1 alpha-2, le contrat n'attend qu'une chaîne. */
export const COUNTRY_OPTIONS = UEMOA_COUNTRIES.map((country) => ({
  label: country.label,
  value: country.code,
}));

export const LANGUAGE_OPTIONS = [
  { label: 'Français', value: 'fr' },
  { label: 'Anglais', value: 'en' },
];

export const CURRENCY_OPTIONS = [
  { label: 'XOF', value: 'XOF' },
  { label: 'EUR', value: 'EUR' },
  { label: 'USD', value: 'USD' },
];

// ——— Conversions d'énumérations ———

export function toGender(
  value: string,
): CreateIndividualClientRequestGenderEnum | undefined {
  const names: string[] = Object.values(CreateIndividualClientRequestGenderEnum);
  return names.includes(value)
    ? (value as CreateIndividualClientRequestGenderEnum)
    : undefined;
}

export function toIdentityDocumentType(
  value: string,
): CreateIndividualClientRequestIdentityDocumentTypeEnum | undefined {
  const names: string[] = Object.values(
    CreateIndividualClientRequestIdentityDocumentTypeEnum,
  );
  return names.includes(value)
    ? (value as CreateIndividualClientRequestIdentityDocumentTypeEnum)
    : undefined;
}

export function toControlType(
  value: string,
): BeneficialOwnerInputControlTypeEnum | undefined {
  const names: string[] = Object.values(BeneficialOwnerInputControlTypeEnum);
  return names.includes(value)
    ? (value as BeneficialOwnerInputControlTypeEnum)
    : undefined;
}

/**
 * Même forme que `toIdentityDocumentType` : le contrat nomme ses valeurs, donc la validation
 * suffit. Il y avait ici une table '0'..'4' -> `NUMBER_0..NUMBER_4`, parce que le swagger
 * documentait cette énumération optionnelle en entier et que le générateur nommait les membres
 * d'après leur indice, sans dire ce qu'ils désignaient.
 */
export function toMaritalStatus(
  value: string,
): CreateIndividualClientRequestMaritalStatusEnum | null {
  const names: string[] = Object.values(
    CreateIndividualClientRequestMaritalStatusEnum,
  );
  return names.includes(value)
    ? (value as CreateIndividualClientRequestMaritalStatusEnum)
    : null;
}

// ——— Mise en forme des payloads ———

export interface AddressFormValue {
  street: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
}

/** Une adresse entièrement vide n'est pas envoyée : le serveur la refuserait comme incomplète. */
export function buildAddress(
  value: AddressFormValue,
): PostalAddressInput | undefined {
  const address: PostalAddressInput = {
    street: value.street.trim() || null,
    city: value.city.trim() || null,
    state: value.state.trim() || null,
    country: value.country.trim() || null,
    zipCode: value.zipCode.trim() || null,
  };

  const hasValue = [
    address.street,
    address.city,
    address.state,
    address.country,
    address.zipCode,
  ].some((part) => !!part);

  return hasValue ? address : undefined;
}

export function buildPhoneNumbers(...numbers: string[]): string[] {
  const cleaned = numbers
    .map((number) => number.replace(/\s+/g, ''))
    .filter((number) => number.length > 0);
  return Array.from(new Set(cleaned));
}

export function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toAmountOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  return Number.isFinite(amount) ? amount : null;
}

// ——— Reprise de la saisie de la liste des clients ———

/** Critères transmis par la liste des clients dans le query param `critere`. */
export type ClientSearchCriterion = 'nom' | 'telephone' | 'numero' | 'piece';

export interface CreateClientPrefill {
  /** Nom saisi : nom de famille (personne physique) ou raison sociale (personne morale). */
  name: string;
  phoneNumber: string;
  /** Numéro de pièce (personne physique) ou d'immatriculation (personne morale). */
  documentNumber: string;
}

/**
 * La liste des clients passe sa saisie infructueuse dans `q` + `critere`.
 *
 * Le critère `numero` n'est pas repris : le numéro client est attribué par le
 * serveur, aucun champ de création ne l'accepte.
 */
export function buildPrefill(
  q: string | null | undefined,
  criterion: string | null | undefined,
): CreateClientPrefill | null {
  const term = (q ?? '').trim();
  if (!term) return null;

  const prefill: CreateClientPrefill = {
    name: '',
    phoneNumber: '',
    documentNumber: '',
  };

  switch (criterion) {
    case 'telephone':
      prefill.phoneNumber = term;
      return prefill;
    case 'piece':
      prefill.documentNumber = term;
      return prefill;
    case 'numero':
      return null;
    default:
      prefill.name = term;
      return prefill;
  }
}

// ——— Diagnostic serveur ———

/**
 * Un message générique cache exactement l'information qui fait gagner une heure :
 * on remonte d'abord la première erreur de validation, puis le titre du problème.
 */
export function serverMessage(err: HttpErrorResponse, fallback: string): string {
  const validationErrors = err.error?.errors as
    | Record<string, string[]>
    | undefined;
  if (validationErrors) {
    const first = Object.values(validationErrors).find(
      (messages) => messages?.length,
    );
    if (first?.length) return first[0];
  }
  const title = err.error?.title as string | undefined;
  return title ?? fallback;
}

// ——— Candidats de doublon ———

export function candidatesFromHits(
  hits: DuplicateHit[] | null | undefined,
): DuplicateCandidateView[] {
  return (hits ?? [])
    .filter((hit) => !!hit.clientId)
    .map((hit) => ({
      clientId: hit.clientId as string,
      clientNumber: hit.clientNumber ?? null,
      displayName: hit.displayName ?? null,
      detail: hit.reason ?? null,
    }));
}

export function candidatesFromSearch(
  items: ClientSearchItemDto[] | null | undefined,
): DuplicateCandidateView[] {
  return (items ?? [])
    .filter((item) => !!item.id)
    .map((item) => ({
      clientId: item.id as string,
      clientNumber: item.clientNumber ?? null,
      displayName: item.displayName ?? null,
      detail: [clientTypeLabel(item.clientType), item.primaryPhoneMasked]
        .filter((part) => !!part && part !== '—')
        .join(' · '),
    }));
}
