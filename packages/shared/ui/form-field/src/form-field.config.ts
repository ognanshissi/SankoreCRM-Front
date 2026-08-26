import { InjectionToken } from '@angular/core';

export type FormFieldAppearanceOption = 'fill' | 'outline';
export type TasFormFieldSizeOption = 'small' | 'medium' | 'large';
export abstract class AbstractFormFieldConfigOptions {
  appearance!: FormFieldAppearanceOption;
  rounded?: boolean;
  size?: TasFormFieldSizeOption
}

export class DefaultFormFieldConfigOptions implements AbstractFormFieldConfigOptions {
  appearance!: FormFieldAppearanceOption;
  rounded?: boolean;
  size?: TasFormFieldSizeOption;

  constructor() {
    this.appearance = 'fill';
    this.rounded = false;
    this.size = 'medium';
  }
}

export const TAS_FORM_FIELD_OPTIONS = new InjectionToken<AbstractFormFieldConfigOptions>(
  'Tas form field config options',
  {
    providedIn: 'root',
    factory: () => new DefaultFormFieldConfigOptions(),
  }
);
