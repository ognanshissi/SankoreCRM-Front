import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY, finalize } from 'rxjs';
import { Anchor, Button } from '@talisoft/ui/button';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TenantModuleResponse, TenantModulesApiService } from '@sankore/crm-admin-api';
import { describeModuleError, formatPrice, MODULE_DELAY_NOTICE, statusStyle } from '../modules/module-referential';

/**
 * Les modules payants d'un tenant, vus de la plateforme. « Activer directement » sert aux
 * activations négociées hors du CRM ; une demande en attente est autorisée au passage plutôt que
 * doublée, c'est le registre qui s'en charge.
 */
@Component({
  selector: 'tenant-modules-section',
  imports: [DatePipe, RouterLink, Anchor, Button, TasTable],
  template: `
    <section class="flex flex-col gap-3">
      <div>
        <h2 class="text-base font-bold text-slate-800">Modules</h2>
        <p class="text-sm text-slate-500 tabular-nums">
          {{ activeCount() }} actif{{ activeCount() > 1 ? 's' : '' }} sur {{ rows().length }} — le socle reste toujours actif.
        </p>
      </div>

      @if (loadError()) {
        <div role="alert" class="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-red-50 px-5 py-4">
          <p class="text-sm text-red-800">{{ loadError() }}</p>
          <button tas-outlined-button color="primary" type="button" (click)="load()">Réessayer</button>
        </div>
      } @else {
        <tas-table [data]="rows()" identifierField="code" [config]="tableConfig()" [hasCaption]="false"
                   [isLoading]="isLoading()">
          <ng-template #header>
            <tr class="text-left text-xs font-bold uppercase tracking-wide text-slate-500">
              <th class="py-2.5 pl-5">Module</th>
              <th class="py-2.5">Statut</th>
              <th class="py-2.5 text-right">Prix</th>
              <th class="py-2.5 pr-5 text-right">Action</th>
            </tr>
          </ng-template>
          <ng-template #body let-m>
            <tr class="transition-colors hover:bg-slate-50">
              <td class="py-3 pl-5 text-sm font-semibold text-slate-800">{{ m.label }}</td>
              <td class="py-3">
                <div class="flex flex-col leading-snug">
                  <span class="flex items-center gap-1.5 text-sm font-semibold" [class]="m.tone">
                    <span class="size-2 rounded-full" [class]="m.dot" aria-hidden="true"></span>
                    {{ m.stateLabel }}
                  </span>
                  <span class="text-xs text-slate-500 tabular-nums">
                    @switch (m.state) {
                      @case ('Active') {
                        depuis le {{ m.current?.activatedAt | date: 'd MMM y' }}
                        @if (m.current?.source === 'Migration') { · repris à la mise en place des modules }
                      }
                      @case ('Requested') {
                        demandé le {{ m.current?.requestedAt | date: 'd MMM y' }} par {{ m.current?.requestedByEmail }}
                      }
                      @case ('Rejected') { refusé le {{ m.current?.decidedAt | date: 'd MMM y' }} }
                      @case ('Deactivated') {
                        désactivé le {{ m.current?.deactivatedAt | date: 'd MMM y' }}
                        @if (m.current?.deactivatedByEmail) { par {{ m.current?.deactivatedByEmail }} }
                      }
                    }
                  </span>
                </div>
              </td>
              <td class="py-3 text-right text-sm text-slate-700 tabular-nums">{{ m.price }}</td>
              <td class="py-3 pr-5 text-right">
                @if (m.state === 'Requested') {
                  <a tas-outlined-button color="primary" routerLink="/modules/demandes">Voir la demande</a>
                } @else if (m.state !== 'Active') {
                  <button tas-outlined-button color="primary" type="button" [disabled]="activating() === m.code"
                          [isLoading]="activating() === m.code" (click)="confirmActivate(m)">
                    Activer directement
                  </button>
                }
              </td>
            </tr>
          </ng-template>
        </tas-table>
      }
    </section>
  `,
})
export class TenantModulesSection implements OnInit {
  private readonly _api = inject(TenantModulesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public readonly tenantId = input.required<string>();
  public readonly tenantName = input<string>('');

  public modules = signal<TenantModuleResponse[]>([]);
  public isLoading = signal(false);
  public loadError = signal<string | null>(null);
  public activating = signal<string | null>(null);

  public readonly tableConfig = signal<TableConfig>({
    property: 'code',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 20, pageSizeOptions: [20] },
  });

  public readonly rows = computed(() =>
    this.modules().map((m) => {
      const style = statusStyle(m.state);
      const current = m.current;
      return {
        ...m,
        stateLabel: style.label,
        tone: style.tone,
        dot: style.dot,
        // Un abonnement en cours se facture au prix accepté, pas au prix catalogue du jour.
        price:
          current?.acceptedMonthlyPrice != null && (m.state === 'Active' || m.state === 'Requested')
            ? formatPrice(current.acceptedMonthlyPrice, current.acceptedCurrency)
            : formatPrice(m.monthlyPrice, m.currency),
      };
    }),
  );

  public readonly activeCount = computed(() => this.modules().filter((m) => m.state === 'Active').length);

  public ngOnInit(): void {
    this.load();
  }

  public load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this._api
      .listTenantModules(this.tenantId())
      .pipe(
        catchError((err) => {
          this.loadError.set(describeModuleError(err, 'Les modules du tenant n’ont pas pu être chargés.'));
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((result) => this.modules.set(result.modules ?? []));
  }

  public confirmActivate(module: TenantModuleResponse): void {
    this._confirm.confirm({
      title: 'Activer ce module ?',
      message:
        `« ${module.label} » sera activé pour ${this.tenantName() || 'ce tenant'} sans demande de sa part. ` +
        MODULE_DELAY_NOTICE,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Activer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._activate(module),
    });
  }

  private _activate(module: TenantModuleResponse): void {
    this.activating.set(module.code ?? null);
    this._api
      .activateTenantModule(this.tenantId(), module.code!)
      .pipe(
        catchError((err) => {
          this._snackbar.error('Activation impossible', describeModuleError(err, 'Le module n’a pas été activé.'));
          return EMPTY;
        }),
        finalize(() => this.activating.set(null)),
      )
      .subscribe(() => {
        this._snackbar.success('Module activé', `« ${module.label} » est actif pour ${this.tenantName()}.`);
        this.load();
      });
  }
}
