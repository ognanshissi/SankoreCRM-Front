import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { catchError, EMPTY } from 'rxjs';
import { NurturingSequenceDto, NurturingSequencesApiService } from '@sankore/crm-api';
import { BreadcrumbService, nurturingSummary, PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasSwitch } from '@talisoft/ui/switch';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { EditNurturingSequenceDrawer } from './edit-nurturing-sequence-drawer';

/**
 * Les séquences d'e-mails proposées quand on place un lead en nurturing. Sans cet écran aucune
 * séquence ne pouvait exister : le lead changeait de statut et ne recevait rien.
 */
@Component({
  selector: 'nurturing-sequences',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasCard, TasTable, TasTag, TasIcon, TasSwitch, TasSpinner, Button],
  template: `
    <div class="flex flex-col gap-4 pb-6">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-xl font-bold text-slate-900">Séquences de nurturing</h1>
          <p class="mt-1 text-sm text-slate-500">
            Les e-mails envoyés automatiquement à un prospect qui n'est pas encore prêt. Seuls les leads avec un
            consentement marketing actif et une adresse e-mail peuvent y être placés.
          </p>
        </div>
        @if (canManage()) {
          <button tas-raised-button color="primary" type="button" class="shrink-0" (click)="open(null)">
            <tas-icon iconName="feather:plus" style="font-size:14px"></tas-icon>
            Nouvelle séquence
          </button>
        }
      </div>

      @if (isLoading()) {
        <div class="flex justify-center py-24"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
      } @else if (sequences().length === 0) {
        <tas-card class="block">
          <div class="flex flex-col items-center justify-center py-12 text-center">
            <tas-icon iconName="feather:send" class="mb-2 text-slate-300" style="font-size:28px"></tas-icon>
            <p class="text-sm text-slate-500">Aucune séquence pour l'instant.</p>
            <p class="mt-1 text-xs text-slate-400">Tant qu'il n'y en a pas, aucun lead ne peut être placé en nurturing.</p>
          </div>
        </tas-card>
      } @else {
        <tas-card class="block">
          <tas-table [data]="sequences()" [config]="tableConfig" [hasCaption]="false">
            <ng-template #header>
              <tr>
                <th>Séquence</th>
                <th>Envois</th>
                <th>Leads en cours</th>
                <th>État</th>
                <th></th>
              </tr>
            </ng-template>
            <ng-template #body let-item>
              <tr class="align-top" [class.opacity-60]="!item.isActive">
                <td class="py-3 max-w-md">
                  <p class="text-sm font-semibold text-slate-900">{{ item.name }}</p>
                  @if (item.description) {
                    <p class="mt-0.5 text-xs text-slate-500 line-clamp-2">{{ item.description }}</p>
                  }
                </td>
                <td class="py-3 text-sm text-slate-700">{{ summary(item.steps) }}</td>
                <td class="py-3 text-sm tabular-nums text-slate-700">{{ item.activeEnrollments ?? 0 }}</td>
                <td class="py-3">
                  @if (canManage()) {
                    <tas-switch
                      [checked]="item.isActive ?? false"
                      [ariaLabel]="(item.isActive ? 'Désactiver ' : 'Activer ') + item.name"
                      [isLoading]="togglingId() === item.id"
                      (toggle)="toggle(item, $event)"
                    ></tas-switch>
                  } @else {
                    <tas-tag [severity]="item.isActive ? 'success' : 'neutral'">{{ item.isActive ? 'Active' : 'Désactivée' }}</tas-tag>
                  }
                </td>
                <td class="py-3 text-right">
                  @if (canManage()) {
                    <button tas-button iconButton type="button" [attr.aria-label]="'Modifier ' + item.name" (click)="open(item)">
                      <tas-icon iconName="feather:edit-2" style="font-size:14px"></tas-icon>
                    </button>
                  }
                </td>
              </tr>
            </ng-template>
          </tas-table>
        </tas-card>
      }
    </div>
  `,
})
export class NurturingSequencesPage implements OnInit {
  private readonly _api = inject(NurturingSequencesApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly canManage = inject(PermissionsService).can('lead:nurturing-sequence:manage');
  public readonly summary = nurturingSummary;

  public readonly isLoading = signal(true);
  public readonly sequences = signal<NurturingSequenceDto[]>([]);
  public readonly togglingId = signal<string | null>(null);

  public readonly tableConfig: TableConfig = {
    property: 'nurturing-sequences',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 20, pageSizeOptions: [20, 50] },
  };

  public ngOnInit(): void {
    this._breadcrumb.set([{ label: 'Paramétrage', link: ['/settings'] }, { label: 'Séquences de nurturing' }]);
    this._load();
  }

  public open(sequence: NurturingSequenceDto | null): void {
    const ref = this._sideDrawer.open<boolean, NurturingSequenceDto | null, EditNurturingSequenceDrawer>(EditNurturingSequenceDrawer, {
      width: '560px', height: '100%', panelClass: 'side-drawer-panel', data: sequence,
    });
    ref.closed.subscribe((saved) => {
      if (!saved) return;
      this._snackbar.success(sequence ? 'Séquence modifiée' : 'Séquence créée', 'Elle est prise en compte dès le prochain envoi.');
      this._load();
    });
  }

  public toggle(sequence: NurturingSequenceDto, active: boolean): void {
    if (active) {
      this._toggle(sequence, true);
      return;
    }
    const enrolled = sequence.activeEnrollments ?? 0;
    this._confirmDialog.confirm({
      title: 'Désactiver cette séquence ?',
      message: enrolled > 0
        ? `${enrolled} lead(s) la suivent : leur parcours s'arrêtera à leur prochain envoi, et il ne reprendra pas si vous la réactivez.`
        : 'Elle ne sera plus proposée quand on place un lead en nurturing.',
      closable: true, showCancelButton: true,
      acceptButtonProps: { label: 'Désactiver', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._toggle(sequence, false),
    });
  }

  private _toggle(sequence: NurturingSequenceDto, active: boolean): void {
    this.togglingId.set(sequence.id ?? null);
    const request = active
      ? this._api.activateNurturingSequence(sequence.id!)
      : this._api.deactivateNurturingSequence(sequence.id!);
    request.pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Opération échouée.');
        this.togglingId.set(null);
        return EMPTY;
      }),
    ).subscribe(() => {
      this.togglingId.set(null);
      this.sequences.update((list) => list.map((s) => (s.id === sequence.id ? { ...s, isActive: active } : s)));
    });
  }

  private _load(): void {
    this._api.listNurturingSequences().pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de charger les séquences.');
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((sequences) => {
      this.sequences.set(sequences ?? []);
      this.isLoading.set(false);
    });
  }
}

export default NurturingSequencesPage;
