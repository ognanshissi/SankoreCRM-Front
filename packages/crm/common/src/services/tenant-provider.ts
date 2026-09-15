import { Injectable, signal } from '@angular/core';
import { TenantContextResponse } from '@sankore/crm-api';

@Injectable({
  providedIn: 'root'
})
export class TenantProvider {
  private readonly _context = signal<TenantContextResponse | null>(null);
  public readonly context = this._context.asReadonly();

  public setContext(ctx: TenantContextResponse): void {
    this._context.set(ctx);
  }

  public getFqdn(): string {
    return window.location.origin;
  }
}
