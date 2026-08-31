import { Component } from '@angular/core';

@Component({
  template: `
    <div
      class="grid grid-rows-[300px_auto] grid-cols-1 justify-between gap-4 p-[100px] overflow-hidden z-[9999]"
    >
      <ng-content></ng-content>
    </div>
  `,
  selector: 'AuthenticationWrapper',
})
export class AuthenticationWrapper {}
