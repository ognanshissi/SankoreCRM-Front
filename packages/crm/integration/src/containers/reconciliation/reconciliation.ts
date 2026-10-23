import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ConnectionListDto } from '@sankore/crm-api';
import { BreadcrumbService, PermissionCode, PermissionsService, TENANT_MODULES, TenantModule, ModuleReadOnlyNotice } from '@sankore/crm/common';
import { TasCard } from '@talisoft/ui/card';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { catchError, EMPTY } from 'rxjs';
import { ReconciliationGapsList } from '../../components/reconciliation-gaps-list';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../../data-access/integration-facade.service';
import { CONNECTION_FAMILY_LABELS } from '../../data-access/integration-referential';

/**
 * INT-35 — Écarts de la comparaison quotidienne CRM / systèmes externes.
 *
 * L'écran se lit de haut en bas : la dernière comparaison, ce qui reste ouvert par
 * type, puis les écarts du plus ancien au plus récent. La liste, les filtres et
 * l'export vivent dans `ReconciliationGapsList`, partagé avec l'écran des
 * bordereaux assurance (ASS-18), de sorte que les deux écrans traitent un écart de
 * la même façon.
 */
@Component({
  templateUrl: './reconciliation.html',
  imports: [ModuleReadOnlyNotice, 
    FormsModule,
    TasCard,
    TasFormField,
    TasLabel,
    TasSelect,
    TasSpinner,
    ReconciliationGapsList,
  ],
})
export class ReconciliationPage implements OnInit {
  /** Module désactivé : l'écran reste consultable, sans action (bandeau en tête). */
  public readonly readOnlyModules: TenantModule[] = [TENANT_MODULES.BANKING_MICROFINANCE, TENANT_MODULES.INSURANCE];
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  public readonly canView = this._permissions.can('Integration.Reconciliation.View');

  /** Passé à la liste partagée : INT-35 résout avec son propre droit. */
  public readonly resolvePermission: PermissionCode = 'Integration.Reconciliation.Resolve';

  public isLoadingConnections = signal(true);
  public connections = signal<ConnectionListDto[]>([]);
  public selectedConnectionId = signal<string | null>(null);

  public readonly connectionOptions = computed(() =>
    this.connections().map((connection) => ({
      label: `${connection.name ?? 'Connexion sans nom'} — ${this._familyLabel(connection.family)}`,
      value: connection.id ?? '',
    })),
  );

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Intégrations', link: ['/settings/integrations'] },
      { label: 'Réconciliation' },
    ]);

    const connectionId = this._route.snapshot.queryParams['connectionId'];
    if (connectionId) this.selectedConnectionId.set(connectionId);

    this._facade
      .listAllConnections()
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.isLoadingConnections.set(false);
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(err, 'Impossible de lire la liste des connexions.'),
          );
          return EMPTY;
        }),
      )
      .subscribe((connections) => {
        this.connections.set(connections);
        this.isLoadingConnections.set(false);
      });
  }

  /** `family` sort du générateur en enum de chaînes : on compare, on n'indexe pas. */
  private _familyLabel(family: string | undefined): string {
    return family === 'Insurance'
      ? CONNECTION_FAMILY_LABELS.Insurance
      : CONNECTION_FAMILY_LABELS.CoreBanking;
  }

  public onConnectionChange(value: string | null): void {
    this.selectedConnectionId.set(value || null);
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { connectionId: this.selectedConnectionId() },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}

export default ReconciliationPage;
