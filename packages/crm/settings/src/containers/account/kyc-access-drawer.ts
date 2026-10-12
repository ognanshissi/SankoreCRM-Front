import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DialogRef } from '@angular/cdk/dialog';
import { Router } from '@angular/router';
import { catchError, of } from 'rxjs';
import { TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { KYCApiService, MyKycAccessDto } from '@sankore/crm-api';
import { describeKycDocumentKind } from './security-labels';

const LIMIT = 30;

interface AccessRow extends MyKycAccessDto {
  key: string;
  kindLabel: string;
}

/** Les 30 dernières pièces KYC ouvertes par l'utilisateur, tirées du journal d'accès. */
@Component({
  selector: 'kyc-access-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasTable],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <p class="text-base font-semibold text-slate-800">Mes {{ limit }} derniers accès</p>
        <p class="text-xs text-slate-400 mt-0.5">Chaque ouverture d'une pièce KYC est enregistrée dans le journal d'audit.</p>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (loadFailed()) {
          <p class="text-sm text-slate-600 py-8 text-center">Le journal n'a pas pu être lu : il n'est pas forcément vide.</p>
        } @else {
          <tas-table [data]="rows()" identifierField="key" [config]="tableConfig" [isLoading]="isLoading()">
            <ng-template #header>
              <tr class="text-left text-xs uppercase tracking-wide text-slate-500">
                <th class="px-3 py-2 font-medium">Date</th>
                <th class="px-3 py-2 font-medium">Client</th>
                <th class="px-3 py-2 font-medium">Pièce</th>
              </tr>
            </ng-template>
            <ng-template #body let-row>
              <tr class="text-sm hover:bg-slate-50 cursor-pointer" (click)="open(row)">
                <td class="px-3 py-2.5 tabular-nums whitespace-nowrap">{{ row.accessedAt | date: 'dd/MM/yyyy HH:mm' }}</td>
                <td class="px-3 py-2.5 text-primary">{{ row.customerName || 'Client inconnu' }}</td>
                <td class="px-3 py-2.5 text-slate-600">{{ row.kindLabel }}</td>
              </tr>
            </ng-template>
          </tas-table>
        }
      </tas-drawer-content>
    </tas-side-drawer>
  `,
})
export class KycAccessDrawer implements OnInit {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _kycApi = inject(KYCApiService);
  private readonly _router = inject(Router);

  public readonly limit = LIMIT;
  public isLoading = signal(true);
  public loadFailed = signal(false);
  public rows = signal<AccessRow[]>([]);
  public readonly tableConfig: TableConfig = {
    property: 'accessedAt',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 30] },
  };

  ngOnInit(): void {
    this._kycApi.getMyKycAccessLog(LIMIT).pipe(
      catchError(() => {
        this.loadFailed.set(true);
        return of([]);
      }),
    ).subscribe((items) => {
      this.rows.set(items.map((item, i) => ({
        ...item,
        key: `${item.accessedAt}-${i}`,
        kindLabel: describeKycDocumentKind(item.documentKind),
      })));
      this.isLoading.set(false);
    });
  }

  public open(row: AccessRow): void {
    if (!row.kycFileId) return;
    this._dialogRef.close();
    this._router.navigate(['/kyc', row.kycFileId]);
  }
}
