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
    this._applyTheme(ctx);
  }

  public getFqdn(): string {
    return this._document.defaultView?.location.origin ?? '';
  }

  private _applyTheme(ctx: TenantContextResponse): void {
    const root = this._document.documentElement;

    if (ctx.primaryColor) {
      const rgb = this._hexToRgbTriplet(ctx.primaryColor);
      if (rgb) {
        root.style.setProperty('--tas-color-primary', rgb);
        root.style.setProperty('--mat-sys-primary', `rgb(${rgb})`);
        root.style.setProperty('--mat-sys-on-primary', '#ffffff');
        root.style.setProperty('--mat-sys-primary-container', `rgba(${rgb}, 0.15)`);
        root.style.setProperty('--mat-sys-on-primary-container', `rgb(${rgb})`);
      }
    }

    if (ctx.secondaryColor) {
      const rgb = this._hexToRgbTriplet(ctx.secondaryColor);
      if (rgb) {
        root.style.setProperty('--tas-color-accent', rgb);
        root.style.setProperty('--mat-sys-secondary', `rgb(${rgb})`);
        root.style.setProperty('--mat-sys-on-secondary', '#ffffff');
        root.style.setProperty('--mat-sys-secondary-container', `rgba(${rgb}, 0.15)`);
        root.style.setProperty('--mat-sys-on-secondary-container', `rgb(${rgb})`);
      }
    }
  }

  private _hexToRgbTriplet(hex: string): string | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return null;
    return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
  }
}
