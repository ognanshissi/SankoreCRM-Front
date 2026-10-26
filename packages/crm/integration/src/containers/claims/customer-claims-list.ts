import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  input,
  signal,
} from '@angular/core';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { PermissionsService } from '@sankore/crm/common';
import {
  claimNeedsAction,
  claimStatusMeta,
  formatAmount,
  formatContractDate,
} from '../../data-access/integration-referential';
import { HttpErrorResponse } from '@angular/common/http';
import { ClaimDto } from '@sankore/crm-api';
import { catchError, EMPTY, forkJoin, of } from 'rxjs';
import { IntegrationFacadeService, integrationErrorMessage } from '../../data-access/integration-facade.service';

/** Un sinistre tel que la liste le rend : le dossier, avec le produit de sa police. */
type ClaimRow = ClaimDto & { id: string; productName: string };
import {
  ClaimDetailDrawer,
  ClaimDetailDrawerData,
} from '../../components/claim-detail-drawer';

/**
 * Sinistres du client — ASS-17.
 *
 * Section posée sous le bloc « Assurances » de la fiche client : un sinistre se lit en
 * regard des contrats, et l'agent y arrive depuis un contrat.
 *
 * Les dossiers viennent de `GET integration/insurance/claims?crmCustomerId=`, le nom du produit
 * des polices du client (`GET integration/insurance/policies`), lues ensemble.
 */
@Component({
  selector: 'customer-claims-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasAlert, Button, TasCard, TasIcon, TasTable, TasTag, TimeagoPipe],
  template: `
    @if (canViewClaims()) {
      <tas-card class="block">
        <div class="flex items-center gap-2 border-b border-slate-200 p-4">
          <tas-icon
            iconName="feather:alert-circle"
            class="text-primary"
            style="font-size:16px"
          ></tas-icon>
          <p class="text-sm font-medium text-slate-700">Sinistres</p>
          @if (rows().length > 0) {
            <span class="text-xs text-slate-500 tabular-nums">({{ rows().length }})</span>
          }
          @if (needsActionCount() > 0) {
            <tas-tag severity="warning">
              {{ needsActionCount() }} en attente d'une pièce
            </tas-tag>
          }
        </div>

        @if (loadError()) {
          <div class="p-4">
            <tas-alert type="error"><p class="text-sm">{{ loadError() }}</p></tas-alert>
          </div>
        } @else if (!isLoading() && rows().length === 0) {
          <div class="p-6 text-center">
            <p class="text-sm font-medium text-slate-700">Aucun sinistre déclaré</p>
            <p class="mt-1 text-xs text-slate-500">
              {{
                policyId()
                  ? "Déclarez-le avec « Déclarer un sinistre », dans le bloc de la police ci-dessus."
                  : "Déclarez un sinistre depuis la page du contrat concerné (onglet « Contrats »)."
              }}
            </p>
          </div>
        } @else {
          <tas-table [data]="rows()" identifierField="id" [config]="tableConfig()" [isLoading]="isLoading()" [hasCaption]="false">
            <ng-template #header>
              <tr>
                <th>Contrat</th>
                <th>Statut</th>
                <th>Référence assureur</th>
                <th>Survenu le</th>
                <th>Indemnisation</th>
                <th>Mise à jour</th>
                <th class="text-right"></th>
              </tr>
            </ng-template>

            <ng-template #body let-claim>
              <tr
                class="cursor-pointer transition-colors hover:bg-slate-50"
                [class.bg-amber-50]="needsAction(claim)"
                (click)="openDetail(claim)"
              >
                <td class="py-3 text-sm text-slate-800">{{ claim.productName }}</td>
                <td>
                  <tas-tag [severity]="statusSeverity(claim)">{{ statusLabel(claim) }}</tas-tag>
                </td>
                <td class="font-mono text-xs text-slate-600">
                  {{ claim.claimNumber || '—' }}
                </td>
                <td class="text-sm text-slate-600">{{ formatDate(claim.occurredOn) }}</td>
                <td class="text-sm text-slate-800 tabular-nums">
                  {{ settlementLabel(claim) }}
                </td>
                <td class="text-sm text-slate-600">{{ claim.statusChangedAt | dateTimeAgo }}</td>
                <td class="text-right" (click)="$event.stopPropagation()">
                  <button
                    tas-button
                    iconButton
                    type="button"
                    title="Voir le suivi"
                    (click)="openDetail(claim)"
                  >
                    <tas-icon iconName="feather:eye" style="font-size:14px"></tas-icon>
                  </button>
                </td>
              </tr>
            </ng-template>
          </tas-table>
        }
      </tas-card>
    }
  `,
})
export class CustomerClaimsList implements OnInit {
  private readonly _permissions = inject(PermissionsService);
  private readonly _sideDrawer = inject(SideDrawerService);

  private readonly _facade = inject(IntegrationFacadeService);

  public readonly customerId = input.required<string>();
  /** Sur la page d'un contrat : seuls les sinistres de cette police. */
  public readonly policyId = input<string | null>(null);

  public readonly canViewClaims = this._permissions.can('Ins.Claim.View', 'Ins.Claim.Declare');

  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  public readonly rows = signal<ClaimRow[]>([]);

  public readonly needsActionCount = computed(
    () => this.rows().filter((r) => claimNeedsAction(r.status)).length,
  );

  /** Collection reçue en entier : pagination locale, donc pas de `(pageEventChange)`. */
  public readonly tableConfig = computed<TableConfig>(() => ({
    property: 'id',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [10, 25, 50],
      totalElements: this.rows().length,
    },
  }));

  public ngOnInit(): void {
    this.load();
  }

  public load(): void {
    if (!this.canViewClaims()) return;

    this.isLoading.set(true);
    this.loadError.set(null);
    forkJoin({
      claims: this._facade.listClaims({ crmCustomerId: this.customerId() }),
      // Le nom du produit seulement : une police illisible ne doit pas cacher les dossiers.
      policies: this._facade.listPolicies(this.customerId()).pipe(catchError(() => of([]))),
    })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.loadError.set(integrationErrorMessage(err, "Les sinistres n'ont pas pu être lus."));
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ claims, policies }) => {
        const products = new Map(policies.map((p) => [p.id, p.productName ?? p.policyNumber ?? '—']));
        const policyId = this.policyId();
        this.rows.set(
          claims.filter((claim) => !policyId || claim.policyId === policyId).map((claim) => ({
            ...claim,
            id: claim.id ?? '',
            productName: products.get(claim.policyId) ?? 'Contrat',
          })),
        );
        this.isLoading.set(false);
      });
  }

  public statusLabel(claim: ClaimRow): string {
    return claimStatusMeta(claim.status).label;
  }

  public statusSeverity(claim: ClaimRow): Severity {
    return claimStatusMeta(claim.status).severity;
  }

  public needsAction(claim: ClaimRow): boolean {
    return claimNeedsAction(claim.status);
  }

  public formatDate(value: string | null | undefined): string {
    return formatContractDate(value);
  }

  public settlementLabel(claim: ClaimRow): string {
    return formatAmount(claim.indemnityAmount, claim.indemnityCurrency);
  }

  public openDetail(claim: ClaimRow): void {
    this._sideDrawer.open(ClaimDetailDrawer, {
      data: {
        claimId: claim.id,
        productName: claim.productName,
      } satisfies ClaimDetailDrawerData,
    });
  }
}
