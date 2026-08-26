import { Component } from '@angular/core';
import { ButtonModule } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';

@Component({
  selector: 'tas-navigation',
  templateUrl: './navigation.html',
  standalone: true,
  imports: [ButtonModule, TasIcon],
})
export class TasNavigation {}
