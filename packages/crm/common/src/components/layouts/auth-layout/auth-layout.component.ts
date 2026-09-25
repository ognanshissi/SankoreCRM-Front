import { Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TenantProvider } from '../../../services';

@Component({
  selector: 'core-auth-layout',
  templateUrl: './auth-layout.component.html',
  standalone: true,
  styleUrl: './auth-layout.component.scss',
  imports: [RouterOutlet],
})
export class AuthLayoutComponent {

  private readonly _tenantProvider = inject(TenantProvider);

  public companyName = computed(() => {
    return this._tenantProvider.context()?.companyName;
  })


}
