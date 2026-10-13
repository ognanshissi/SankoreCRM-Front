import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag, Severity } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  KYCApiService,
  KycAutoApprovalControlItem,
  KycAutoApprovalControlPage,
} from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { RecordKycAutoApprovalControlDrawer } from './record-kyc-auto-approval-control-drawer';

const STATUS_META: Record<string, { label: string; severity: Severity }> = {
  Pending: { label: 'À contrôler', severity: 'warning' },
  Compliant: { label: 'Conforme', severity: 'success' },
  NonCompliant: { label: 'Non conforme', severity: 'error' },
};

/**
 * La file de contrôle a posteriori des approbations automatiques (KRM-B-11).
 *
 * **Pourquoi cet écran existe alors que le cahier n'en décrit aucun.** La story demande que le
 * dossier tiré soit « marqué à contrôler dans une file conformité » et que le constat soit
 * « consigné » : une table que personne ne peut lire ne satisfait ni l'un ni l'autre, et c'est
 * précisément la pièce qu'un régulateur demande à voir. Les endpoints sans écran auraient été un
 * dispositif de contrôle qui n'est pas exerçable.
 *
 * **Ce que l'écran ne montre pas, et c'est voulu** : ni score, ni flag, ni champ lu sur la pièce.
 * Le contrat ne les renvoie pas — une file de conformité est exactement le genre de liste qui
 * finit exportée et collée dans un ticket. L'officier ouvre le dossier, où ces valeurs sont
 * derrière les permissions qui les gardent.
 *
 * **La version de politique est colonne de plein droit.** La question du régulateur est « sous
 * quelles règles cette relation a-t-elle été nouée sans humain », et une approbation de l'an
 * dernier a été prise sous des conditions que le service n'applique plus.
 */
@Component({
  selector: 'kyc-auto-approval-controls',
  imports: [
    DatePipe,
    FormsModule,
    TasCard,
    TasIcon,
    TasTag,
    Button,
    TasSelect,
    TasSpinner,
    TasTable,
  ],
  templateUrl: './kyc-auto-approval-controls.html',
})
export class KycAutoApprovalControlsPage implements OnInit {
  private readonly _kycApi = inject(KYCApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);

  public readonly canControl = this._permissions.can('kyc:auto-approval:control');

  public isLoading = signal(true);
  public loadError = signal('');
  public rows = signal<KycAutoApprovalControlItem[]>([]);
  public totalCount = signal(0);
  public pendingCount = signal(0);

  /**
   * L'écran ouvre sur `Pending` : c'est la liste de travail. Les deux autres états servent à
   * montrer à un régulateur ce qui A été contrôlé, et c'est un autre geste.
   */
  public filterStatus = signal<string>('Pending');

  private readonly _pageIndex = signal(0);
  private readonly _pageSize = signal(20);

  public readonly statusOptions = [
    { value: 'Pending', label: 'À contrôler' },
    { value: 'Compliant', label: 'Conforme' },
    { value: 'NonCompliant', label: 'Non conforme' },
    { value: '', label: 'Tous' },
  ];

  public readonly tableConfig = computed<TableConfig>(() => ({
    property: 'id',
    pagination: {
      serverSide: true,
      pageIndex: this._pageIndex(),
      pageSize: this._pageSize(),
      pageSizeOptions: [10, 20, 50],
      totalElements: this.totalCount(),
    },
  }));

  public readonly isEmpty = computed(
    () => !this.isLoading() && !this.loadError() && this.rows().length === 0,
  );

  public statusMeta(status: string | undefined) {
    return (
      STATUS_META[status ?? ''] ?? { label: status ?? '—', severity: 'neutral' as Severity }
    );
  }

  ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'KYC', link: ['/kyc'] },
      { label: 'Contrôle des validations automatiques' },
    ]);

    this.load();
  }

  public load(): void {
    this.isLoading.set(true);
    this.loadError.set('');

    this._kycApi
      .listKycAutoApprovalControls(
        this.filterStatus() || undefined,
        this._pageIndex() + 1,
        this._pageSize(),
      )
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.loadError.set(
            error.status === 403
              ? "Vous n'avez pas le droit de contrôler les validations automatiques."
              : "La file de contrôle n'a pas pu être lue.",
          );
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((page: KycAutoApprovalControlPage) => {
        this.rows.set(page.rows ?? []);
        this.totalCount.set(page.totalCount ?? 0);
        this.pendingCount.set(page.pendingCount ?? 0);
        this.isLoading.set(false);
      });
  }

  public onStatusChange(status: string): void {
    this.filterStatus.set(status);
    this._pageIndex.set(0);
    this.load();
  }

  public onPageChange(event: { pageIndex: number; pageSize: number }): void {
    this._pageIndex.set(event.pageIndex);
    this._pageSize.set(event.pageSize);
    this.load();
  }

  /** Le dossier lui-même : le score, les flags et les pièces sont là, derrière leurs droits. */
  public openFile(row: KycAutoApprovalControlItem): void {
    this._router.navigate(['/kyc', row.kycFileId]);
  }

  public recordFinding(row: KycAutoApprovalControlItem): void {
    const ref = this._drawer.open(RecordKycAutoApprovalControlDrawer, {
      width: '520px',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { control: row },
    });

    ref.closed.subscribe((recorded: unknown) => {
      if (recorded !== true) return;

      this._snackbar.success(
        'Constat enregistré',
        'Le contrôle est consigné et ne peut plus être modifié.',
      );

      this.load();
    });
  }
}

export default KycAutoApprovalControlsPage;
