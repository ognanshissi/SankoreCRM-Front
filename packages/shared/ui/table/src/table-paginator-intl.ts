import { Injectable, Provider } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';

const NUMBER = new Intl.NumberFormat('fr-FR');

/**
 * Libellés français du paginateur de `tas-table`. Material les fournit en anglais (« Items per
 * page », « 1 – 25 of 120 ») et l'application n'en définissait aucun.
 */
@Injectable()
export class TasPaginatorIntl extends MatPaginatorIntl {
  public override itemsPerPageLabel = 'Éléments par page';
  public override nextPageLabel = 'Page suivante';
  public override previousPageLabel = 'Page précédente';
  public override firstPageLabel = 'Première page';
  public override lastPageLabel = 'Dernière page';

  public override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0 || pageSize === 0) return `0 sur ${NUMBER.format(length)}`;

    const start = page * pageSize;
    // Une page au-delà de la fin (liste qui a rétréci) s'affiche comme la plage demandée.
    const end = start < length ? Math.min(start + pageSize, length) : start + pageSize;
    return `${NUMBER.format(start + 1)} – ${NUMBER.format(end)} sur ${NUMBER.format(length)}`;
  };
}

/** Pour un `mat-paginator` posé hors de `tas-table` : `providers: [provideTasPaginatorIntl()]`. */
export function provideTasPaginatorIntl(): Provider {
  return { provide: MatPaginatorIntl, useClass: TasPaginatorIntl };
}
