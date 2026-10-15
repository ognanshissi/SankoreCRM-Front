import { PRODUCT_TYPE_LABELS } from '@sankore/crm/common';

/**
 * Libellé affichable du produit d'intérêt d'un lead, ou `null` s'il n'est pas renseigné.
 *
 * `interestedProduct` est un texte libre : un code de catégorie (`Loan`), un libellé saisi, ou
 * la valeur `"Unknown"` que le pipeline d'ingestion et la capture système écrivent quand la
 * source ne nomme aucun produit. Affichée telle quelle, elle se lisait « Unknown » comme un
 * produit à part entière.
 */
export function interestedProductLabel(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v || v.toLowerCase() === 'unknown') return null;
  return PRODUCT_TYPE_LABELS[v] ?? v;
}
