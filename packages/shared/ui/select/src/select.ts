import {
  AfterViewInit,
  booleanAttribute,
  Component,
  computed,
  ContentChild,
  forwardRef,
  input,
  linkedSignal,
  OnChanges,
  OnInit,
  signal,
  SimpleChanges,
  TemplateRef,
  ViewEncapsulation,
} from '@angular/core';
import { FormControl, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { AbstractControlValueAccessor } from '@talisoft/ui/core';
import { SelectionModel } from '@angular/cdk/collections';
import { NgClass, NgIf, NgTemplateOutlet } from '@angular/common';
import { TasFormField } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { fromEvent } from 'rxjs';

@Component({
  selector: 'tas-select',
  templateUrl: './select.html',
  styleUrl: './select.scss',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TasSelect),
      multi: true,
    },
  ],
  imports: [FormsModule, TasFormField, TasInput, NgTemplateOutlet, NgClass],
  animations: [],
})
export class TasSelect<T>
  extends AbstractControlValueAccessor<string[] | string>
  implements OnInit, AfterViewInit, OnChanges
{
  public selectionModel: SelectionModel<string> = new SelectionModel<string>(
    false,
    [],
    true
  );

  public placeholder = input('Choisissez une option');

  public filter = input(false, { transform: booleanAttribute });

  public options = input<{ [key: string]: any }[]>();

  public optionLabel = input<string>('label');

  public searchable = input<boolean>(false);

  @ContentChild('labelTemplate', { descendants: true })
  labelTemplate!: TemplateRef<any>;

  public optionValue = input<string>('value');

  public isDropdownOpened = signal(false);

  public searchKey = signal('');

  public isSearchable = linkedSignal(() => this.searchable())

  public selectControl = new FormControl<string | null>(null);

  /** Vrai pendant une écriture venue du modèle : aucune notification sortante. */
  private _syncingFromModel = false;

  public filteredList = computed(() => {
    if (!this.searchKey().trim()?.length) {
      return this.options();
    }
    return this.options()?.filter((item) =>
      item[this.optionLabel()]
        .toLowerCase()
        .includes(this.searchKey()?.toLowerCase()?.trim())
    );
  });

  public ngOnChanges(changes: SimpleChanges) {
    if (changes['options']?.currentValue) {
      if (changes['options'].currentValue.length > 10) {
        // enable search
        this.isSearchable.set(true);
      }
    }
  }

  public ngOnInit(): void {
    this._closeDropdownOnOutsideClick();

    this.selectionModel.changed.subscribe(() => {
      // Une synchronisation venue du modèle ne doit pas être renotifiée :
      // ce serait exactement le cycle que `writeValue` évite ci-dessous.
      if (this._syncingFromModel) return;
      this.value = this.selectionModel.selected[0];
    });
  }

  public ngAfterViewInit() {}

  /**
   * Direction modèle → vue.
   *
   * Un ControlValueAccessor ne doit JAMAIS notifier en retour depuis
   * `writeValue` : l'implémentation précédente passait par le setter `value`,
   * qui appelle `onChange`. Toute réécriture de la valeur émettait donc un
   * `ngModelChange`, et tout écran dont le gestionnaire provoque un nouveau
   * rendu du select (un rechargement affichant un spinner, par exemple)
   * partait en boucle infinie.
   *
   * `null` est honoré : réinitialiser un filtre vide bien le champ, ce que
   * l'ancien garde `if (obj)` empêchait.
   */
  override writeValue(obj: string | string[] | null) {
    // La classe de base est typée `string[] | string` pour couvrir le multi
    // select ; ici la sélection est simple, on ne retient donc que la première
    // valeur d'un éventuel tableau.
    const next = (Array.isArray(obj) ? obj[0] : obj) ?? null;
    this._syncingFromModel = true;
    try {
      this.selectControl.setValue(next, { emitEvent: false });
      this.selectionModel.setSelection(...(next ? [next] : []));
    } finally {
      this._syncingFromModel = false;
    }
  }

  override registerOnChange(fn: any): void {
    // Une seule voie de notification : le setter `value`. L'abonnement à
    // `valueChanges` qui existait ici en ouvrait une seconde, et chaque
    // sélection de l'utilisateur déclenchait donc le gestionnaire DEUX fois
    // (deux appels HTTP par changement de filtre, par exemple).
    this.onChange = fn;
  }

  override registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  public updateSearchKey($event: Event) {
    this.searchKey.set(($event.target as HTMLInputElement).value);
  }

  public toggleSelection(item: string) {
    this.selectionModel.toggle(item);
    this.isDropdownOpened.set(false);
  }

  public toggleDropdown(): void {
    this.isDropdownOpened.set(!this.isDropdownOpened());
  }

  override get value(): any {
    return this.selectControl.value;
  }

  override set value(value: any) {
    // `emitEvent: false` : la notification est émise explicitement juste après,
    // et une seule fois.
    this.selectControl.setValue(value, { emitEvent: false });
    this.onChange(value);
    this.onTouched();
  }

  public get displayValue() {
    if (!this.options()?.length) {
      return { value: null, label: null };
    }
    const selectedValue = this.options()?.find(
      (v) => v[this.optionValue()] === this.value
    );

    if (!selectedValue) {
      return { value: null, label: null };
    }

    return {
      value: selectedValue[this.optionValue()],
      label: selectedValue[this.optionLabel()],
    };
  }

  /**
   * Close dropdown when the user clicked outside the container
   * The click event stop the propagation $event.stopPropagation();
   * HTML: <div (click)="$event.stopPropagation();">...</div>
   */
  private _closeDropdownOnOutsideClick() {
    fromEvent(document, 'click').subscribe((event) => {
      if (this.isDropdownOpened()) {
        this.isDropdownOpened.set(false);
      }
    });
  }
}
