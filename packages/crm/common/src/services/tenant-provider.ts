import { computed, inject, Injectable, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TenantContextResponse } from '@sankore/crm-api';
import { DEFAULT_INSTITUTION_CURRENCY, setInstitutionCurrency } from '../models/institution-currency';
import { CrossTabChannel } from './cross-tab-channel';

@Injectable({
  providedIn: 'root'
})
export class TenantProvider {
  private readonly _document = inject(DOCUMENT);
  private readonly _crossTab = inject(CrossTabChannel);
  /** Icône de l'application (`index.html`), reprise quand l'institution n'a pas ou plus de logo. */
  private _defaultFavicon: string | null = null;
  /** Dernier logo demandé : un chargement plus lent qu'un changement suivant ne doit pas l'écraser. */
  private _pendingFavicon: string | null = null;
  private readonly _context = signal<TenantContextResponse | null>(null);
  public readonly context = this._context.asReadonly();

  /**
   * Vrai une fois le contexte du tenant chargé.
   *
   * `provideTenantInitializer` avale l'échec de `getTenantContext`
   * (`catchError(() => of(null))`) et laisse donc le contexte à `null` : c'est
   * la seule marque disponible pour distinguer un tenant inconnu d'un
   * démarrage réussi. Exposer le prédicat ici évite que chaque appelant
   * réinvente le test de nullité.
   */
  public readonly isLoaded = computed(() => this._context() !== null);

  /** La monnaie de tous les montants de l'institution (Paramétrage › Entreprise). */
  public readonly currency = computed(() => this._context()?.currency || DEFAULT_INSTITUTION_CURRENCY);

  public constructor() {
    this._crossTab
      .on('tenant-context-changed')
      .pipe(takeUntilDestroyed())
      .subscribe(({ context }) => {
        // Un onglet qui n'a pas encore son contexte, ou celui d'une autre institution, l'ignore.
        const current = this._context();
        if (current && current.tenantId === context.tenantId) this.setContext(context);
      });
  }

  public setContext(ctx: TenantContextResponse): void {
    this._context.set(ctx);
    setInstitutionCurrency(ctx.currency);
    this._applyTheme(ctx);
    this._applyFavicon(ctx.logoUrl ?? null);
  }

  /**
   * Après un changement par l'administrateur (Paramétrage › Entreprise) : nom, logo, couleurs et
   * monnaie s'appliquent tout de suite dans cet onglet, puis dans les autres onglets ouverts.
   */
  public updateContext(patch: Partial<TenantContextResponse>): void {
    const ctx = this._context();
    if (!ctx) return;
    const next = { ...ctx, ...patch };
    this.setContext(next);
    this._crossTab.post({ type: 'tenant-context-changed', context: next });
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

  /**
   * Le logo de l'institution sert d'icône d'onglet. Il est chargé d'abord : une adresse cassée
   * laisserait l'onglet sans aucune icône, on garde alors celle de l'application.
   */
  private _applyFavicon(logoUrl: string | null): void {
    const view = this._document.defaultView;
    if (!view) return;
    let link = this._document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) {
      link = this._document.createElement('link');
      link.rel = 'icon';
      this._document.head.appendChild(link);
    }
    if (this._defaultFavicon === null) this._defaultFavicon = link.getAttribute('href') ?? '';

    const icon = link;
    const useDefault = (): void => {
      icon.type = 'image/png';
      icon.href = this._defaultFavicon ?? '';
    };
    this._pendingFavicon = logoUrl;
    if (!logoUrl) {
      useDefault();
      return;
    }
    const probe = new view.Image();
    probe.onload = () => {
      if (this._pendingFavicon !== logoUrl) return;
      // Le logo peut être en PNG, JPG ou WebP : sans type, le navigateur le lit d'après le contenu.
      icon.removeAttribute('type');
      icon.href = logoUrl;
    };
    probe.onerror = () => {
      if (this._pendingFavicon === logoUrl) useDefault();
    };
    probe.src = logoUrl;
  }

  /**
   * « #1A4D4D » ou « #1A4D4DFF » : les couleurs par défaut du serveur portent une opacité, et la
   * forme à 8 chiffres était refusée — le thème n'était alors jamais appliqué au chargement.
   * L'opacité est ignorée : la couleur principale est toujours opaque.
   */
  private _hexToRgbTriplet(hex: string): string | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})(?:[a-f\d]{2})?$/i.exec(hex.trim());
    if (!result) return null;
    return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
  }
}
