import { FocusMonitor, FocusOrigin } from '@angular/cdk/a11y';
import {
  AfterViewInit,
  booleanAttribute,
  Component,
  ElementRef,
  HostBinding,
  inject,
  Input,
  OnDestroy,
} from '@angular/core';
import { ThemeVariant } from '@talisoft/ui/core';

// Button appearance
const BUTTON_ATTRIBUTES = [
  'tas-raised-button',
  'tas-outlined-button',
  'tas-filled-button',
  'tas-text-button',
  'tas-button',
];

@Component({
  template: ``,
  standalone: true,
  host: {
    '[attr.disabled]': 'disabled || isLoading || null',
  },
})
export class ButtonBaseMixins implements OnDestroy, AfterViewInit {
  protected _elementRef = inject(ElementRef);

  protected _focusMonitor = inject(FocusMonitor);

  constructor() {
    BUTTON_ATTRIBUTES.forEach((attr) => {
      if (this._hasHostAttributes(attr)) {
        this._getHostElement()?.classList.add(`${attr.replace(/-/g, '__')}__container`);
      }
    });

    // tas-button-base is used to defined default button appearance
    this._getHostElement()?.classList.add('tas__button__base');
  }

  @Input() color: ThemeVariant = 'neutral';

  @Input({ transform: booleanAttribute }) disabled!: boolean;

  @Input({ transform: booleanAttribute }) isLoading!: boolean;

  @Input({ transform: booleanAttribute }) rounded!: boolean;

  @Input({ transform: booleanAttribute }) iconButton!: boolean;

  @Input() size: 'small' | 'medium' | 'large' = 'medium';

  ngAfterViewInit() {
    this._focusMonitor.monitor(this._elementRef, true);
  }

  @HostBinding('class')
  get classes() {
    return {
      'tas__button__variant--primary': this.color == 'primary',
      'tas__button__variant--accent': this.color == 'accent',
      'tas__button__variant--warn': this.color == 'warn',
      'tas__button__variant--neutral': this.color == 'neutral',
      'tas__button--disabled': this.disabled || this.isLoading,
      'tas__button--loading': this.isLoading,
      'tas__button--rounded': this.rounded,
      'tas__button__size--small': this.size === 'small',
      'tas__button__size--medium': this.size === 'medium',
      'tas__button__size--large': this.size === 'large',
      tas__button__icon: this.iconButton,
    };
  }

  ngOnDestroy() {
    this._focusMonitor.monitor(this._elementRef, true);
  }

  focus(origin?: FocusOrigin, options?: FocusOptions): void {
    if (origin) {
      this._focusMonitor.focusVia(this._getHostElement(), origin, options);
    } else {
      this._getHostElement().focus(options);
    }
  }

  protected _getHostElement(): HTMLElement {
    return this._elementRef.nativeElement as HTMLElement;
  }

  protected _hasHostAttributes(...attributes: string[]) {
    return attributes.some((attr) => this._getHostElement()?.hasAttribute(attr));
  }
}
