import { KycSettingDto } from '@sankore/crm-api';

/**
 * Forme de saisie déduite de `KycSettingDto.valueType`.
 *
 * Le contrat déclare `valueType` en `string` libre, sans énumération : les valeurs réellement
 * envoyées par le serveur ne sont donc pas connues à la compilation. On reconnaît les orthographes
 * courantes et **tout le reste retombe sur `text`** — un paramètre d'un type inattendu reste
 * modifiable en texte brut plutôt que de devenir invisible, et c'est le serveur qui refuse une
 * valeur mal typée.
 */
export type KycSettingKind = 'boolean' | 'integer' | 'decimal' | 'text';

export function kycSettingKind(valueType: string | null | undefined): KycSettingKind {
  switch ((valueType ?? '').trim().toLowerCase()) {
    case 'bool':
    case 'boolean':
      return 'boolean';
    case 'int':
    case 'int32':
    case 'int64':
    case 'integer':
    case 'long':
    case 'number':
      return 'integer';
    case 'decimal':
    case 'double':
    case 'float':
    case 'percent':
    case 'percentage':
      return 'decimal';
    default:
      return 'text';
  }
}

/** Libellé français du type, pour la colonne « Type ». */
export function kycSettingKindLabel(kind: KycSettingKind): string {
  switch (kind) {
    case 'boolean':
      return 'Oui / Non';
    case 'integer':
      return 'Entier';
    case 'decimal':
      return 'Nombre';
    default:
      return 'Texte';
  }
}

/** Les deux seules valeurs qu'un booléen accepte à l'écriture, le contrat ne transportant que du texte. */
export const KYC_SETTING_BOOLEAN_OPTIONS = [
  { label: 'Oui', value: 'true' },
  { label: 'Non', value: 'false' },
];

/** Affichage d'un booléen transporté en chaîne, sans préjuger de la casse envoyée par le serveur. */
export function kycSettingDisplayValue(value: string | null | undefined, kind: KycSettingKind): string {
  const raw = (value ?? '').trim();
  if (!raw) return '—';
  if (kind !== 'boolean') return raw;
  if (raw.toLowerCase() === 'true') return 'Oui';
  if (raw.toLowerCase() === 'false') return 'Non';
  return raw;
}

/**
 * Ligne affichée. Les champs dérivés sont calculés une fois au chargement : le corps de `tas-table`
 * est un `ng-template` réévalué à chaque détection de changement, et une fonction par cellule y
 * serait rejouée en boucle.
 */
export interface KycSettingRow {
  key: string;
  /**
   * Description renvoyée par le serveur. C'est **la seule explication disponible** d'un paramètre :
   * le contrat ne déclare aucune liste de clés, donc aucun libellé français ne peut être écrit ici
   * sans inventer une correspondance qui se périmerait à la première clé ajoutée côté backend.
   */
  description: string;
  kind: KycSettingKind;
  kindLabel: string;
  value: string;
  displayValue: string;
  defaultValue: string;
  displayDefaultValue: string;
  isDefault: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export function toKycSettingRow(dto: KycSettingDto): KycSettingRow {
  const kind = kycSettingKind(dto.valueType);
  const value = dto.value ?? '';
  const defaultValue = dto.defaultValue ?? '';
  return {
    key: dto.key ?? '',
    description: dto.description?.trim() ?? '',
    kind,
    kindLabel: kycSettingKindLabel(kind),
    value,
    displayValue: kycSettingDisplayValue(value, kind),
    defaultValue,
    displayDefaultValue: kycSettingDisplayValue(defaultValue, kind),
    isDefault: dto.isDefault ?? false,
    updatedAt: dto.updatedAt ?? null,
    updatedBy: dto.updatedBy ?? null,
  };
}
