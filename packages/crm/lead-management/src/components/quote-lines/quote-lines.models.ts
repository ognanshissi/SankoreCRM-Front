import { ProjectQuoteDto, SetProjectQuoteRequest } from '@sankore/crm-api';
import { currencyUnit } from '@sankore/crm/common';

/**
 * Lignes d'un projet (devis en lignes, lot 4) : le brouillon que l'écran édite, et le calcul des
 * totaux en direct. Le calcul reproduit celui du serveur (`QuoteTotals`, module Leads) ; c'est le
 * serveur qui fait foi à l'enregistrement — l'écran ne fait que montrer le résultat avant.
 */

export type QuoteDiscountKind = 'None' | 'Percent' | 'Amount';
export type QuoteVatCategory = 'Standard' | 'Reduced' | 'Exempt';

/** Les champs saisis sont des chaînes, comme partout : la conversion se fait au calcul et à l'envoi. */
export interface QuoteLineDraft {
  /** Clé locale, pour le `track` : une ligne neuve n'a pas encore d'id. */
  key: string;
  /** L'id serveur d'une ligne déjà enregistrée : elle garde alors son taux et son prix catalogue. */
  id: string | null;
  productId: string;
  label: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountKind: QuoteDiscountKind;
  discountValue: string;
  vatCategory: QuoteVatCategory;
  /** Le produit et le taux enregistrés avec la ligne ; null pour une ligne neuve. */
  savedProductId: string | null;
  savedVatRate: number | null;
  savedCataloguePrice: number | null;
}

export interface QuoteDraft {
  lines: QuoteLineDraft[];
  globalKind: QuoteDiscountKind;
  globalValue: string;
}

export interface QuoteRules {
  currency: string;
  standardRate: number;
  reducedRate: number;
  /** Plafond de remise en % ; null = aucun. */
  ceiling: number | null;
}

export interface CatalogueProduct {
  id: string;
  code: string;
  name: string;
  unitPrice: number | null;
  priceUnit: string | null;
  vatCategory: QuoteVatCategory;
}

export interface LineAmounts {
  gross: number;
  discount: number;
  net: number;
  vatRate: number;
  vat: number;
  total: number;
  /** La remise dépasse le montant de la ligne. */
  discountTooHigh: boolean;
}

export interface QuoteComputation {
  lines: LineAmounts[];
  subtotal: number;
  globalDiscount: number;
  totalExclTax: number;
  vatByRate: { rate: number; base: number; vat: number }[];
  totalVat: number;
  totalInclTax: number;
  effectiveDiscountPercent: number;
  globalDiscountTooHigh: boolean;
  needsApproval: boolean;
}

export const DISCOUNT_KIND_OPTIONS = [
  { value: 'None', label: 'Aucune' },
  { value: 'Percent', label: '%' },
  { value: 'Amount', label: 'Montant' },
];

let _seq = 0;
export const newLineKey = (): string => `l${Date.now().toString(36)}${(_seq++).toString(36)}`;

/** Chiffres après la virgule : aucun pour les francs CFA et le franc guinéen (ISO 4217). */
export function minorDigits(currency: string | null | undefined): number {
  const c = (currency || 'XOF').toUpperCase();
  return c === 'XOF' || c === 'XAF' || c === 'GNF' ? 0 : 2;
}

/** Arrondi au plus proche, la moitié vers le haut en valeur absolue — `MidpointRounding.AwayFromZero`. */
export function roundTo(value: number, digits: number): number {
  const f = 10 ** digits;
  return (Math.sign(value) * Math.round(Math.abs(value) * f + Number.EPSILON)) / f;
}

/** « 4 750 », « 4750 », « 12,5 » → nombre ; vide → null ; illisible ou négatif → NaN. */
export function parseNumber(text: string | null | undefined): number | null {
  const cleaned = (text ?? '').replace(/fcfa|xof|%/gi, '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!cleaned) return null;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

/** « 475 000 FCFA », « 12,50 EUR » : avec les décimales de la monnaie. */
export function formatMoney(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null) return '';
  const digits = minorDigits(currency);
  const text = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  return `${text} ${currencyUnit(currency)}`;
}

/** « 4 750 » dans un champ, sans unité. */
export function numberText(value: number | null | undefined): string {
  return value == null ? '' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(value);
}

export function percentText(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
}

/** Le taux d'une ligne : celui de sa saisie tant qu'elle garde son produit, sinon celui d'aujourd'hui. */
export function vatRateOf(line: QuoteLineDraft, rules: QuoteRules): number {
  if (line.id && line.savedProductId === line.productId && line.savedVatRate != null) return line.savedVatRate;
  return line.vatCategory === 'Reduced' ? rules.reducedRate : line.vatCategory === 'Exempt' ? 0 : rules.standardRate;
}

function cataloguePriceOf(line: QuoteLineDraft, catalogue: CatalogueProduct[]): number | null {
  if (line.id && line.savedProductId === line.productId) return line.savedCataloguePrice;
  return catalogue.find((p) => p.id === line.productId)?.unitPrice ?? null;
}

export function computeQuote(draft: QuoteDraft, rules: QuoteRules, catalogue: CatalogueProduct[]): QuoteComputation {
  const d = minorDigits(rules.currency);
  const R = (v: number) => roundTo(v, d);
  const num = (t: string) => {
    const v = parseNumber(t);
    return v === null || Number.isNaN(v) ? 0 : v;
  };

  let subtotal = 0;
  let reference = 0;
  const lines = draft.lines.map((line) => {
    const qty = num(line.quantity);
    const price = num(line.unitPrice);
    const gross = R(qty * price);
    const value = num(line.discountValue);
    const discount = line.discountKind === 'Percent' ? R((gross * value) / 100) : line.discountKind === 'Amount' ? value : 0;
    const discountTooHigh = discount > gross;
    const net = Math.max(0, gross - discount);
    const vatRate = vatRateOf(line, rules);
    const vat = R((net * vatRate) / 100);
    subtotal += net;
    reference += R(qty * (cataloguePriceOf(line, catalogue) ?? price));
    return { gross, discount, net, vatRate, vat, total: net + vat, discountTooHigh };
  });

  const gv = num(draft.globalValue);
  const globalDiscount = draft.globalKind === 'Percent' ? R((subtotal * gv) / 100) : draft.globalKind === 'Amount' ? gv : 0;
  const globalDiscountTooHigh = globalDiscount > subtotal;
  const totalExclTax = Math.max(0, subtotal - globalDiscount);
  const factor = subtotal === 0 ? 0 : totalExclTax / subtotal;

  const rates = new Map<number, number>();
  lines.forEach((l) => rates.set(l.vatRate, (rates.get(l.vatRate) ?? 0) + l.net));
  const vatByRate = [...rates.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, net]) => {
      const base = R(net * factor);
      return { rate, base, vat: R((base * rate) / 100) };
    });
  const totalVat = vatByRate.reduce((s, b) => s + b.vat, 0);
  const effectiveDiscountPercent = reference <= 0 ? 0 : Math.max(0, roundTo((1 - totalExclTax / reference) * 100, 2));

  return {
    lines, subtotal, globalDiscount, totalExclTax, vatByRate, totalVat,
    totalInclTax: totalExclTax + totalVat, effectiveDiscountPercent, globalDiscountTooHigh,
    needsApproval: rules.ceiling != null && effectiveDiscountPercent > rules.ceiling,
  };
}

export function emptyLine(): QuoteLineDraft {
  return {
    key: newLineKey(), id: null, productId: '', label: '', quantity: '1', unit: '', unitPrice: '',
    discountKind: 'None', discountValue: '', vatCategory: 'Standard',
    savedProductId: null, savedVatRate: null, savedCataloguePrice: null,
  };
}

export function draftFromDto(dto: ProjectQuoteDto | null): QuoteDraft {
  return {
    lines: (dto?.lines ?? []).map((l) => ({
      key: l.id ?? newLineKey(),
      id: l.id ?? null,
      productId: l.productId ?? '',
      label: l.label ?? '',
      quantity: numberText(l.quantity),
      unit: l.unit ?? '',
      unitPrice: numberText(l.unitPrice),
      discountKind: (l.discountKind as QuoteDiscountKind | undefined) ?? 'None',
      discountValue: l.discountKind && l.discountKind !== 'None' ? numberText(l.discountValue) : '',
      vatCategory: (l.vatCategory as QuoteVatCategory | undefined) ?? 'Standard',
      savedProductId: l.productId ?? null,
      savedVatRate: l.vatRate ?? null,
      savedCataloguePrice: l.catalogueUnitPrice ?? null,
    })),
    globalKind: (dto?.globalDiscountKind as QuoteDiscountKind | undefined) ?? 'None',
    globalValue: dto?.globalDiscountKind && dto.globalDiscountKind !== 'None' ? numberText(dto.globalDiscountValue) : '',
  };
}

export function draftToRequest(draft: QuoteDraft, expectedUpdatedAt?: string | null): SetProjectQuoteRequest {
  const n = (t: string) => parseNumber(t) ?? 0;
  return {
    lines: draft.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      quantity: n(l.quantity),
      label: l.label.trim() || null,
      unit: l.unit.trim() || null,
      unitPrice: parseNumber(l.unitPrice),
      discountKind: l.discountKind as never,
      discountValue: l.discountKind === 'None' ? 0 : n(l.discountValue),
    })),
    globalDiscountKind: draft.globalKind as never,
    globalDiscountValue: draft.globalKind === 'None' ? 0 : n(draft.globalValue),
    expectedUpdatedAt: expectedUpdatedAt ?? null,
  };
}

/** Les messages du serveur, en français. */
export function quoteErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'QUOTE_FINANCE_PROJECT': return 'Un projet de crédit, d’épargne ou d’assurance garde un seul produit.';
    case 'QUOTE_PRODUCT_NOT_STANDARD': return 'Seuls les produits Standard peuvent figurer sur un devis.';
    case 'QUOTE_PRODUCT_INACTIVE': return 'Un produit retiré du catalogue ne peut plus être ajouté.';
    case 'QUOTE_PRODUCT_NOT_FOUND': return 'Un produit choisi n’existe plus au catalogue.';
    case 'QUOTE_LINE_PRICE_REQUIRED': return 'Indiquez le prix des produits qui n’en ont pas au catalogue.';
    case 'QUOTE_DISCOUNT_ABOVE_AMOUNT': return 'Une remise dépasse le montant auquel elle s’applique.';
    case 'QUOTE_DISCOUNT_INVALID': return 'Une remise est invalide (un pourcentage va de 0 à 100).';
    case 'QUOTE_TOO_MANY_LINES': return 'Un devis compte 100 lignes au plus.';
    case 'QUOTE_SELF_APPROVAL_FORBIDDEN': return 'Vous ne pouvez pas valider une remise que vous avez accordée.';
    case 'QUOTE_APPROVER_NOT_ALLOWED': return 'Seul un responsable de l’agent peut décider de cette remise.';
    case 'QUOTE_REJECTION_REASON_REQUIRED': return 'Indiquez pourquoi la remise est refusée.';
    case 'QUOTE_NOT_PENDING_APPROVAL': return 'Cette remise n’attend plus de décision.';
    case 'QUOTE_CATALOGUE_UNAVAILABLE': return 'Le catalogue est momentanément indisponible. Réessayez.';
    case 'CONFLICT': return 'Les lignes ont été modifiées entre-temps. Rechargez la page.';
    case 'OPPORTUNITY_ALREADY_CLOSED': return 'Ce projet est clos.';
    default:
      return code?.startsWith('QUOTE_LINE_') ? 'Une ligne est invalide : vérifiez la quantité, le prix et la désignation.' : 'Les lignes n’ont pas pu être enregistrées.';
  }
}
