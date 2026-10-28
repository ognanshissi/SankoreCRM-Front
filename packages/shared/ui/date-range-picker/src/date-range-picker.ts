import {
  afterNextRender,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  forwardRef,
  inject,
  Injector,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, NG_VALIDATORS, NG_VALUE_ACCESSOR, ValidationErrors } from '@angular/forms';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { BreakpointObserver } from '@angular/cdk/layout';
import { map } from 'rxjs';
import { AbstractControlValueAccessor } from '@talisoft/ui/core';
import { TasError, TasFormField, TasLabel, TasSuffix } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import {
  addDays,
  addMonths,
  DateRangePreset,
  DateRangeValue,
  DEFAULT_DATE_RANGE_PRESETS,
  formatDay,
  formatRange,
  fromIso,
  maskRange,
  monthGrid,
  MonthCell,
  parseRange,
  presetRange,
  RANGE_SEPARATOR,
  toIso,
  TypedRangeProblem,
} from './date-range.utils';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const WEEK_DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DAY_LABEL = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

interface ViewMonth {
  key: string;
  label: string;
  cells: MonthCell[];
}

/**
 * Une période, du JJ/MM/AAAA au JJ/MM/AAAA : raccourcis à gauche (Aujourd'hui, 7 derniers jours,
 * Mois dernier…), deux mois côte à côte (un seul sur téléphone), et la saisie au clavier dans le
 * champ — « 0110202627102026 » devient « 01/10/2026 – 27/10/2026 ».
 *
 * Valeur : `{ start, end }` en jours ISO, comme le mode `daterange` de `tas-date-picker`, ou `null`.
 * Une valeur n'est émise que complète : une période à moitié choisie n'est pas un filtre.
 *
 * Le calendrier ne vole pas le focus du champ : on peut taper pendant qu'il est ouvert, et il suit
 * ce qu'on tape. Flèche bas (ou Alt+Flèche bas) entre dans la grille, où les flèches, Page
 * précédente/suivante et Début/Fin se déplacent ; Échap referme et rend la main au champ.
 */
@Component({
  selector: 'tas-date-range-picker',
  templateUrl: './date-range-picker.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasFormField, TasLabel, TasError, TasSuffix, TasIcon, TasInput, CdkOverlayOrigin, CdkConnectedOverlay],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => TasDateRangePicker), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => TasDateRangePicker), multi: true },
  ],
})
export class TasDateRangePicker extends AbstractControlValueAccessor<DateRangeValue | null> {
  private readonly _injector = inject(Injector);
  // `read` : sans lui, `#field` désigne le composant TasInput posé sur l'élément, pas l'élément.
  private readonly _input = viewChild('field', { read: ElementRef<HTMLInputElement> });
  private readonly _popup = viewChild<ElementRef<HTMLElement>>('popup');

  /** Premier jour possible, ISO. */
  readonly min = input<string | null | undefined>(null);
  /** Dernier jour possible, ISO — par exemple aujourd'hui pour un journal : l'avenir est grisé. */
  readonly max = input<string | null | undefined>(null);
  /** Les raccourcis ; `[]` les masque. */
  readonly presets = input<DateRangePreset[]>(DEFAULT_DATE_RANGE_PRESETS);
  readonly placeholder = input('JJ/MM/AAAA – JJ/MM/AAAA');
  readonly labelScreenOnly = input(false, { transform: booleanAttribute });

  readonly isOpen = signal(false);
  readonly weekDays = WEEK_DAYS;

  /** Deux mois à partir de 640 px ; un seul en dessous, raccourcis au-dessus. */
  readonly narrow = toSignal(
    inject(BreakpointObserver).observe('(max-width: 639px)').pipe(map((s) => s.matches)),
    { initialValue: false },
  );

  readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 },
  ];

  // ── State ───────────────────────────────────────────────────────────────────

  private readonly _current = signal<DateRangeValue | null>(null);
  /** Ce que montre le champ : la frappe de l'agent tant qu'il tape, la valeur sinon. */
  readonly text = signal('');
  private readonly _blurred = signal(false);

  /** Le premier jour cliqué, en attendant le second. */
  readonly pendingStart = signal<string | null>(null);
  readonly hovered = signal<string | null>(null);
  /** Le jour qui a le focus clavier dans la grille. */
  readonly focused = signal<string>(toIso(today()));

  /** Le mois affiché à gauche. */
  readonly viewYear = signal(today().getFullYear());
  readonly viewMonth = signal(today().getMonth());

  // ── Derived ─────────────────────────────────────────────────────────────────

  readonly hasValue = computed(() => !!this._current() || !!this.text());

  readonly months = computed<ViewMonth[]>(() => {
    const count = this.narrow() ? 1 : 2;
    return Array.from({ length: count }, (_, i) => {
      const { year, month } = addMonths(this.viewYear(), this.viewMonth(), i);
      return { key: `${year}-${month}`, label: `${MONTHS[month]} ${year}`, cells: monthGrid(year, month) };
    });
  });

  readonly canGoBack = computed(() => {
    const min = this.min();
    return !min || toIso(new Date(this.viewYear(), this.viewMonth(), 1)) > min;
  });

  readonly canGoForward = computed(() => {
    const max = this.max();
    const last = this.months().length - 1;
    const { year, month } = addMonths(this.viewYear(), this.viewMonth(), last);
    return !max || toIso(new Date(year, month + 1, 0)) < max;
  });

  /** La période dessinée : celle qu'on est en train de choisir (avec le survol), sinon la valeur. */
  readonly shown = computed<{ start: string | null; end: string | null }>(() => {
    const pending = this.pendingStart();
    if (pending) {
      const other = this.hovered() ?? pending;
      return pending <= other ? { start: pending, end: other } : { start: other, end: pending };
    }
    const v = this._current();
    return { start: v?.start ?? null, end: v?.end ?? null };
  });

  readonly presetItems = computed(() => {
    const now = today();
    const value = this._current();
    return this.presets().map((preset) => {
      const range = presetRange(preset, now, this.min(), this.max());
      return {
        label: preset.label,
        range,
        active: !!range && !!value && range.start === value.start && range.end === value.end,
      };
    });
  });

  readonly hint = computed(() =>
    this.pendingStart() ? `Du ${formatDay(this.pendingStart())} — choisissez le dernier jour` : 'Choisissez le premier jour',
  );

  readonly todayIso = computed(() => toIso(today()));

  private readonly _problem = computed<TypedRangeProblem | null>(() => {
    const text = this.text();
    if (!text) return null;
    const parsed = parseRange(text, this.min(), this.max());
    return 'problem' in parsed ? parsed.problem : null;
  });

  readonly showInvalid = computed(() => this._blurred() && !this.isOpen() && this._problem() !== null);

  readonly invalidMessage = computed(() => {
    switch (this._problem()) {
      case 'min': return `Période trop ancienne — au plus tôt le ${formatDay(this.min())}.`;
      case 'max': return `Période trop lointaine — au plus tard le ${formatDay(this.max())}.`;
      default: return `Période attendue au format JJ/MM/AAAA${RANGE_SEPARATOR}JJ/MM/AAAA.`;
    }
  });

  // ── ControlValueAccessor ────────────────────────────────────────────────────

  // Ne renotifie jamais : `writeValue` vient du formulaire, le lui renvoyer reboucle sur `onChange`.
  override writeValue(obj: DateRangeValue | null | undefined): void {
    const value = obj?.start && obj.end ? { start: obj.start, end: obj.end } : null;
    this._value = value;
    this._current.set(value);
    this.text.set(formatRange(value));
    this._blurred.set(false);
    this.pendingStart.set(null);
  }

  override validate(_control: AbstractControl): ValidationErrors | null {
    const problem = this._problem();
    return problem ? { dateRangeInvalid: { reason: problem, min: this.min() ?? null, max: this.max() ?? null } } : null;
  }

  // ── Field ───────────────────────────────────────────────────────────────────

  onType(event: Event): void {
    const field = event.target as HTMLInputElement;
    const masked = maskRange(field.value);
    // Réécrit aussitôt : une lettre ou un chiffre de trop disparaît à la frappe.
    field.value = masked;
    this.text.set(masked);
    this._blurred.set(false);
    this.pendingStart.set(null);

    const parsed = parseRange(masked, this.min(), this.max());
    if ('value' in parsed) {
      this._showMonthOf(parsed.value.start!);
      this.focused.set(parsed.value.start!);
      this._emit(parsed.value, false);
    } else if (this._current()) {
      // Incomplète ou impossible : le champ ne porte plus de période — jamais l'ancienne.
      this._emit(null, false);
    }
  }

  onBlur(): void {
    this._blurred.set(true);
    this.onTouched();
  }

  open(): void {
    if (this.disabled() || this.isOpen()) return;
    const v = this._current();
    this._showMonthOf(v?.start ?? this._defaultAnchor());
    this.focused.set(v?.start ?? this._clamp(this.todayIso()));
    this.isOpen.set(true);
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  close(returnFocus = false): void {
    if (!this.isOpen()) return;
    this.isOpen.set(false);
    this.pendingStart.set(null);
    this.hovered.set(null);
    this._refocus = returnFocus;
  }

  /**
   * Le calendrier est vraiment retiré du DOM : c'est seulement maintenant qu'on rend le focus au
   * champ. Rendu plus tôt, il était perdu avec le jour cliqué, retiré juste après, et le clavier se
   * retrouvait sur la page.
   */
  onDetached(): void {
    this.close();
    if (!this._refocus) return;
    this._refocus = false;
    this._input()?.nativeElement.focus();
  }

  private _refocus = false;

  /** Un clic hors du calendrier le ferme — sauf sur le champ, où l'on continue de taper. */
  onOutsideClick(event: MouseEvent): void {
    const target = event.target as Node | null;
    const field = this._input()?.nativeElement;
    if (field && target && (field === target || field.parentElement?.contains(target))) return;
    this.close();
  }

  clear(): void {
    this.text.set('');
    this.pendingStart.set(null);
    this._emit(null);
    this._input()?.nativeElement.focus();
  }

  /** Flèche bas depuis le champ : le focus entre dans la grille. */
  enterGrid(event: Event): void {
    event.preventDefault();
    this.open();
    // Là où en est la période : celle qu'on vient de taper ou de choisir, sinon aujourd'hui.
    this._focusDay(this.pendingStart() ?? this._current()?.start ?? this.focused());
  }

  // ── Calendar ────────────────────────────────────────────────────────────────

  isDisabled(iso: string): boolean {
    const min = this.min();
    const max = this.max();
    return (!!min && iso < min) || (!!max && iso > max);
  }

  isEdge(iso: string): boolean {
    const { start, end } = this.shown();
    return iso === start || iso === end;
  }

  inRange(iso: string): boolean {
    const { start, end } = this.shown();
    return !!start && !!end && iso > start && iso < end;
  }

  /** Le bandeau continu : il part du milieu du premier jour et s'arrête au milieu du dernier. */
  band(iso: string): 'none' | 'full' | 'start' | 'end' {
    const { start, end } = this.shown();
    if (!start || !end || start === end) return 'none';
    if (iso === start) return 'start';
    if (iso === end) return 'end';
    return iso > start && iso < end ? 'full' : 'none';
  }

  dayClass(iso: string): string {
    if (this.isEdge(iso)) return 'bg-primary font-semibold text-white';
    if (this.isDisabled(iso)) return 'cursor-not-allowed text-slate-300';
    const today = iso === this.todayIso() ? 'border border-slate-700 font-semibold ' : '';
    return today + (this.inRange(iso) ? 'text-slate-900 hover:bg-primary/20' : 'text-slate-800 hover:bg-slate-100');
  }

  dayLabel(iso: string): string {
    return DAY_LABEL.format(fromIso(iso)!);
  }

  select(iso: string): void {
    if (this.isDisabled(iso)) return;
    this.focused.set(iso);

    const start = this.pendingStart();
    if (!start) {
      this.pendingStart.set(iso);
      return;
    }

    const value = start <= iso ? { start, end: iso } : { start: iso, end: start };
    this.pendingStart.set(null);
    this.hovered.set(null);
    this.text.set(formatRange(value));
    this._emit(value);
    this.close(true);
  }

  applyPreset(range: DateRangeValue | null): void {
    if (!range) return;
    this.pendingStart.set(null);
    this.text.set(formatRange(range));
    this._emit(range);
    this.close(true);
  }

  previous(): void {
    if (!this.canGoBack()) return;
    this._moveView(-1);
  }

  next(): void {
    if (!this.canGoForward()) return;
    this._moveView(1);
  }

  onGridKey(event: KeyboardEvent, iso: string): void {
    const d = fromIso(iso)!;
    let target: Date | null = null;

    switch (event.key) {
      case 'ArrowLeft': target = addDays(d, -1); break;
      case 'ArrowRight': target = addDays(d, 1); break;
      case 'ArrowUp': target = addDays(d, -7); break;
      case 'ArrowDown': target = addDays(d, 7); break;
      case 'Home': target = addDays(d, -((d.getDay() + 6) % 7)); break;
      case 'End': target = addDays(d, 6 - ((d.getDay() + 6) % 7)); break;
      case 'PageUp': target = new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), 28)); break;
      case 'PageDown': target = new Date(d.getFullYear(), d.getMonth() + 1, Math.min(d.getDate(), 28)); break;
      default: return;
    }

    event.preventDefault();
    const next = this._clamp(toIso(target));
    if (this.pendingStart()) this.hovered.set(next);
    this._focusDay(next);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /** Rend `iso` visible (en changeant de mois au besoin), puis lui donne le focus. */
  private _focusDay(iso: string): void {
    this.focused.set(iso);
    const d = fromIso(iso)!;
    const first = new Date(this.viewYear(), this.viewMonth(), 1);
    const lastShown = addMonths(this.viewYear(), this.viewMonth(), this.months().length - 1);
    const last = new Date(lastShown.year, lastShown.month + 1, 0);
    if (d < first) this._setView(d.getFullYear(), d.getMonth());
    else if (d > last) {
      const left = addMonths(d.getFullYear(), d.getMonth(), -(this.months().length - 1));
      this._setView(left.year, left.month);
    }

    afterNextRender(
      () => this._popup()?.nativeElement.querySelector<HTMLButtonElement>(`button[data-iso="${iso}"]`)?.focus(),
      { injector: this._injector },
    );
  }

  /** Le mois de gauche, pour que `iso` soit visible ; avec `max` dans ce mois, il passe à droite. */
  private _showMonthOf(iso: string): void {
    const d = fromIso(iso) ?? today();
    let left = { year: d.getFullYear(), month: d.getMonth() };
    const max = fromIso(this.max());
    if (!this.narrow() && max && max.getFullYear() === d.getFullYear() && max.getMonth() === d.getMonth()) {
      left = addMonths(left.year, left.month, -1);
    }
    this._setView(left.year, left.month);
  }

  private _defaultAnchor(): string {
    return this._clamp(this.todayIso());
  }

  private _moveView(delta: number): void {
    const { year, month } = addMonths(this.viewYear(), this.viewMonth(), delta);
    this._setView(year, month);
  }

  private _setView(year: number, month: number): void {
    this.viewYear.set(year);
    this.viewMonth.set(month);
  }

  private _clamp(iso: string): string {
    const min = this.min();
    const max = this.max();
    if (min && iso < min) return min;
    if (max && iso > max) return max;
    return iso;
  }

  /** @param syncText false pendant la frappe : le champ montre ce que l'agent tape, pas un reformatage. */
  private _emit(value: DateRangeValue | null, syncText = true): void {
    this._value = value;
    this._current.set(value);
    if (syncText) {
      this.text.set(formatRange(value));
      this._blurred.set(false);
    }
    this.onTouched();
    this.onChange(value);
  }
}

function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
