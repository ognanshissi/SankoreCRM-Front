import { CustomersPepStatusDto, LeadsPepStatusDto } from '@sankore/crm-api';

/**
 * Passerelle entre le statut PPE tel que l'API le transporte et celui que les
 * écrans manipulent.
 *
 * Elle existe pour un défaut du générateur OpenAPI, pas pour le confort : le
 * contrat déclare la propriété `function`, qui est un mot réservé en TypeScript ;
 * le générateur la renomme donc `_function` dans `LeadsPepStatusDto` et
 * `CustomersPepStatusDto`. Or les services générés passent l'objet tel quel à
 * `HttpClient` — aucun sérialiseur ne rétablit le nom. Sans cette passerelle,
 * **la fonction PPE part sous la clé `_function` et le serveur ne la lit jamais**,
 * tandis qu'en lecture `dto._function` est toujours `undefined` puisque le JSON
 * reçu porte `function`. Les deux sens sont cassés, en silence et sans erreur
 * HTTP : c'est exactement le genre de bug qu'on ne découvre qu'en base.
 *
 * Conséquence : ne jamais lire `dto._function` ni construire un DTO PPE à la main.
 */
export interface PepStatus {
  isPep: boolean;
  /** Fonction publique exercée. Obligatoire dès que `isPep` est vrai (BNF-F-04). */
  function: string | null;
  countryCode: string | null;
  /** Date de fin de fonction, au format `yyyy-MM-dd`. */
  functionEndDate: string | null;
  /** `Self`, `Family` ou `Associate` — cf. `pepLinkLabel`. */
  link: string | null;
  overrideReason: string | null;
}

type AnyPepDto = (LeadsPepStatusDto | CustomersPepStatusDto) & {
  function?: string | null;
};

export function emptyPepStatus(): PepStatus {
  return {
    isPep: false,
    function: null,
    countryCode: null,
    functionEndDate: null,
    link: null,
    overrideReason: null,
  };
}

export function pepFromDto(dto: LeadsPepStatusDto | CustomersPepStatusDto | null | undefined): PepStatus {
  if (!dto) return emptyPepStatus();
  const raw = dto as AnyPepDto;
  return {
    isPep: raw.isPep ?? false,
    // `function` d'abord : c'est la clé réellement reçue. `_function` ne sert qu'au
    // cas où une version future du générateur corrigerait le renommage.
    function: raw.function ?? raw._function ?? null,
    countryCode: raw.countryCode ?? null,
    functionEndDate: raw.functionEndDate ?? null,
    link: raw.link ?? null,
    overrideReason: raw.overrideReason ?? null,
  };
}

/**
 * Construit le corps attendu par l'API. Le `as unknown as` est délibéré : on émet
 * la clé `function` du contrat, que le type généré ne connaît pas.
 */
export function pepToDto(pep: PepStatus): LeadsPepStatusDto {
  const body = {
    isPep: pep.isPep,
    function: pep.isPep ? (pep.function ?? null) : null,
    countryCode: pep.isPep ? (pep.countryCode ?? null) : null,
    functionEndDate: pep.isPep ? (pep.functionEndDate ?? null) : null,
    link: pep.isPep ? (pep.link ?? null) : null,
    overrideReason: pep.overrideReason ?? null,
  };
  return body as unknown as LeadsPepStatusDto;
}
