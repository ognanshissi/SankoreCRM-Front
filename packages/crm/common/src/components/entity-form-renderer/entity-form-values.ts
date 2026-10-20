import { EntityFormDto, FormField as EntityFormField, FormFieldTypeEnum, FormSection } from '@sankore/crm-api';

/**
 * La valeur d'un champ telle que le contrat la transporte : ce que la fiche reçoit dans
 * `customFields`, ce qu'un écran envoie à la création. Un montant est `{ amount, currency }`, une
 * date `yyyy-MM-dd`, un choix multiple un tableau, l'absence de valeur `null`.
 */
export type WireValue = string | number | boolean | string[] | { amount: number; currency: string } | null;

export type WireValues = Record<string, WireValue>;

/**
 * Une ligne du modèle du formulaire. Un seul type pour tous les champs, avec un emplacement par
 * nature de contrôle — un texte, une case, une liste, une devise — parce que les signal forms se
 * relient à une propriété dont le type est fixe : un `input` veut une chaîne, une case un booléen.
 * Les nombres restent des chaînes jusqu'à la sortie, comme partout dans le projet.
 */
export interface FieldEntry {
  key: string;
  text: string;
  flag: boolean;
  list: string[];
  currency: string;
}

export const DEFAULT_CURRENCY = 'XOF';

export type RenderMode = 'quick' | 'full';

const NUMBER_TYPES: ReadonlyArray<FormFieldTypeEnum | undefined> = [
  FormFieldTypeEnum.Integer,
  FormFieldTypeEnum.Decimal,
  FormFieldTypeEnum.Percent,
];

// ── Contrat → modèle ────────────────────────────────────────────────────────

export function toEntry(field: EntityFormField, value: WireValue | undefined): FieldEntry {
  const entry: FieldEntry = { key: field.key ?? '', text: '', flag: false, list: [], currency: DEFAULT_CURRENCY };
  // `undefined` : enregistrement neuf, la valeur par défaut s'applique. `null` : une fiche existante
  // qui n'a rien pour ce champ — elle reste vide, la reprendre par défaut serait inventer une saisie.
  const v = value === undefined ? defaultOf(field) : value;
  if (v === null) return entry;

  switch (field.type) {
    case FormFieldTypeEnum.Boolean:
      entry.flag = v === true || v === 'true';
      break;
    case FormFieldTypeEnum.MultiChoice:
      entry.list = Array.isArray(v) ? [...v] : typeof v === 'string' ? [v] : [];
      break;
    case FormFieldTypeEnum.Money:
      if (typeof v === 'object' && !Array.isArray(v)) {
        entry.text = v.amount?.toString() ?? '';
        entry.currency = v.currency || DEFAULT_CURRENCY;
      } else {
        entry.text = String(v);
      }
      break;
    case FormFieldTypeEnum.DateTime:
      entry.text = typeof v === 'string' ? toLocalInput(v) : '';
      break;
    default:
      entry.text = typeof v === 'object' ? '' : String(v);
  }
  return entry;
}

/** La valeur par défaut d'un champ, seulement pour un enregistrement neuf (l'appelant n'en passe pas). */
function defaultOf(field: EntityFormField): WireValue {
  return field.defaultValue ?? null;
}

export function toEntries(form: EntityFormDto, values: WireValues | null | undefined): FieldEntry[] {
  return (form.fields ?? []).map((f) => toEntry(f, values?.[f.key ?? ''] ?? (values ? null : undefined)));
}

// ── Modèle → contrat ────────────────────────────────────────────────────────

export function toWire(field: EntityFormField, entry: FieldEntry): WireValue {
  const text = entry.text.trim();

  switch (field.type) {
    case FormFieldTypeEnum.Boolean:
      return entry.flag;
    case FormFieldTypeEnum.MultiChoice:
      return entry.list.length ? [...entry.list] : null;
    case FormFieldTypeEnum.Money: {
      const amount = parseNumber(text);
      return amount === null ? null : { amount, currency: entry.currency || DEFAULT_CURRENCY };
    }
    case FormFieldTypeEnum.Integer:
    case FormFieldTypeEnum.Decimal:
    case FormFieldTypeEnum.Percent:
      return parseNumber(text);
    case FormFieldTypeEnum.DateTime:
      return text ? new Date(text).toISOString() : null;
    default:
      return text || null;
  }
}

export function parseNumber(text: string): number | null {
  const normalised = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!normalised) return null;
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

/** `datetime-local` veut l'heure locale sans fuseau ; le contrat transporte un instant UTC. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function isEmpty(value: WireValue): boolean {
  return value === null || value === false || (Array.isArray(value) && value.length === 0);
}

/** Égalité au sens du contrat. Une case décochée vaut une absence : « non » n'est pas une saisie. */
export function sameWire(a: WireValue | undefined, b: WireValue | undefined): boolean {
  const left = a === undefined || a === false ? null : a;
  const right = b === undefined || b === false ? null : b;
  return JSON.stringify(left) === JSON.stringify(right);
}

// ── Visibilité ──────────────────────────────────────────────────────────────

/** Ce qu'un champ vaut pour une condition : ses valeurs sous forme de chaînes. */
export function conditionValuesOf(field: EntityFormField | undefined, entry: FieldEntry | undefined): string[] {
  if (!field || !entry) return [];
  if (field.type === FormFieldTypeEnum.Boolean) return [entry.flag ? 'true' : 'false'];
  if (field.type === FormFieldTypeEnum.MultiChoice) return entry.list;
  return entry.text.trim() ? [entry.text.trim()] : [];
}

export interface VisibilityContext {
  fields: Map<string, EntityFormField>;
  entries: Map<string, FieldEntry>;
  sections: Map<string, FormSection>;
}

function holds(condition: EntityFormField['visibleWhen'] | null | undefined, ctx: VisibilityContext): boolean {
  if (!condition?.fieldKey) return true;
  const actual = conditionValuesOf(ctx.fields.get(condition.fieldKey), ctx.entries.get(condition.fieldKey));
  return actual.some((v) => (condition.values ?? []).includes(v));
}

/**
 * La même règle que le serveur (`CustomFieldValues.IsVisible`) : la condition du champ et celle de
 * sa section tiennent toutes les deux. Un champ masqué par sa condition n'est ni affiché, ni exigé.
 */
export function isFieldVisible(field: EntityFormField, ctx: VisibilityContext): boolean {
  if (!holds(field.visibleWhen, ctx)) return false;
  const section = field.sectionKey ? ctx.sections.get(field.sectionKey) : undefined;
  return !section || holds(section.visibleWhen, ctx);
}

/** Proposé dans ce mode, avant toute condition : ni masqué, ni archivé, et en création rapide s'il le faut. */
export function isOffered(field: EntityFormField, mode: RenderMode): boolean {
  return !field.isHidden && !field.isArchived && (mode === 'full' || !!field.quickAdd);
}

// ── Validation ──────────────────────────────────────────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Le premier refus d'un champ, en français, ou null. Reprend les règles du serveur pour qu'un agent
 * ne découvre pas une erreur au moment d'enregistrer ; le serveur reste l'autorité et revérifie.
 */
export function validateEntry(field: EntityFormField, entry: FieldEntry, visible: boolean): string | null {
  if (!visible) return null;

  const wire = toWire(field, entry);
  const text = entry.text.trim();

  if (isEmpty(wire)) {
    if (field.type === FormFieldTypeEnum.Money && text) return 'Montant invalide';
    if (NUMBER_TYPES.includes(field.type) && text) return 'Nombre attendu';
    // Une case obligatoire ne veut rien dire ici : « non » est une réponse.
    return field.isRequired && field.type !== FormFieldTypeEnum.Boolean ? 'Ce champ est obligatoire' : null;
  }

  switch (field.type) {
    case FormFieldTypeEnum.Email:
      if (!EMAIL.test(text)) return 'Adresse e-mail invalide';
      break;
    case FormFieldTypeEnum.Url:
      if (!/^https?:\/\/\S+$/i.test(text)) return 'Lien attendu, commençant par http:// ou https://';
      break;
    case FormFieldTypeEnum.Integer:
      if (!Number.isInteger(wire)) return 'Nombre entier attendu';
      break;
    case FormFieldTypeEnum.Percent:
      if ((wire as number) < 0 || (wire as number) > 100) return 'Entre 0 et 100';
      break;
    case FormFieldTypeEnum.Money:
      if (!/^[A-Z]{3}$/.test(entry.currency)) return 'Devise invalide';
      break;
  }

  const number =
    field.type === FormFieldTypeEnum.Money
      ? (wire as { amount: number }).amount
      : typeof wire === 'number'
        ? wire
        : null;
  if (number !== null) {
    if (field.min != null && number < field.min) return `Au moins ${field.min}`;
    if (field.max != null && number > field.max) return `Au plus ${field.max}`;
  }

  if (typeof wire === 'string') {
    if (field.maxLength != null && wire.length > field.maxLength) return `${field.maxLength} caractères au plus`;
    if (field.pattern) {
      try {
        if (!new RegExp(field.pattern).test(wire)) return 'Format non respecté';
      } catch {
        // Un format que le navigateur ne lit pas est laissé au serveur, qui l'a accepté.
      }
    }
  }

  return null;
}

// ── Ce qui part au serveur ──────────────────────────────────────────────────

/**
 * Les champs personnalisés à envoyer. À la création : toutes les valeurs saisies. En modification :
 * seulement ce qui a changé, `null` pour une valeur effacée — le serveur fusionne, une clé absente
 * est laissée telle quelle, et renvoyer la fiche entière réécrirait des champs que l'agent n'a pas
 * touchés (dont ceux qu'il ne voit pas parce qu'une condition les masque).
 */
export function customPayload(
  form: EntityFormDto,
  current: WireValues,
  initial: WireValues | null,
): Record<string, WireValue> {
  const out: Record<string, WireValue> = {};
  for (const field of form.fields ?? []) {
    if (field.isNative || field.isArchived || !field.key) continue;
    const now = current[field.key] ?? null;
    if (initial === null) {
      if (!isEmpty(now)) out[field.key] = now;
    } else if (!sameWire(now, initial[field.key])) {
      out[field.key] = isEmpty(now) ? null : now;
    }
  }
  return out;
}

// ── Étapes d'un assistant ───────────────────────────────────────────────────

export interface FormStep {
  /** La clé de la section, `''` pour les champs hors section. */
  key: string;
  label: string;
  /** Les champs de l'étape, à exclure du rendu des autres étapes. */
  fieldKeys: string[];
}

/**
 * Une étape par section qui propose au moins un champ dans ce mode, dans l'ordre de la mise en
 * page — ce qu'un assistant de création affiche, la mise en page du tenant décidant ainsi de ses
 * étapes. Les conditions sont évaluées sur `context` seul (le type de client, choisi avant
 * l'assistant) : une section qui ne vaut que pour l'autre type ne devient pas une étape vide.
 */
export function formSteps(
  form: EntityFormDto,
  mode: RenderMode,
  context: WireValues,
  excluded: ReadonlyArray<string> = [],
): FormStep[] {
  const fields = (form.fields ?? []).filter(
    (f) => isOffered(f, mode) && !excluded.includes(f.key ?? ''),
  );
  const entries = toEntries(form, context);
  const ctx: VisibilityContext = {
    fields: new Map((form.fields ?? []).map((f) => [f.key ?? '', f] as const)),
    entries: new Map(entries.map((e) => [e.key, e] as const)),
    sections: new Map((form.sections ?? []).map((s) => [s.key ?? '', s] as const)),
  };
  // Seules les conditions sur le contexte tranchent ici ; une condition sur un champ saisi plus
  // loin ne doit pas faire disparaître une étape avant qu'on y arrive.
  const contextKeys = new Set(Object.keys(context));
  const visibleByContext = (f: EntityFormField) => {
    const own = f.visibleWhen?.fieldKey;
    const section = f.sectionKey ? ctx.sections.get(f.sectionKey) : undefined;
    const sectionCond = section?.visibleWhen?.fieldKey;
    const decidable = (!own || contextKeys.has(own)) && (!sectionCond || contextKeys.has(sectionCond));
    return decidable ? isFieldVisible(f, ctx) : true;
  };

  const sections = [...(form.sections ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const known = new Set(sections.map((s) => s.key ?? ''));
  const steps: FormStep[] = [];

  const loose = fields.filter((f) => (!f.sectionKey || !known.has(f.sectionKey)) && visibleByContext(f));
  if (loose.length) steps.push({ key: '', label: 'Général', fieldKeys: loose.map((f) => f.key ?? '') });

  for (const section of sections) {
    const own = fields.filter((f) => f.sectionKey === section.key && visibleByContext(f));
    if (own.length) {
      steps.push({ key: section.key ?? '', label: section.title ?? section.key ?? '', fieldKeys: own.map((f) => f.key ?? '') });
    }
  }
  return steps;
}
