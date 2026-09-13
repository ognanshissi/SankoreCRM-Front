import { signal } from '@angular/core';
import { concatMap, finalize, Observable, of, tap } from 'rxjs';


export abstract class AbstractLoading {
  protected readonly _isLoading = signal<boolean>(false);
  public isLoading = this._isLoading.asReadonly();

  public set(value: boolean): void {
    this._isLoading.set(value);
  }

  /**
   * Make http call by showing the loader until the request completed
   * @param obs$
   */
  public showLoaderUntilCompleted<T>(obs$: Observable<T>): Observable<T> {
    return of(null).pipe(
      tap(() => this._isLoading.set(true)),
      concatMap(() => obs$),
      finalize(() => this._isLoading.set(false)),
    );
  }
}
