import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, map, of } from 'rxjs';
import { ComplianceApiService, FormFieldReferenceTargetEnum, SuspicionAlertDto } from '@sankore/crm-api';
import { BreadcrumbService, EntityFormReferences } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { HandleSuspicionAlertDrawer, HandleSuspicionAlertDrawerData } from './handle-suspicion-alert-drawer';
import { isSuspicionAlertClosed, SuspicionAlertStatus, suspicionAlertStatusMeta } from './suspicion-alert-labels';

type StatusFilter = SuspicionAlertStatus | '';

const STATUS_VALUES: StatusFilter[] = ['', 'Open', 'UnderReview', 'Declared', 'ClosedWithoutDeclaration'];

/**
 * « Alertes LBC/FT » : la file des soupçons signalés par les agents, réservée au responsable
 * conformité (`compliance:suspicion:manage`). La déclaration elle-même se fait à la CENTIF, hors
 * de la plateforme : on n'y consigne que sa date et sa référence.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, TasCard, TasTable, TasTag, TasIcon, TasFormField, TasLabel, TasSelect, Button],
  template: `
    <div class="flex flex-col gap-4 pb-6">
      <div>
        <h1 class="text-xl font-bold text-slate-900">Alertes LBC/FT</h1>
        <p class="mt-1 text-sm text-slate-500">
          Les soupçons de blanchiment ou de financement du terrorisme signalés par les agents. L'agent ne voit que
          « transmis » : le suivi est le vôtre.
        </p>
      </div>

      <div class="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="note">
        <tas-icon iconName="feather:lock" class="mt-0.5 shrink-0" style="font-size:15px"></tas-icon>
        <p>
          <span class="font-semibold">Confidentiel.</span> La déclaration de soupçon se fait auprès de la CENTIF, en dehors
          de la plateforme. N'informez jamais le client, ni directement ni par un changement visible de son dossier.
        </p>
      </div>

      <tas-card class="block">
        <div class="grid grid-cols-4 gap-3 p-4">
          <tas-form-field>
            <tas-label>Statut</tas-label>
            <tas-select [options]="statusOptions" [ngModel]="status()" (ngModelChange)="onStatusChange($event)"></tas-select>
          </tas-form-field>
        </div>
      </tas-card>

      <tas-card class="block">
        <tas-table [data]="alerts()" [config]="tableConfig" [isLoading]="isLoading()" [hasCaption]="false">
          <ng-template #header>
            <tr>
              <th>Client</th>
              <th>Faits</th>
              <th>Signalé par</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </ng-template>
          <ng-template #body let-item>
            <tr class="align-top">
              <td class="py-3">
                <a class="text-sm font-semibold text-slate-900 hover:text-primary" [routerLink]="['/customers', item.clientId]">
                  {{ item.clientName || '—' }}
                </a>
                @if (item.clientNumber) {
                  <p class="text-xs text-slate-500 tabular-nums">{{ item.clientNumber }}</p>
                }
              </td>
              <td class="py-3 max-w-md">
                <p class="text-sm text-slate-800 line-clamp-3 whitespace-pre-line">{{ item.facts }}</p>
              </td>
              <td class="py-3">
                <p class="text-sm text-slate-800">{{ item.raisedByName || userName(item.raisedBy) }}</p>
                <p class="text-xs text-slate-500">{{ formatDate(item.raisedAt) }}</p>
              </td>
              <td class="py-3">
                <tas-tag [severity]="statusMeta(item.status).severity">{{ statusMeta(item.status).label }}</tas-tag>
                @if (item.status === 'Declared' && item.declarationReference) {
                  <p class="mt-1 text-xs text-slate-500">Réf. {{ item.declarationReference }} · {{ formatDate(item.declaredOn) }}</p>
                }
                @if (item.handledBy) {
                  <p class="mt-1 text-xs text-slate-500">par {{ item.handledByName || userName(item.handledBy) }}, {{ formatDate(item.handledAt) }}</p>
                }
              </td>
              <td class="py-3 text-right whitespace-nowrap">
                @if (isClosed(item.status)) {
                  <button tas-text-button type="button" class="text-sm" (click)="open(item)">Consulter</button>
                } @else {
                  <button tas-outlined-button color="primary" type="button" class="rounded-full text-sm" (click)="open(item)">Traiter</button>
                }
              </td>
            </tr>
          </ng-template>
        </tas-table>
      </tas-card>
    </div>
  `,
})
export class SuspicionAlertsPage implements OnInit {
  private readonly _api = inject(ComplianceApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _references = inject(EntityFormReferences);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  public readonly statusOptions = [
    { label: 'Toutes', value: '' },
    { label: 'Nouvelles', value: 'Open' },
    { label: 'En examen', value: 'UnderReview' },
    { label: 'Déclarées à la CENTIF', value: 'Declared' },
    { label: 'Classées sans déclaration', value: 'ClosedWithoutDeclaration' },
  ];

  public readonly status = signal<StatusFilter>('');
  public readonly alerts = signal<SuspicionAlertDto[]>([]);
  public readonly isLoading = signal(true);
  public readonly statusMeta = suspicionAlertStatusMeta;
  public readonly isClosed = isSuspicionAlertClosed;

  public readonly tableConfig: TableConfig = {
    property: 'suspicion-alerts',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 20, pageSizeOptions: [20, 50] },
  };

  // Repli seulement : le serveur renvoie les noms avec l'alerte. L'annuaire ne liste pas tout le
  // monde (le compte racine en est absent) et le responsable conformité n'a pas forcément `user:read`.
  private readonly _users = toSignal(
    this._references.options(FormFieldReferenceTargetEnum.User).pipe(
      map((options) => new Map(options.map((o) => [o.value, o.label] as const))),
      catchError(() => of(new Map<string, string>())),
    ),
    { initialValue: new Map<string, string>() },
  );

  public ngOnInit(): void {
    this._breadcrumb.set([{ label: 'Paramétrage', link: ['/settings'] }, { label: 'Alertes LBC/FT' }]);
    const fromUrl = this._route.snapshot.queryParamMap.get('statut') ?? '';
    this.status.set(STATUS_VALUES.includes(fromUrl as StatusFilter) ? (fromUrl as StatusFilter) : '');
    this._load();
  }

  public onStatusChange(value: StatusFilter): void {
    this.status.set(value);
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { statut: value || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this._load();
  }

  public userName(id: string | null | undefined): string {
    return (id && this._users().get(id)) || 'Agent';
  }

  public formatDate(iso: string | null | undefined): string {
    return iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }

  public open(alert: SuspicionAlertDto): void {
    const ref = this._sideDrawer.open<boolean, HandleSuspicionAlertDrawerData, HandleSuspicionAlertDrawer>(
      HandleSuspicionAlertDrawer,
      {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: {
          alert,
          raisedByName: alert.raisedByName || this.userName(alert.raisedBy),
          handledByName: alert.handledBy ? alert.handledByName || this.userName(alert.handledBy) : null,
        },
      },
    );
    ref.closed.subscribe((handled) => {
      if (handled) this._load();
    });
  }

  /** Le serveur plafonne à 500 alertes : la pagination reste locale. */
  private _load(): void {
    this.isLoading.set(true);
    this._api.listSuspicionAlerts(this.status() || undefined).pipe(
      catchError(() => {
        this.isLoading.set(false);
        this._snackbar.error('Erreur', 'Impossible de charger les alertes LBC/FT.');
        return EMPTY;
      }),
    ).subscribe((rows) => {
      this.alerts.set(rows ?? []);
      this.isLoading.set(false);
    });
  }
}

export default SuspicionAlertsPage;
