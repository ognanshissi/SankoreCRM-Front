import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { catchError, EMPTY, forkJoin } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasSwitch } from '@talisoft/ui/switch';
import { RolesApiService, RolePermissionDto, PermissionsApiService, PermissionGroupDto } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';

@Component({
  selector: 'role-permissions',
  imports: [NgClass, TasCard, TasIcon, TasSpinner, TasSwitch],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="pb-6 flex flex-col gap-4">

        <!-- Page header -->
        <div class="flex items-start justify-between">
          <div>
            <h1 class="text-lg font-semibold text-slate-800">Permissions</h1>
            <p class="text-sm text-slate-400 mt-0.5">
              {{ grantedCodes().size }} permission{{ grantedCodes().size !== 1 ? 's' : '' }} accordée{{ grantedCodes().size !== 1 ? 's' : '' }} sur {{ totalPermissions() }}
            </p>
          </div>
          @if (isSystem()) {
            <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
              <tas-icon iconName="feather:lock" class="text-slate-400 shrink-0" style="font-size:14px"></tas-icon>
              <p class="text-xs text-slate-500">Rôle système — lecture seule</p>
            </div>
          }
        </div>

        @for (group of catalog(); track group.module) {
          @let module = group.module ?? '';
          @let groupGranted = grantedCount(group);
          @let groupTotal = group.permissions?.length ?? 0;
          @let isExpanded = expandedModules().has(module);

          <tas-card [class.opacity-60]="isSystem()">
            <!-- Accordion header -->
            <button
              type="button"
              class="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
              (click)="toggleModule(module)"
            >
              <div class="flex items-center gap-2">
                <p class="text-sm font-semibold text-slate-700 capitalize">{{ module }}</p>
                <span class="font-mono text-xs text-slate-400">{{ module }}</span>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span
                  class="text-xs font-medium px-2 py-0.5 rounded-full tabular-nums"
                  [ngClass]="{
                    'bg-green-100 text-green-700': groupGranted === groupTotal && groupTotal > 0,
                    'bg-primary/10 text-primary': groupGranted > 0 && groupGranted < groupTotal,
                    'bg-slate-100 text-slate-500': groupGranted === 0
                  }"
                >
                  {{ groupGranted }} / {{ groupTotal }}
                </span>
                <tas-icon
                  [iconName]="isExpanded ? 'feather:chevron-up' : 'feather:chevron-down'"
                  style="font-size:14px"
                  class="text-slate-400"
                ></tas-icon>
              </div>
            </button>

            <!-- Permission rows -->
            @if (isExpanded) {
              <div class="divide-y divide-gray-100 border-t border-gray-100">
                @for (perm of group.permissions; track perm.code) {
                  @let granted = grantedCodes().has(perm.code ?? '');
                  @let toggling = togglingCode() === perm.code;
                  <div class="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition-colors">
                    <tas-switch
                      [checked]="granted"
                      [disabled]="isSystem() || togglingCode() !== null"
                      [isLoading]="toggling"
                      [ariaLabel]="perm.description ?? perm.code ?? ''"
                      (toggle)="toggle(perm.code ?? '', granted)"
                    ></tas-switch>
                    <div class="flex-1 min-w-0">
                      <p class="font-mono text-sm text-slate-800">{{ perm.code }}</p>
                      <p class="text-xs text-slate-400 mt-0.5">{{ perm.description }}</p>
                    </div>
                  </div>
                }
              </div>
            }
          </tas-card>
        }
      </div>
    }
  `,
})
export class RolePermissionsPage {
  private readonly _rolesApiService = inject(RolesApiService);
  private readonly _permissionsApiService = inject(PermissionsApiService);
  private readonly _snackbarService = inject(SnackbarService);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public isSystem = signal(false);
  public permissions = signal<RolePermissionDto[]>([]);
  public catalog = signal<PermissionGroupDto[]>([]);
  public togglingCode = signal<string | null>(null);
  public expandedModules = signal<Set<string>>(new Set());

  public totalPermissions = computed(() =>
    this.catalog().reduce((acc, g) => acc + (g.permissions?.length ?? 0), 0)
  );

  public grantedCodes = computed(
    () => new Set(this.permissions().map((p) => p.code ?? '')),
  );

  public grantedCount(group: PermissionGroupDto): number {
    const granted = this.grantedCodes();
    return (group.permissions ?? []).filter((p) => granted.has(p.code ?? '')).length;
  }

  public toggleModule(module: string): void {
    this.expandedModules.update((set) => {
      const next = new Set(set);
      next.has(module) ? next.delete(module) : next.add(module);
      return next;
    });
  }

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      forkJoin({
        role: this._rolesApiService.getRole(this.id()),
        catalog: this._permissionsApiService.listPermissions(),
      }).subscribe({
        next: ({ role, catalog }) => {
          this.isSystem.set(role.isSystem ?? false);
          this.permissions.set(role.permissions ?? []);
          this.catalog.set(catalog ?? []);
          this.expandedModules.set(
            new Set((catalog ?? []).map((g) => g.module ?? ''))
          );
          this.isLoading.set(false);
        },
        error: () => {
          this._snackbarService.error(
            'Erreur',
            'Impossible de charger les permissions.',
          );
          this.isLoading.set(false);
        },
      });
    });
  }

  public toggle(code: string, currentlyGranted: boolean): void {
    if (this.togglingCode()) return;
    this.togglingCode.set(code);
    if (currentlyGranted) {
      this._rolesApiService
        .revokePermissionFromRole(this.id(), code)
        .pipe(
          catchError(() => {
            this._snackbarService.error(
              'Erreur',
              'Impossible de retirer la permission.',
            );
            this.togglingCode.set(null);
            return EMPTY;
          }),
        )
        .subscribe(() => {
          this.permissions.update((list) =>
            list.filter((p) => p.code !== code),
          );
          this.togglingCode.set(null);
        });
    } else {
      this._rolesApiService
        .assignPermissionToRole(this.id(), { permissionCode: code })
        .pipe(
          catchError(() => {
            this._snackbarService.error(
              'Erreur',
              "Impossible d'ajouter la permission.",
            );
            this.togglingCode.set(null);
            return EMPTY;
          }),
        )
        .subscribe(() => {
          this.permissions.update((list) => [
            ...list,
            { code, description: null } as RolePermissionDto,
          ]);
          this.togglingCode.set(null);
        });
    }
  }
}

export default RolePermissionsPage;
