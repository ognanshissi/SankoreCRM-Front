import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  Input,
  NgZone,
  OnDestroy,
  Optional,
  ViewEncapsulation,
} from '@angular/core';
import { ButtonBaseMixins } from './button-mixin';

@Component({
  selector:
    'button[tas-raised-button], button[tas-filled-button], button[tas-outlined-button], button[tas-text-button], button[tas-button]',
  templateUrl: './button.html',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./button.scss'],
  exportAs: 'TasButton',
  host: {
    '[attr.type]': 'type',
  },
})
export class Button extends ButtonBaseMixins {
  @Input() type: 'reset' | 'button' | 'submit' = 'button';
}

@Component({
  selector:
    'a[tas-raised-button], a[tas-filled-button], a[tas-outlined-button], a[tas-text-button], a[tas-button]',
  templateUrl: './button.html',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./button.scss'],
  exportAs: 'TasAnchor',
})
export class Anchor extends Button implements AfterViewInit, OnDestroy {
  constructor(@Optional() private _ngZone?: NgZone) {
    super();
  }

  override ngAfterViewInit() {
    super.ngAfterViewInit();

    /** @breaking-change 14.0.0 _ngZone will be required. */
    if (this._ngZone) {
      this._ngZone.runOutsideAngular(() => {
        this._elementRef.nativeElement.addEventListener('click', this._haltDisabledEvents);
      });
    } else {
      this._elementRef.nativeElement.addEventListener('click', this._haltDisabledEvents);
    }
  }

  override ngOnDestroy() {
    super.ngOnDestroy();
    this._elementRef.nativeElement.removeEventListener('click', this._haltDisabledEvents);
  }

  _haltDisabledEvents = (event: Event): void => {
    // A disabled button shouldn't apply any actions
    if (this.disabled) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
}
