import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'core-auth-layout',
  templateUrl: './auth-layout.component.html',
  standalone: true,
  styleUrl: './auth-layout.component.scss',
  imports: [RouterOutlet],
})
export class AuthLayoutComponent {}
