import { inject, Injectable, signal } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';

export interface BreadcrumbItem {
  label: string;
  link?: string[];
}

@Injectable({ providedIn: 'root' })
export class BreadcrumbService {
  private readonly _crumbs = signal<BreadcrumbItem[]>([]);
  public readonly crumbs = this._crumbs.asReadonly();

  constructor() {
    inject(Router).events
      .pipe(filter((e) => e instanceof NavigationStart))
      .subscribe(() => this._crumbs.set([]));
  }

  set(items: BreadcrumbItem[]): void {
    this._crumbs.set(items);
  }
}
