import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TasIcon } from '@talisoft/ui/icon';
import { BreadcrumbService } from '../../services';

@Component({
  selector: 'common-breadcrumb',
  standalone: true,
  imports: [RouterLink, TasIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (crumbs().length > 1) {
      <nav class="flex items-center gap-1 mb-4 flex-wrap" aria-label="Fil d'Ariane">
        @for (crumb of crumbs(); track $index; let last = $last) {
          @if (!last) {
            <a
              [routerLink]="crumb.link"
              class="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors max-w-[180px] truncate"
            >
              @if ($first) {
                <tas-icon iconName="feather:home" style="font-size:13px" class="shrink-0"></tas-icon>
              } @else {
                {{ crumb.label }}
              }
            </a>
            <tas-icon iconName="feather:chevron-right" style="font-size:12px" class="text-slate-300 shrink-0"></tas-icon>
          } @else {
            <span class="text-sm text-slate-700 font-medium max-w-[220px] truncate">
              {{ crumb.label }}
            </span>
          }
        }
      </nav>
    }
  `,
})
export class BreadcrumbComponent {
  protected readonly crumbs = inject(BreadcrumbService).crumbs;
}
