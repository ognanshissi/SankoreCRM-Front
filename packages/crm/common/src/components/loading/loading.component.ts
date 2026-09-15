import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Loading } from './loading';

@Component({
  selector: 'loader',
  template: `
    @if (loaderService.isLoading()) {
      <div class="absolute top-0 left-0 w-full right-0 z-10">
        <mat-progress-bar
          mode="indeterminate"
          color="primary"
          class="absolute top-0 left-0 w-full right-0 z-10"
        ></mat-progress-bar>
      </div>
    }
  `,
  imports: [CommonModule, MatProgressBarModule],
})
export class LoadingComponent {
  public loaderService = inject(Loading);
}
