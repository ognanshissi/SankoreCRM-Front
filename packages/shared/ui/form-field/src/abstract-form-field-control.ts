import { Component, HostBinding } from '@angular/core';

@Component({
  template: ``,
  standalone: true,
  providers: [],
})
export abstract class AbstractFormFieldControl {
  @HostBinding('id')
  public id = `tas-input-id-${+Date.now()}`;
}