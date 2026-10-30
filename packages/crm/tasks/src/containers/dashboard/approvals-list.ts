import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { catchError, EMPTY, finalize } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { WorkflowInstancesApiService } from '@sankore/crm-api';
import { ApprovalItem } from './my-approvals.service';

/**
 * L'onglet « Approbations » de Mes tâches.
 *
 * Un dossier KYC s'EXAMINE sur sa fiche, onglet Validation : c'est là que la décision est prise,
 * avec les pièces et le score sous les yeux, et là que le module KYC vérifie que la personne peut
 * signer cet échelon. Une étape de workflow ordinaire peut, elle, être approuvée ou rejetée d'ici.
 */
@Component({
  selector: 'tasks-approvals-list',
  templateUrl: './approvals-list.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Button, TasIcon, TasTable, TimeagoPipe],
})
export class ApprovalsList {
  private readonly _router = inject(Router);
  private readonly _workflows = inject(WorkflowInstancesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public readonly items = input.required<ApprovalItem[]>();
  public readonly kycAwaitingTotal = input(0);
  public readonly isLoading = input(false);
  public readonly now = input(Date.now());

  /** Une approbation a été traitée d'ici : le parent recharge la liste et les compteurs. */
  public readonly changed = output<void>();

  public readonly actingId = signal<string | null>(null);

  public readonly tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 20, pageSizeOptions: [10, 20, 50] },
  });

  public isOverdue(item: ApprovalItem): boolean {
    return !!item.dueAt && new Date(item.dueAt).getTime() < this.now();
  }

  public examineKyc(kycFileId: string): void {
    this._router.navigate(['/kyc', kycFileId], { queryParams: { tab: 'validation' } });
  }

  public openInstance(item: ApprovalItem): void {
    if (item.kind !== 'workflow' || !item.step.instanceId) return;
    this._router.navigate(['/settings/workflows/instances', item.step.instanceId]);
  }

  public decide(item: ApprovalItem, approve: boolean): void {
    if (item.kind !== 'workflow' || !item.step.instanceId) return;
    const instanceId = item.step.instanceId;

    this._confirm.confirm({
      title: approve ? 'Approuver cette étape ?' : 'Rejeter cette étape ?',
      message: approve
        ? `« ${item.title} » passera à l'étape suivante du workflow.`
        : `« ${item.title} » sera rejetée et le workflow s'arrêtera là.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: approve ? 'Approuver' : 'Rejeter', theme: approve ? 'primary' : 'warn' },
      rejectButtonProps: { label: 'Annuler', theme: 'primary' },
      accept: () => {
        this.actingId.set(item.id);
        const request$ = approve
          ? this._workflows.approveWorkflowStep(instanceId, { comment: null })
          : this._workflows.rejectWorkflowStep(instanceId, { comment: null });
        request$
          .pipe(
            catchError((err: HttpErrorResponse) => {
              // Le serveur explique un refus (rôle requis, instance close) : on le relaie tel quel.
              this._snackbar.error(
                approve ? 'Approbation impossible' : 'Rejet impossible',
                err.error?.error ?? err.error?.detail ?? 'L’étape n’a pas pu être traitée.',
              );
              return EMPTY;
            }),
            finalize(() => this.actingId.set(null)),
          )
          .subscribe(() => {
            this._snackbar.success(approve ? 'Étape approuvée' : 'Étape rejetée', item.title);
            this.changed.emit();
          });
      },
    });
  }
}
