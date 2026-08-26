import {
  AfterViewInit,
  Component,
  contentChild,
  inject,
  signal,
} from '@angular/core';
import { ButtonModule } from '@talisoft/ui/button';
import { TasNavigationSidebar } from './navigation-sidebar';
import { map, Observable, shareReplay } from 'rxjs';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { TasNavigationNavbar } from './navigation-navbar';

@Component({
  selector: 'tas-navigation-layout',
  standalone: true,
  template: `
    <div class="relative">
      <!--  top -->
      <aside class="sticky top-0">
        <ng-content select="tas-navigation-navbar"></ng-content>
      </aside>
      <div class="flex">
        <!--  left  navigation -->
        <ng-content select="tas-navigation-sidebar"></ng-content>
        <!--  main -->
        <main class="main-container-wrapper overflow-y-auto w-full">
          <ng-content></ng-content>
        </main>
      </div>
    </div>
  `,
  imports: [ButtonModule],
  styles: [
    `
      .main-container-wrapper {
        height: calc(100vh - 50px);
      }
    `,
  ],
})
export class TasNavigationLayout implements AfterViewInit {
  public navigationNavbar =
    contentChild<TasNavigationNavbar>(TasNavigationNavbar);

  public navigationSidebar =
    contentChild<TasNavigationSidebar>(TasNavigationSidebar);

  private breakpointObserver = inject(BreakpointObserver);
  public isHandset$: Observable<boolean> = this.breakpointObserver
    .observe(Breakpoints.Handset)
    .pipe(
      map((result) => result.matches),
      shareReplay()
    );

  public isMinimizedMenu = signal<boolean>(false);

  ngAfterViewInit() {
    if (this.navigationNavbar) {
      this.navigationNavbar()?.toggleCollapseMenu.subscribe((res) => {
        this.handleMinimizeChange(!this.isMinimizedMenu());
      });
    }

    this.isHandset$.subscribe((isHandset: boolean) => {
      this.handleMinimizeChange(isHandset);
    });
  }

  public handleMinimizeChange(value: boolean): void {
    this.isMinimizedMenu.set(value);
    this.navigationSidebar()?.isMinimized.set(this.isMinimizedMenu());
  }
}
