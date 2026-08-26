import {
  AfterViewInit,
  booleanAttribute,
  Component,
  computed,
  ContentChild,
  forwardRef,
  input,
  OnChanges,
  OnInit,
  signal,
  SimpleChanges,
  TemplateRef,
  ViewEncapsulation,
} from '@angular/core';
import { FormControl, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { SelectionModel } from '@angular/cdk/collections';
import { NgClass, NgForOf, NgIf, NgTemplateOutlet } from '@angular/common';
import { fromEvent } from 'rxjs';
import { FormField } from '@talisoft/ui/form-field';
import { AbstractControlValueAccessor } from '@talisoft/ui/core';
import { TasInput } from '@talisoft/ui/input';

@Component({
  selector: 'tas-multi-select',
  templateUrl: './multi-select.html',
  styleUrl: './multi-select.scss',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TasMultiSelect),
      multi: true,
    },
  ],
  imports: [
    NgIf,
    FormsModule,
    FormField,
    TasInput,
    NgTemplateOutlet,
    NgClass,
    NgForOf,
  ],
})
export class TasMultiSelect<T>
  extends AbstractControlValueAccessor<string[]>
  implements OnInit, AfterViewInit, OnChanges
{
  public selectionModel: SelectionModel<{
    [key: string]: string;
  }> = new SelectionModel<{
    [key: string]: string;
  }>(true, [], true);

  public placeholder = input('Choisissez les options');

  public filter = input(false, { transform: booleanAttribute });

  public options = input<{ [key: string]: any }[]>();

  public optionLabel = input<string>('label');

  public searchable = input<boolean>(true);

  @ContentChild('labelTemplate', { descendants: true })
  labelTemplate!: TemplateRef<any>;

  public optionValue = input<string>('value');

  public isDropdownOpened = signal(false);

  public searchKey = signal('');

  public selectControl = new FormControl(null);

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
      // if (changes['options'].currentValue.length > 10) {
      //   this.searchable();
      // }
    }
  }

  public ngOnInit(): void {
    this._closeDropdownOnOutsideClick();

    this.selectionModel.changed.subscribe((res) => {
      this.value = this.selectionModel.selected.map(
        (selected) => selected[this.optionValue()]
      );
    });
  }

  public ngAfterViewInit() {}

  /**
   * Update the writeValue method when the field has default value
   * @param obj
   */
  override writeValue(obj: string[]) {
    if (obj) {
      this.value = obj;
    }
  }

  override registerOnChange(fn: any): void {
    this.selectControl.valueChanges.subscribe(fn);
    this.onChange = fn;
  }

  override registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  public updateSearchKey($event: Event) {
    this.searchKey.set(($event.target as HTMLInputElement).value);
  }

  public toggleSelection(item: any) {
    this.selectionModel.toggle(item);
  }

  public toggleDropdown(): void {
    this.isDropdownOpened.set(!this.isDropdownOpened());
  }

  override get value(): any {
    return this.selectControl.value;
  }

  override set value(value: any) {
    this.selectControl.setValue(value);
    this.onChange(value);
    this.onTouched();
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
