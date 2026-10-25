import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  effect,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { applyEach, FieldTree, form, FormField, validate } from '@angular/forms/signals';
import { combineLatest, map, of, switchMap } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  EntityFormDto,
  FormField as EntityFormField,
  FormFieldReferenceTargetEnum,
  FormFieldTypeEnum,
  FormSection,
} from '@sankore/crm-api';
import { TasCard } from '@talisoft/ui/card';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { TasError, TasFormField, TasHint, TasLabel, TasSuffix } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { EntityFormFieldTemplate } from './entity-form-field-template.directive';
import { EntityFormReferences, ReferenceOption } from './entity-form-references.service';
import { currencyUnit } from '../../models/institution-currency';
import {
  customPayload,
  FieldEntry,
  isEmpty,
  isFieldVisible,
  isOffered,
  RenderMode,
  toEntries,
  toEntry,
  toWire,
  validateEntry,
  VisibilityContext,
  WireValue,
  WireValues,
} from './entity-form-values';

interface RenderedGroup {
  key: string;
  title: string | null;
  description: string | null;
  fields: EntityFormField[];
}

/**
 * Le rendu d'un formulaire dynamique — lead, client ou produit — à partir de la mise en page du
 * tenant (`GET forms/{entity}`), en signal forms (formulaires dynamiques, lot 3).
 *
 * <p><b>Ce qu'il fait</b> : placer chaque champ dans sa section, n'afficher en création rapide que
 * ce qui y est coché, appliquer les conditions « visible si » au fil de la saisie, valider avec les
 * règles du serveur, et rendre les valeurs au format du contrat.</p>
 *
 * <p><b>Ce qu'il ne fait pas</b> : appeler le serveur. L'écran hôte lit {@link wireValues} pour ses
 * champs natifs, {@link customFieldsPayload} pour `customFields`, et soumet lui-même — il connaît
 * son endpoint, ses doublons et ses messages. Le moteur précédent (`dynamic-form-renderer`, pour les
 * questionnaires) est en Reactive Forms et reste en place pour eux.</p>
 *
 * <p><b>`values` doit être stable</b> (un signal, pas un littéral recréé à chaque détection) : un
 * nouvel objet réinitialise la saisie. Null signifie « enregistrement neuf » — les valeurs par
 * défaut s'appliquent et {@link customFieldsPayload} envoie tout ce qui est saisi ; un objet signifie
 * « fiche existante » et le payload ne contient que ce qui a changé.</p>
 */
@Component({
  selector: 'entity-form-renderer',
  templateUrl: './entity-form-renderer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSuffix,
    TasDatePicker,
    NgTemplateOutlet,
    FormField,
    TasCard,
    TasCheckbox,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
  ],
})
export class EntityFormRenderer {
  private readonly _references = inject(EntityFormReferences);

  public readonly form = input.required<EntityFormDto>();
  public readonly mode = input<RenderMode>('full');
  public readonly values = input<WireValues | null>(null);
  /**
   * Une saisie de départ pour un enregistrement NEUF — ce qu'une recherche infructueuse transmet à
   * la création. Contrairement à `values`, elle laisse s'appliquer les valeurs par défaut des autres
   * champs et n'en fait pas une fiche existante : `customFieldsPayload` envoie tout ce qui est saisi.
   */
  public readonly prefill = input<WireValues | null>(null);
  /** En lecture seule, masquer les champs sensibles — non pour un récapitulatif de ce qu'on vient de taper. */
  public readonly maskSensitive = input(true, { transform: booleanAttribute });
  public readonly readonly = input(false, { transform: booleanAttribute });
  public readonly appearance = input<'plain' | 'cards'>('plain');
  public readonly columns = input<1 | 2>(2);
  /** Clés à ne pas rendre ici, parce que l'écran hôte les affiche ailleurs. */
  public readonly exclude = input<string[]>([]);
  /**
   * Quels champs rendre : tous, ou seulement les personnalisés — ce qu'une fiche affiche à côté de
   * ses propres blocs, qui montrent déjà les champs natifs. Les conditions continuent de lire les
   * champs natifs passés dans `values` (le type de prospect, par exemple).
   */
  public readonly scope = input<'all' | 'custom'>('all');
  /**
   * Les champs dont le serveur a retenu la valeur (un champ sensible d'un client). En lecture, ils
   * s'affichent masqués avec « Afficher » quand `revealable` ; en saisie, vides, et rien n'est envoyé
   * tant qu'on n'y écrit pas — laisser le champ vide ne l'efface pas.
   */
  public readonly maskedKeys = input<string[]>([]);
  public readonly revealable = input(false, { transform: booleanAttribute });
  /** En lecture seule, ce qu'affiche un champ vide — « À demander » plutôt que « — ». */
  public readonly emptyLabel = input<string | null>(null);

  public readonly valuesChange = output<WireValues>();
  /** La clé d'un champ masqué dont l'utilisateur demande la valeur ; l'hôte appelle le serveur. */
  public readonly reveal = output<string>();

  private readonly _templates = contentChildren(EntityFormFieldTemplate);

  public readonly Type = FormFieldTypeEnum;
  public readonly currencyUnit = currencyUnit;

  // ── Modèle ──────────────────────────────────────────────────────────

  /**
   * Repart de la mise en page et des valeurs dès que l'une change — c'est le contrat de `values`
   * (voir la classe), et ce qui permet à l'hôte de recharger une fiche après un enregistrement.
   * Synchrone : le gabarit ne voit jamais une mise en page dont les lignes n'existent pas encore.
   */
  public readonly model = linkedSignal<{ entries: FieldEntry[] }>(() => {
    const form = this.form();
    const values = this.values();
    const prefill = this.prefill();
    if (values || !prefill) return { entries: toEntries(form, values) };
    return {
      entries: (form.fields ?? []).map((f) => {
        const key = f.key ?? '';
        return toEntry(f, key in prefill ? prefill[key] : undefined);
      }),
    };
  });

  /** Ce que la fiche contenait au chargement — la référence du « ce qui a changé ». */
  private readonly _initial = computed<WireValues | null>(() => {
    const values = this.values();
    if (!values) return null;
    const fields = this.form().fields ?? [];
    const entries = toEntries(this.form(), values);
    const out: WireValues = {};
    fields.forEach((f, i) => (out[f.key ?? ''] = toWire(f, entries[i])));
    return out;
  });

  public readonly formSchema = form(this.model, (schema) => {
    applyEach(schema.entries, (entry) => {
      validate(entry, (ctx) => {
        const e = ctx.value();
        const field = this._fieldsByKey().get(e.key);
        if (!field || !this._isRendered(field)) return null;
        // Une valeur masquée existe au serveur : vide à l'écran, elle n'est pas manquante.
        if (this.maskedKeys().includes(e.key) && isEmpty(toWire(field, e))) return null;
        const message = validateEntry(field, e, this.isVisible(e.key));
        return message ? { kind: 'entityField', message } : null;
      });
    });
  });

  private readonly _fieldsByKey = computed(
    () => new Map((this.form().fields ?? []).map((f) => [f.key ?? '', f] as const)),
  );

  private readonly _indexByKey = computed(
    () => new Map(this.model().entries.map((e, i) => [e.key, i] as const)),
  );

  private readonly _visibility = computed<VisibilityContext>(() => ({
    fields: this._fieldsByKey(),
    entries: new Map(this.model().entries.map((e) => [e.key, e] as const)),
    sections: new Map((this.form().sections ?? []).map((s) => [s.key ?? '', s] as const)),
  }));

  /** Toutes les valeurs, au format du contrat, champs natifs compris. */
  public readonly wireValues = computed<WireValues>(() => {
    const fields = this._fieldsByKey();
    const out: WireValues = {};
    for (const e of this.model().entries) {
      const field = fields.get(e.key);
      if (field) out[e.key] = toWire(field, e);
    }
    return out;
  });

  /** `customFields` à envoyer : tout à la création, le seul changement en modification. */
  public readonly customFieldsPayload = computed(() =>
    customPayload(this.form(), this.wireValues(), this._initial()),
  );

  /** Vrai quand aucun champ affiché n'est en erreur. Les champs masqués ne comptent pas. */
  public readonly valid = computed(() => this.formSchema().valid());

  // ── Ce qui s'affiche ────────────────────────────────────────────────

  public readonly groups = computed<RenderedGroup[]>(() => {
    const form = this.form();
    const quick = this.mode() === 'quick';
    const ctx = this._visibility();
    const fields = (form.fields ?? []).filter((f) => this._isRendered(f) && isFieldVisible(f, ctx));

    const byOrder = (a: { order?: number }, b: { order?: number }) => (a.order ?? 0) - (b.order ?? 0);
    const sections = [...(form.sections ?? [])].sort(byOrder);

    const groups: RenderedGroup[] = [
      { key: '', title: null, description: null, fields: fields.filter((f) => !f.sectionKey || !sections.some((s) => s.key === f.sectionKey)).sort(byOrder) },
      ...sections.map((s: FormSection) => {
        // En création rapide, le titre d'une section ne s'affiche que si elle le demande ; ses
        // champs cochés apparaissent de toute façon.
        const titled = !quick || !!s.quickAdd;
        return {
          key: s.key ?? '',
          title: titled ? s.title ?? null : null,
          description: titled ? s.description ?? null : null,
          fields: fields.filter((f) => f.sectionKey === s.key).sort(byOrder),
        };
      }),
    ];
    return groups.filter((g) => g.fields.length > 0);
  });

  // ── Listes des champs « Référence » ─────────────────────────────────

  private readonly _referenceOptions = toSignal(
    toObservable(computed(() => this._referenceTargets())).pipe(
      switchMap((targets) =>
        targets.length === 0
          ? of(new Map<string, ReferenceOption[]>())
          : combineLatest(targets.map((t) => this._references.options(t).pipe(map((o) => [t, o] as const)))).pipe(
              map((pairs) => new Map<string, ReferenceOption[]>(pairs)),
            ),
      ),
    ),
    { initialValue: new Map<string, ReferenceOption[]>() },
  );

  private readonly _referenceTargets = computed(() => [
    ...new Set(
      (this.form().fields ?? [])
        .filter((f) => f.type === FormFieldTypeEnum.Reference && f.referenceTarget && this._isRendered(f))
        .map((f) => f.referenceTarget as FormFieldReferenceTargetEnum),
    ),
  ]);

  constructor() {
    effect(() => this.valuesChange.emit(this.wireValues()));
  }

  // ── Pour le gabarit et pour l'hôte ──────────────────────────────────

  public entry(key: string): FieldTree<FieldEntry> {
    return this.formSchema.entries[this._indexByKey().get(key) ?? 0];
  }

  public isVisible(key: string): boolean {
    const field = this._fieldsByKey().get(key);
    return !!field && isFieldVisible(field, this._visibility());
  }

  public errorOf(key: string): string | null {
    const state = this.entry(key)();
    if (!state.touched()) return null;
    return state.errors()[0]?.message ?? null;
  }

  public templateFor(key: string) {
    return this._templates().find((t) => t.key() === key)?.template ?? null;
  }

  public optionsOf(field: EntityFormField): ReferenceOption[] {
    if (field.type === FormFieldTypeEnum.Reference) {
      return this._referenceOptions().get(field.referenceTarget ?? '') ?? [];
    }
    return (field.options ?? []).map((o) => ({ value: o.value ?? '', label: o.label ?? o.value ?? '' }));
  }

  public toggleChoice(key: string, value: string, checked: boolean): void {
    this.entry(key).list().value.update((list) =>
      checked ? (list.includes(value) ? list : [...list, value]) : list.filter((v) => v !== value),
    );
    this.entry(key)().markAsTouched();
  }

  public isWide(field: EntityFormField): boolean {
    return (
      this.columns() === 1 ||
      field.type === FormFieldTypeEnum.LongText ||
      field.type === FormFieldTypeEnum.MultiChoice
    );
  }

  /** Affiche les erreurs de tous les champs, comme le fait `submit()` d'un formulaire hôte. */
  public markAllAsTouched(): void {
    this.formSchema().markAsTouched();
  }

  /** Affiche les erreurs de ces champs seulement — l'étape en cours d'un assistant. */
  public markTouched(keys: ReadonlyArray<string>): void {
    for (const key of keys) {
      const index = this._indexByKey().get(key);
      if (index !== undefined) this.formSchema.entries[index]().markAsTouched();
    }
  }

  /** Les champs rendus qui sont en erreur, dans l'ordre de la mise en page. */
  public readonly invalidKeys = computed(() =>
    this.model().entries
      .map((e, i) => (this.formSchema.entries[i]().invalid() ? e.key : null))
      .filter((k): k is string => k !== null),
  );

  /** La valeur lisible d'un champ, pour le mode lecture seule. */
  /** Vrai quand le champ n'a pas de valeur — son libellé vide est alors mis en avant. */
  public isBlank(field: EntityFormField): boolean {
    return !this.isMasked(field) && field.type !== FormFieldTypeEnum.Boolean
      && isEmpty(this.wireValues()[field.key ?? ''] ?? null);
  }

  public isMasked(field: EntityFormField): boolean {
    return this.maskedKeys().includes(field.key ?? '');
  }

  public placeholderOf(field: EntityFormField, fallback = ''): string {
    return this.isMasked(field) ? 'Valeur masquée — saisissez pour la remplacer' : field.placeholder ?? fallback;
  }

  public display(field: EntityFormField): string {
    if (this.isMasked(field)) return '••••••';
    const value: WireValue = this.wireValues()[field.key ?? ''] ?? null;
    if (isEmpty(value)) return field.type === FormFieldTypeEnum.Boolean ? 'Non' : this.emptyLabel() ?? '—';
    if (field.isSensitive && this.maskSensitive()) return '••••••';

    const label = (v: string) => this.optionsOf(field).find((o) => o.value === v)?.label ?? v;
    switch (field.type) {
      case FormFieldTypeEnum.Boolean:
        return 'Oui';
      case FormFieldTypeEnum.MultiChoice:
        return (value as string[]).map(label).join(', ');
      case FormFieldTypeEnum.SingleChoice:
      case FormFieldTypeEnum.Reference:
        return label(value as string);
      case FormFieldTypeEnum.Money: {
        const m = value as { amount: number; currency: string };
        return `${m.amount.toLocaleString('fr-FR')} ${currencyUnit(m.currency)}`;
      }
      case FormFieldTypeEnum.Percent:
        return `${(value as number).toLocaleString('fr-FR')} %`;
      case FormFieldTypeEnum.Integer:
      case FormFieldTypeEnum.Decimal:
        return (value as number).toLocaleString('fr-FR');
      case FormFieldTypeEnum.Date:
        return new Date(`${value}T00:00:00`).toLocaleDateString('fr-FR');
      case FormFieldTypeEnum.DateTime:
        return new Date(value as string).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      default:
        return String(value);
    }
  }

  private _isRendered(field: EntityFormField): boolean {
    return (
      isOffered(field, this.mode()) &&
      (this.scope() === 'all' || !field.isNative) &&
      !this.exclude().includes(field.key ?? '')
    );
  }
}
