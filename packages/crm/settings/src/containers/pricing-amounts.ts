/**
 * Montants et pourcentages des écrans de prix (devis en lignes, lot 1). Par `Intl` et non par le
 * pipe `number` : l'application n'enregistre pas la locale française d'Angular.
 */
const AMOUNT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** « 4 750 », « 12,5 » — pour l'affichage et le champ, sans unité. */
export function decimalText(value: number | null | undefined): string {
  return value == null ? '' : AMOUNT.format(value);
}

/** « 4 750 », « 4750 », « 12,5 » → nombre ; vide → null ; illisible ou négatif → NaN. */
export function parseDecimal(text: string | null | undefined): number | null {
  const cleaned = (text ?? '').replace(/fcfa|xof|%/gi, '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

/** Vrai pour un champ vide ou un nombre lisible compris entre 0 et `max`. */
export function isDecimalOrEmpty(text: string, max = Number.POSITIVE_INFINITY): boolean {
  const v = parseDecimal(text);
  return v === null || (!Number.isNaN(v) && v <= max);
}
