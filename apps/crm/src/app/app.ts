import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Button } from '@talisoft/ui/button';

@Component({
  imports: [RouterModule, Button],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected title = 'crm';
}
