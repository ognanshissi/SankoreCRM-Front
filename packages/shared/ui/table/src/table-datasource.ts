import { DataSource } from '@angular/cdk/collections';
import { MatPaginator } from '@angular/material/paginator';
import { MatSort } from '@angular/material/sort';
import { merge, Observable, of as observableOf } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Data source for the DataTable view. This class should
 * encapsulate all logic for fetching and manipulating the displayed data
 * (including sorting, pagination, and filtering).
 */
export class TableDataSource<TEntity> extends DataSource<TEntity> {
  paginator: MatPaginator | undefined;
  sort: MatSort | undefined;

  constructor(public data: TEntity[]) {
    super();
  }

  /**
   * Connect this data source to the table. The table will only update when
   * the returned stream emits new items.
   * @returns A stream of the items to be rendered.
   */
  connect(): Observable<TEntity[]> {
    if (this.paginator) {
      // Combine everything that affects the rendered data into one update
      // stream for the data-table to consume.
      return merge(observableOf(this.data), this.paginator.page).pipe(
        map(() => {
          return this.getPagedData([...this.data]);
        })
      );
    } else {
      throw Error(
        'Please set the paginator and sort on the data source before connecting.'
      );
    }
  }

  /**
   *  Called when the table is being destroyed. Use this function, to clean up
   * any open connections or free any held resources that were set up during connect.
   */
  disconnect(): void {}

  /**
   * Paginate the data (client-side). If you're using server-side pagination,
   * this would be replaced by requesting the appropriate data from the server.
   */
  private getPagedData(data: TEntity[]): TEntity[] {
    if (this.paginator) {
      const startIndex = this.paginator.pageIndex * this.paginator.pageSize;
      return data.splice(startIndex, this.paginator.pageSize);
    } else {
      return data;
    }
  }

  /**
   * Sort the data (client-side). If you're using server-side sorting,
   * this would be replaced by requesting the appropriate data from the server.
   */
  private getSortedData(data: TEntity[]): TEntity[] {
    if (!this.sort || !this.sort.active || this.sort.direction === '') {
      return data;
    }

    return data;
    // const sortableFields = this.columns.map((col) => col.sortable);

    // return data.sort((a, b) => {
    //   const isAsc = this.sort?.direction === 'asc';

    //   switch (this.sort?.active) {
    //     case 'name':
    //       return compare(a.name, b.name, isAsc);
    //     case 'id':
    //       return compare(+a.id, +b.id, isAsc);
    //     default:
    //       return 0;
    //   }
    // });
  }
}

/** Simple sort comparator for example ID/Name columns (for client-side sorting). */
// function compare(
//   a: string | number,
//   b: string | number,
//   isAsc: boolean
// ): number {
//   return (a < b ? -1 : 1) * (isAsc ? 1 : -1);
// }
