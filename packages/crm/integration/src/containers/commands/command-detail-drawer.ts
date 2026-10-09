import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { IntegrationCommandDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { TasTitle } from '@talisoft/ui/title';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { PermissionsService } from '@sankore/crm/common';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../../data-access/integration-facade.service';
import {
  canCancelCommand,
  canReplayCommand,
  commandStatusMeta,
  commandTypeLabel,
  entityTypeLabel,
  errorFamilyLabel,
} from '../../data-access/integration-referential';
import { commandAgeLabel, REPLAY_CONFIRMATION } from './command-presentation';

export interface CommandDetailDrawerData {
  commandId: string;
  /** Nom de la connexion, déjà résolu par la liste : le détail ne montre pas un UUID nu. */
  connectionName: string | null;
}

export interface CommandDetailDrawerResult {
  commandId: string;
  /** Statut et tentatives retournés par l'action, quand elle a eu lieu dans le drawer. */
  status?: string;
  attempts?: number;
  /** L'annulation demandée ici : la saisie du motif a son propre drawer, ouvert par la liste. */
  requestCancel?: boolean;
  commandType?: string | null;
}

/**
 * Détail d'une commande d'intégration.
 *
 * Le contenu de la commande n'est affiché nulle part et il n'existe aucun endpoint pour
 * l'obtenir : il est chiffré sous la clé du module. `payloadFieldNames` ne donne que les
 * NOMS des champs envoyés — c'est ce qui permet de voir qu'une création client partait
 * sans numéro de pièce, sans exposer la pièce elle-même. L'intitulé du bloc le dit, pour
 * qu'on ne cherche pas une valeur qui n'arrivera jamais.
 */
@Component({
  selector: 'command-detail-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    Button,
    TasIcon,
    TasSpinner,
    TasTag,
    TasTitle,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TimeagoPipe,
  ],
  templateUrl: './command-detail-drawer.html',
})
export class CommandDetailDrawer {
  public readonly data: CommandDetailDrawerData = inject(DIALOG_DATA);

  private readonly _dialogRef = inject(DialogRef<CommandDetailDrawerResult | null>);
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _router = inject(Router);
  private readonly _permissions = inject(PermissionsService);

  public readonly canReplayOrCancel = this._permissions.can('Integration.Command.Replay');

  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  public readonly command = signal<IntegrationCommandDto | null>(null);
  public readonly isActing = signal(false);

  public readonly statusMeta = computed(() => commandStatusMeta(this.command()?.status));
  public readonly typeLabel = computed(() => commandTypeLabel(this.command()?.commandType));
  public readonly entityLabel = computed(() => entityTypeLabel(this.command()?.entityType));
  public readonly errorFamily = computed(() => errorFamilyLabel(this.command()?.errorFamily));
  public readonly age = computed(() => commandAgeLabel(this.command()?.createdAt));
  public readonly fieldNames = computed(() => this.command()?.payloadFieldNames ?? []);

  /** Seul `Customer` a une fiche : pour les autres entités, un lien ne mènerait nulle part. */
  public readonly customerLink = computed(() => {
    const dto = this.command();
    return dto?.entityType === 'Customer' && dto.crmId ? dto.crmId : null;
  });

  public readonly showReplay = computed(
    () => this.canReplayOrCancel() && canReplayCommand(this.command()?.status),
  );

  public readonly showCancel = computed(
    () => this.canReplayOrCancel() && canCancelCommand(this.command()?.status),
  );

  constructor() {
    this._load();
  }

  public close(): void {
    this._dialogRef.close(null);
  }

  public openCustomer(): void {
    const crmId = this.customerLink();
    if (!crmId) return;
    this._dialogRef.close(null);
    this._router.navigate(['/customers', crmId]);
  }

  public openBatchFile(): void {
    const batchFileId = this.command()?.batchFileId;
    if (!batchFileId) return;
    this._dialogRef.close(null);
    this._router.navigate(['/settings/integrations/batch-files'], {
      queryParams: { fileId: batchFileId },
    });
  }

  public confirmReplay(): void {
    this._confirm.confirm({
      title: REPLAY_CONFIRMATION.title,
      message: REPLAY_CONFIRMATION.message,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: REPLAY_CONFIRMATION.acceptLabel, theme: 'primary' },
      rejectButtonProps: { label: 'Fermer' },
      accept: () => this._replay(),
    });
  }

  /** La saisie du motif vit dans son propre drawer : un drawer dans un drawer se perd. */
  public requestCancel(): void {
    this._dialogRef.close({
      commandId: this.data.commandId,
      commandType: this.command()?.commandType ?? null,
      requestCancel: true,
    });
  }

  private _replay(): void {
    this.isActing.set(true);
    this._facade
      .replayCommand(this.data.commandId)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          const message =
            error.status === 409
              ? "Cette commande n'est plus en rejet : elle a déjà été reprise ou annulée. Rechargez la liste."
              : integrationErrorMessage(error, "Le rejeu n'a pas abouti.");
          this._snackbar.error('Rejeu impossible', message);
          this.isActing.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.isActing.set(false);
        this._snackbar.success(
          'Commande remise en file',
          'Elle repart avec un budget de tentatives complet.',
        );
        this._dialogRef.close({
          commandId: result.commandId ?? this.data.commandId,
          status: result.status ?? 'Pending',
          attempts: result.attempts ?? 0,
        });
      });
  }

  private _load(): void {
    this.isLoading.set(true);
    this._facade
      .getCommand(this.data.commandId)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.loadError.set(
            error.status === 404
              ? "Cette commande n'existe plus."
              : integrationErrorMessage(error, "Le détail n'a pas pu être chargé."),
          );
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((dto) => {
        this.command.set(dto);
        this.isLoading.set(false);
      });
  }
}
