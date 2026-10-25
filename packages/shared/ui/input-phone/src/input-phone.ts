import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControlValueAccessor } from '@talisoft/ui/core';
import {
  AbstractControl,
  FormControl,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms';
import { fromEvent } from 'rxjs';
import { COUNTRIES, CountryDef } from './countries';

@Component({
  selector: 'tas-input-phone, InputPhone',
  template: `
    <div class="tas-phone-input">
      <button
        type="button"
        class="tas-phone-input__country"
        (click)="toggleDropdown(); $event.stopPropagation()"
        [attr.aria-expanded]="dropdownOpen()"
        aria-haspopup="listbox"
      >
        <span class="tas-phone-input__flag">{{ selectedCountry().flag }}</span>
        <span class="tas-phone-input__dial">{{ selectedCountry().dial }}</span>
        <svg
          class="tas-phone-input__chevron"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      @if (dropdownOpen()) {
        <!--
          Barrage de propagation uniquement : le listener document:click ferme la liste,
          et sans ce stopPropagation un clic dans la liste la refermerait avant que
          selectCountry ne soit traité. Pas de backtick ici : le template est inline.
        -->
        <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
        <div
          class="tas-phone-input__dropdown"
          role="listbox"
          (click)="$event.stopPropagation()"
        >
          <input
            type="text"
            class="tas-phone-input__search"
            placeholder="Rechercher un pays..."
            [value]="searchQuery()"
            (input)="searchQuery.set($any($event.target).value)"
          />
          <ul class="tas-phone-input__list">
            @for (country of filteredCountries(); track country.code) {
              <li
                role="option"
                class="tas-phone-input__option"
                tabindex="0"
                [class.tas-phone-input__option--selected]="
                  country.code === selectedCountry().code
                "
                [attr.aria-selected]="country.code === selectedCountry().code"
                (click)="selectCountry(country)"
                (keydown.enter)="selectCountry(country)"
                (keydown.space)="selectCountry(country); $event.preventDefault()"
              >
                <span class="tas-phone-input__flag">{{ country.flag }}</span>
                <span class="tas-phone-input__option-name">{{ country.name }}</span>
                <span class="tas-phone-input__option-dial">{{ country.dial }}</span>
              </li>
            }
            @if (filteredCountries().length === 0) {
              <li class="tas-phone-input__empty">Aucun résultat</li>
            }
          </ul>
        </div>
      }

      <input
        type="tel"
        inputmode="numeric"
        autocomplete="tel-national"
        class="tas-phone-input__number"
        [placeholder]="selectedCountry().placeholder"
        [formControl]="phoneControl"
      />
    </div>
  `,
  styleUrl: './input-phone.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: TasInputPhone,
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: TasInputPhone,
      multi: true,
    },
  ],
})
export class TasInputPhone extends AbstractControlValueAccessor<string> {
  private readonly _destroyRef = inject(DestroyRef);

  public defaultCountry = input<string>('CI');

  public phoneControl = new FormControl('');
  public selectedCountry = signal<CountryDef>(COUNTRIES[0]);
  public dropdownOpen = signal(false);
  public searchQuery = signal('');

  public filteredCountries = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dial.includes(q) ||
        c.code.toLowerCase().includes(q),
    );
  });

  constructor() {
    super();

    const initial = COUNTRIES.find((c) => c.code === this.defaultCountry()) ?? COUNTRIES[0];
    this.selectedCountry.set(initial);

    this.phoneControl.valueChanges
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((value) => {
        // Une lettre, un tiret, une parenthèse disparaissent au moment où ils sont tapés ou collés :
        // un numéro n'en contient pas, et laisser le validateur les refuser après coup obligeait
        // l'agent à chercher ce qui n'allait pas.
        const clean = this._digitsOnly(value ?? '');
        if (clean !== (value ?? '')) this.phoneControl.setValue(clean, { emitEvent: false });
        this._emitValue();
      });

    fromEvent(document, 'click')
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe(() => {
        if (this.dropdownOpen()) {
          this.dropdownOpen.set(false);
        }
      });
  }

  public toggleDropdown(): void {
    this.dropdownOpen.update((v) => !v);
    if (this.dropdownOpen()) {
      this.searchQuery.set('');
    }
  }

  public selectCountry(country: CountryDef): void {
    this.selectedCountry.set(country);
    this.dropdownOpen.set(false);
    this._emitValue();
  }

  override writeValue(obj: string) {
    if (!obj) {
      this.phoneControl.patchValue('', { emitEvent: false });
      return;
    }
    const match = COUNTRIES.find((c) => obj.startsWith(c.dial));
    if (match) {
      this.selectedCountry.set(match);
      this.phoneControl.patchValue(obj.slice(match.dial.length), {
        emitEvent: false,
      });
    } else {
      this.phoneControl.patchValue(this._digitsOnly(obj), { emitEvent: false });
    }
  }

  override setDisabledState(isDisabled: boolean) {
    super.setDisabledState(isDisabled);
    if (isDisabled) {
      this.phoneControl.disable();
    } else {
      this.phoneControl.enable();
    }
  }

  override validate(control: AbstractControl): ValidationErrors | null {
    const raw = (this.phoneControl.value ?? '').replace(/\s+/g, '');
    if (!raw) return null;
    const country = this.selectedCountry();
    if (!country.pattern.test(raw)) {
      return {
        phonePattern: { country: country.name, expected: country.placeholder },
      };
    }
    return null;
  }

  /**
   * Chiffres et espaces seulement — les espaces sont la mise en forme que l'agent tape
   * (« 07 12 34 56 78 ») et ne partent pas dans la valeur. Un numéro collé au format international
   * (« +225 07 12 34 56 78 ») prend son indicatif au lieu de garder « 225 » devant le numéro.
   */
  private _digitsOnly(value: string): string {
    let text = value;
    if (text.trimStart().startsWith('+')) {
      const compact = text.replace(/[^\d+]/g, '');
      // Le plus long indicatif d'abord : « +1 » ne doit pas avaler « +1242 ».
      const match = [...COUNTRIES]
        .sort((a, b) => b.dial.length - a.dial.length)
        .find((c) => compact.startsWith(c.dial));
      if (match) {
        this.selectedCountry.set(match);
        text = compact.slice(match.dial.length);
      }
    }
    return text.replace(/[^\d ]/g, '').replace(/ {2,}/g, ' ');
  }

  private _emitValue(): void {
    const raw = (this.phoneControl.value ?? '').replace(/\s+/g, '');
    const full = raw ? `${this.selectedCountry().dial}${raw}` : '';
    this.onTouched();
    this.onChange(full);
  }
}
