import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe, LowerCasePipe } from '@angular/common';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Router } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasAlert } from '@talisoft/ui/alert';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { TasTitle } from '@talisoft/ui/title';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import {
  BatchFileRow,
  PendingIntegrationEndpoints,
} from '../../data-access/pending-endpoints';
import { acknowledgementView, batchDirectionLabel } from './batch-file-acknowledgement';

export interface BatchFileDetailDrawerData {
  file: BatchFileRow;
  connectionName: string | null;
  acknowledgementDueHours: number | null;
}

/** Une table a besoin d'objets : la liste des commandes contenues arrive en identifiants nus. */
interface ContainedCommand {
  commandId: string;
}

/**
 * Détail d'un fichier batch : ses coordonnées et les commandes qu'il transporte.
 *
 * Les commandes contenues viennent de `PendingIntegrationEndpoints` comme la liste
 * elle-même (voir le commentaire en tête de `batch-files-homepage.ts`). Le lien vers
 * l'écran Commandes porte la connexion du fichier et non l'identifiant des commandes :
 * `GET /commands` ne filtre pas par `commandId`, seulement par connexion, statut, type,
 * entité et période.
 */
@Component({
  selector: 'batch-file-detail-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    LowerCasePipe,
    Button,
    TasAlert,
    TasIcon,
    TasSpinner,
    TasTable,
    TasTag,
    TasTitle,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
  ],
  templateUrl: './batch-file-detail-drawer.html',
})
export class BatchFileDetailDrawer {
  public readonly data: BatchFileDetailDrawerData = inject(DIALOG_DATA);

  private readonly _dialogRef = inject(DialogRef<null>);
  private readonly _router = inject(Router);
  private readonly _pending = new PendingIntegrationEndpoints();

  public readonly isPending = PendingIntegrationEndpoints.isPending;
  public readonly directionLabel = batchDirectionLabel(this.data.file.direction);

  public readonly isLoading = signal(true);
  public readonly commands = signal<ContainedCommand[]>([]);

  public readonly acknowledgement = computed(() =>
    acknowledgementView(this.data.file, this.data.acknowledgementDueHours),
  );

  public tableConfig = signal<TableConfig>({
    property: 'commandId',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [10, 20, 50],
      totalElements: 0,
    },
  });

  constructor() {
    this._pending
      .listBatchFileCommandIds()
      .pipe(
        catchError(() => {
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((ids) => {
        this.commands.set(ids.map((commandId) => ({ commandId })));
        this.isLoading.set(false);
      });
  }

  public close(): void {
    this._dialogRef.close(null);
  }

  /** Les écritures de ce fichier, dans l'écran qui sait les rejouer. */
  public openCommands(): void {
    this._dialogRef.close(null);
    this._router.navigate(['/settings/integrations/commands'], {
      queryParams: { connectionId: this.data.file.connectionId, status: '' },
    });
  }
}
