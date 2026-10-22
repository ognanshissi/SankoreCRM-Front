import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';

export interface BreadcrumbItem {
  label: string;
  link?: string[];
}

@Injectable({ providedIn: 'root' })
export class BreadcrumbService {
  private readonly _crumbs = signal<BreadcrumbItem[]>([]);
  public readonly crumbs = this._crumbs.asReadonly();

  private _held: { items: BreadcrumbItem[]; owner: DestroyRef } | null = null;
  private readonly _owners = new WeakSet<DestroyRef>();

  constructor() {
    const router = inject(Router);
    router.events
      .pipe(filter((e) => e instanceof NavigationStart))
      .subscribe(() => this._crumbs.set([]));
    router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        if (this._held && !this._crumbs().length) this._crumbs.set(this._held.items);
      });
  }

  set(items: BreadcrumbItem[]): void {
    this._crumbs.set(items);
  }

  /**
   * Le fil d'une page à onglets (fiche lead, client, rôle…). Le fil est vidé à chaque navigation,
   * pour qu'une page qui n'en pose pas n'hérite pas de celui de la précédente — mais changer
   * d'onglet est aussi une navigation, et la page parente, qui reste en place, ne le reposait pas :
   * la barre du haut retombait sur « Leads » ou « Paramétrage », et le nom de la fiche, qu'elle est
   * seule à afficher, disparaissait. Ce fil-ci est donc reposé après chaque navigation qui ne l'a
   * pas remplacé, tant que la page qui l'a posé (`owner`) est en vie.
   */
  setForTabs(items: BreadcrumbItem[], owner: DestroyRef): void {
    this._held = { items, owner };
    this._crumbs.set(items);
    if (this._owners.has(owner)) return;
    this._owners.add(owner);
    owner.onDestroy(() => {
      if (this._held?.owner === owner) this._held = null;
    });
  }
}
