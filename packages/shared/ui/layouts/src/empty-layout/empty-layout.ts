import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'tas-empty-layout',
  template: ` <router-outlet />`,
  standalone: true,
  imports: [RouterOutlet],
})
export class TasEmptyLayout {}
