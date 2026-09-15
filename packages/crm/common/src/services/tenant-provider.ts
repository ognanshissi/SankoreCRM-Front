import { inject, Injectable, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { TenantContextResponse } from '@sankore/crm-api';

@Injectable({
  providedIn: 'root'
})
export class TenantProvider {
  private readonly _document = inject(DOCUMENT);
  private readonly _context = signal<TenantContextResponse | null>(null);
  public readonly context = this._context.asReadonly();

  public setContext(ctx: TenantContextResponse): void {
    this._context.set(ctx);
  }

  public getFqdn(): string {
    return this._document.defaultView?.location.origin ?? '';
  }
}
