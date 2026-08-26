import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ContentChild,
  HostBinding,
  Inject,
  input,
  Optional,
  viewChild,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import { AbstractFormFieldControl } from './abstract-form-field-control';
import { TasError } from './form-error.component';
import {
  AbstractFormFieldConfigOptions,
  FormFieldAppearanceOption,
  TAS_FORM_FIELD_OPTIONS,
  TasFormFieldSizeOption,
} from './form-field.config';
import { TasHint } from './form-hint.component';
import { TasLabel } from './label.component';

@Component({
  selector: 'tas-form-field',
  styleUrl: './form-field.component.scss',
  encapsulation: ViewEncapsulation.None,
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="block mb-1" [for]="inputControl?.id">
      <ng-content select="tas-label"></ng-content>
    </label>
    <div class="input__container flex items-center">
      <ng-content select="tas-icon[tasPrefix], button[tasPrefix]"></ng-content>
      <ng-content
        select="input[tasInput], textarea[tasInput], tas-select, tas-multi-select, select[tasNativeSelect]"
      ></ng-content>
      <ng-content select="tas-icon[tasSuffix], button[tasSuffix]"></ng-content>
    </div>
    <ng-content select="tas-hint"></ng-content>
    <ng-content select="tas-error"></ng-content>
  `,
})
export class FormField {
  constructor(
    @Optional()
    @Inject(TAS_FORM_FIELD_OPTIONS)
    private _formFieldOptions: AbstractFormFieldConfigOptions
  ) {}

  public appearance = input<FormFieldAppearanceOption>('fill');
  public size = input<TasFormFieldSizeOption>('medium');

  static nextId = 0;

  @HostBinding('id')
  componentId = `tas-form-field-id-${FormField.nextId++}`;

  labelControl = viewChild<TasLabel>(TasLabel);

  @ViewChild(TasError) errorComponent: TasError | undefined;

  @ViewChild(TasHint) hintComponent: TasHint | undefined;

  @ContentChild(AbstractFormFieldControl, { descendants: true })
  inputControl: AbstractFormFieldControl | undefined;

  @HostBinding('class')
  get classes() {
    const appearance = this.appearance() ?? this._formFieldOptions.appearance;
    const size = this.size() ?? this._formFieldOptions.size;

    return {
      'tas-form-field__container__wrapper': true,
      'tas-form-field__appearance--outline': appearance === 'outline',
      'tas-form-field__appearance--fill': appearance === 'fill',
      'tas-form-field--rounded': this._formFieldOptions.rounded,
      'tas-form-field__size--medium': size === 'medium',
      'tas-form-field__size--small': size === 'small',
      'tas-form-field__size--large': size === 'large',
    };
  }
}
