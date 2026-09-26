import { Component, inject, OnInit } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterModule,
} from '@angular/router';
import { AccessDeniedService, Loading } from '@sankore/crm/common';
import { filter } from 'rxjs';
import {
  AccessDeniedBanner,
  LoadingComponent,
  PageLoadingComponent,
} from '@sankore/crm/common';

@Component({
  imports: [
    RouterModule,
    LoadingComponent,
    PageLoadingComponent,
    AccessDeniedBanner,
  ],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private readonly _router = inject(Router);
  private readonly _loadingService = inject(Loading);
  private readonly _accessDenied = inject(AccessDeniedService);

  public ngOnInit(): void {
    this._router.events
      .pipe(filter((event) => event instanceof NavigationStart))
      .subscribe(() => {
        this._loadingService.set(true);
      });

    this._router.events
      .pipe(
        filter(
          (event) =>
            event instanceof NavigationEnd ||
            event instanceof NavigationCancel ||
            event instanceof NavigationError,
        ),
      )
      .subscribe(() => {
        this._loadingService.set(false);
      });

    // Un refus de permission annule la navigation puis en déclenche une autre
    // vers l'accueil. C'est cette seconde navigation que le service laisse
    // passer : la bannière ne disparaît qu'au déplacement suivant.
    this._router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        this._accessDenied.onNavigationSettled();
      });
  }
}
