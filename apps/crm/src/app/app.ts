import { Component, inject, OnInit } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterModule,
} from '@angular/router';
import { Loading } from '@sankore/crm/common';
import { filter } from 'rxjs';
import { LoadingComponent, PageLoadingComponent } from '@sankore/crm/common';

@Component({
  imports: [RouterModule, LoadingComponent, PageLoadingComponent],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private readonly _router = inject(Router);
  private readonly _loadingService = inject(Loading);

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
  }
}
