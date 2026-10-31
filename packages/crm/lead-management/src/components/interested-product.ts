import { PRODUCT_TYPE_LABELS } from '@sankore/crm/common';

/**
 * Libellé affichable du produit d'intérêt d'un lead, ou `null` s'il n'est pas renseigné.
 *
 * `interestedProduct` est un texte libre : le code d'un produit du catalogue (`S_PUS001`, ce que
 * pose le tiroir d'édition), un code de catégorie (`Loan`), un libellé saisi, ou la valeur
 * `"Unknown"` que le pipeline d'ingestion et la capture système écrivent quand la source ne nomme
 * aucun produit. Affichée telle quelle, elle se lisait « Unknown » comme un produit à part entière.
 * `productNames` (code → nom, `ProductNamesStore.names()`) traduit un code du catalogue.
 */
export function interestedProductLabel(
  value: string | null | undefined,
  productNames?: Record<string, string>,
): string | null {
  const v = value?.trim();
  if (!v || v.toLowerCase() === 'unknown') return null;
  return productNames?.[v] ?? PRODUCT_TYPE_LABELS[v] ?? v;
}
