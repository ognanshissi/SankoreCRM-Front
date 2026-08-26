import { Component } from '@angular/core';

@Component({
  selector: 'card-header',
  template: ` <div class="p-4">
    <ng-content></ng-content>
  </div>`,
  standalone: true,
})
export class TasCardHeader {}
