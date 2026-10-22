import { Component } from '@angular/core';

@Component({
  template: `
    <div
      class="mx-auto flex w-full max-w-xl flex-col gap-8 overflow-hidden px-5 py-8 sm:px-10 sm:py-12 lg:max-w-none xl:grid xl:grid-cols-1 xl:grid-rows-[300px_auto] xl:justify-between xl:gap-4 xl:p-[100px]"
    >
      <ng-content></ng-content>
    </div>
  `,
  selector: 'AuthenticationWrapper',
})
export class AuthenticationWrapper {}
