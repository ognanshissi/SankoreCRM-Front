import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ComplaintDto, ComplaintReportDto } from '@sankore/crm-api';
import { BreadcrumbService, PERMISSIONS, PermissionsService, TENANT_MODULES, TenantModulesService, TenantModule, ModuleReadOnlyNotice } from '@sankore/crm/common';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { firstValueFrom } from 'rxjs';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../../data-access/integration-facade.service';
import {
  complaintActionLabel,
  complaintStatusMeta,
  formatContractDate,
} from '../../data-access/integration-referential';
import {
  ComplaintAction,
  ComplaintActionDrawer,
  ComplaintActionDrawerData,
} from './complaint-action-drawer';
import { RecordComplaintDrawer, RecordComplaintDrawerData } from './record-complaint-drawer';

/** Une réclamation, enrichie de sa lecture. */
interface ComplaintRow {
  id: string;
  complaint: ComplaintDto;
  statusLabel: string;
  statusSeverity: Severity;
  actionLabel: string | null;
  actionSeverity: Severity | null;
  canAdvance: boolean;
}

type RegisterFilter = 'open' | 'overdue' | 'all';

/**
 * Le registre des réclamations — mécanisme du règlement n° 01/CIMA/PCMA/CE/SG/2024.
 *
 * **Le registre et le rapport sont deux lectures du même mécanisme**, et l'écran les
 * montre ensemble parce qu'un superviseur demande les deux : la liste dit quoi faire
 * aujourd'hui, le rapport dit comment l'institution se comporte sur une fenêtre.
 *
 * La fenêtre du rapport est le mois courant par défaut, parce que c'est la maille sur
 * laquelle les chiffres sont demandés. Les manquements comptés par le serveur incluent
 * les étapes ENCORE À FAIRE passé leur date, et pas seulement celles faites en retard —
 * sans quoi un mécanisme améliorerait ses chiffres en n'accusant jamais réception.
 */
@Component({
  templateUrl: './complaints-register.html',
  imports: [ModuleReadOnlyNotice, 
    FormsModule,
    TasAlert,
    Button,
    TasCard,
    TasSpinner,
    TasTable,
    TasTag,
    TimeagoPipe,
  ],
})
export class ComplaintsRegisterPage implements OnInit {
  /** Module désactivé : l'écran reste consultable, sans action (bandeau en tête). */
  public readonly readOnlyModules: TenantModule[] = [TENANT_MODULES.INSURANCE];
  /** Module désactivé : consultation seule, les actions se masquent (le serveur les refuserait). */
  private readonly _moduleReadOnly = inject(TenantModulesService).readOnly(TENANT_MODULES.INSURANCE);
  private readonly _integration = inject(IntegrationFacadeService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sideDrawer = inject(SideDrawerService);

  public readonly canView = this._permissions.can(PERMISSIONS.INS_COMPLAINT_VIEW);

  /** Déposer et faire avancer demandent le droit d'ÉCRITURE, pas celui de lecture. */
  private readonly _canHandlePermission = this._permissions.can(PERMISSIONS.INS_COMPLAINT_HANDLE);
  public readonly canHandle = computed(() => this._canHandlePermission() && !this._moduleReadOnly());

  public readonly isLoading = signal(true);
  public readonly isLoadingReport = signal(true);
  public readonly complaints = signal<ComplaintDto[]>([]);
  public readonly report = signal<ComplaintReportDto | null>(null);
  public readonly filter = signal<RegisterFilter>('open');

  /** Bornes de la fenêtre du rapport, en `yyyy-MM-dd`. */
  public readonly from = signal(firstDayOfThisMonth());
  public readonly to = signal(today());

  public readonly rows = computed<ComplaintRow[]>(() =>
    this.complaints().map((complaint) => {
      const status = complaintStatusMeta(complaint.status);
      const action = complaintActionLabel(complaint);

      return {
        id: complaint.id ?? complaint.reference ?? '',
        complaint,
        statusLabel: status.label,
        statusSeverity: status.severity,
        actionLabel: action?.label ?? null,
        actionSeverity: action?.severity ?? null,
        // Un dossier répondu ou retiré ne bouge plus : le serveur refuse par 409, donc
        // l'écran ne propose pas les boutons.
        canAdvance: complaint.status !== 'Resolved' && complaint.status !== 'Closed',
      };
    }),
  );

  /**
   * Les manquements des deux délais, additionnés. Calculé ici et non dans le gabarit
   * parce que chaque champ du DTO généré est optionnel — le générateur ne reporte pas la
   * non-nullabilité du serveur — et qu'une addition de deux `number | undefined` ne
   * compile pas.
   */
  public readonly breachCount = computed(() => {
    const r = this.report();
    if (!r) return 0;
    return (r.acknowledgementBreaches ?? 0) + (r.resolutionBreaches ?? 0);
  });

  public readonly openCount = computed(
    () => this.rows().filter((r) => r.canAdvance).length,
  );

  public readonly overdueCount = computed(
    () =>
      this.rows().filter(
        (r) => r.complaint.acknowledgementOverdue || r.complaint.resolutionOverdue,
      ).length,
  );

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramètres', link: ['/settings'] },
      { label: 'Intégrations', link: ['/settings', 'integrations'] },
      { label: 'Réclamations' },
    ]);

    if (!this.canView()) {
      this.isLoading.set(false);
      this.isLoadingReport.set(false);
      return;
    }

    void this.reload();
    void this.reloadReport();
  }

  public setFilter(value: RegisterFilter): void {
    this.filter.set(value);
    void this.reload();
  }

  public async reload(): Promise<void> {
    this.isLoading.set(true);

    const current = this.filter();

    try {
      this.complaints.set(
        await firstValueFrom(
          this._integration.listComplaints({
            // `overdueOnly` implique `openOnly` côté serveur, donc les deux ne sont
            // jamais passés ensemble.
            openOnly: current === 'open',
            overdueOnly: current === 'overdue',
          }),
        ),
      );
    } catch (error) {
      this.complaints.set([]);
      this._snackbar.error(
        'Registre indisponible',
        integrationErrorMessage(error as HttpErrorResponse, "Le registre n'a pas pu être lu."),
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  public async reloadReport(): Promise<void> {
    this.isLoadingReport.set(true);

    try {
      this.report.set(
        await firstValueFrom(this._integration.getComplaintReport(this.from(), this.to())),
      );
    } catch {
      // Silencieux, contrairement au registre : le rapport est une lecture secondaire,
      // et une erreur bruyante ici masquerait la liste qui, elle, a chargé.
      this.report.set(null);
    } finally {
      this.isLoadingReport.set(false);
    }
  }

  public recordComplaint(): void {
    this._sideDrawer
      .open(RecordComplaintDrawer, { data: {} satisfies RecordComplaintDrawerData })
      .closed.subscribe((saved) => {
        if (saved) {
          void this.reload();
          void this.reloadReport();
        }
      });
  }

  /** L'accusé de réception ne demande aucun texte : pas de drawer pour lui. */
  public async acknowledge(row: ComplaintRow): Promise<void> {
    try {
      await firstValueFrom(this._integration.acknowledgeComplaint(row.complaint.id!));

      this._snackbar.success(
        'Accusé de réception enregistré',
        'La réponse reste due, et son délai court.',
      );

      await this.reload();
      await this.reloadReport();
    } catch (error) {
      this._snackbar.error(
        'Accusé non enregistré',
        integrationErrorMessage(error as HttpErrorResponse, "L'accusé n'a pas pu être enregistré."),
      );
    }
  }

  public advance(row: ComplaintRow, action: ComplaintAction): void {
    this._sideDrawer
      .open(ComplaintActionDrawer, {
        data: {
          complaintId: row.complaint.id!,
          reference: row.complaint.reference ?? '—',
          subject: row.complaint.subject ?? '',
          action,
        } satisfies ComplaintActionDrawerData,
      })
      .closed.subscribe((saved) => {
        if (saved) {
          void this.reload();
          void this.reloadReport();
        }
      });
  }

  public formatDate(value: string | null | undefined): string {
    return formatContractDate(value);
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfThisMonth(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

export default ComplaintsRegisterPage;
