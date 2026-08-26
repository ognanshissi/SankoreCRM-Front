import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  contentChild,
  ContentChild,
  contentChildren,
  input,
  OnChanges,
  OnInit,
  output,
  SimpleChanges,
  TemplateRef,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { SelectionModel } from '@angular/cdk/collections';
import { TableColumn, TableConfig } from './table-types';
import { TableDataSource } from './table-datasource';
import { TableEntity } from './table-entity';
import { AsyncPipe, NgIf, NgTemplateOutlet } from '@angular/common';
import { RowSelectionMaster } from './row-selection-master';
import { RowSelectionItem } from './row-selection-item';
import { TasSpinner } from '@talisoft/ui/spinner';
import { ButtonModule } from '@talisoft/ui/button';
import { FormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasTitle } from '@talisoft/ui/title';
import { TasText } from '@talisoft/ui/text';

export const DEFAULT_TABLE_CONFIG: TableConfig = {
  property: 'entity',
  pagination: {
    pageSize: 5,
    pageSizeOptions: [5, 10, 30],
    pageIndex: 0,
    serverSide: false,
  },
};

@Component({
  selector: 'tas-table',
  standalone: true,
  templateUrl: `./table.html`,
  styleUrl: './table.scss',
  imports: [
    NgIf,
    NgTemplateOutlet,
    TasSpinner,
    ButtonModule,
    FormField,
    TasIcon,
    TasInput,
    TasTitle,
    TasText,
    TasLabel,
    MatPaginator,
    AsyncPipe,
  ],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TasTable<T extends TableEntity>
  implements OnInit, OnChanges, AfterViewInit
{
  public data = input.required<T[]>();
  public identifierField = input<string>('id');
  public config = input<TableConfig>(DEFAULT_TABLE_CONFIG);
  public columns = input<TableColumn[]>([]);
  public isLoading = input<boolean>(false);

  public title = input<string>();

  public selectionItemsChange = output<T[]>();

  @ViewChild(MatPaginator, { static: true }) paginator!: MatPaginator;

  public pageEventChange = output<PageEvent>();
  public searchInputChange = output<string>();

  public selection: SelectionModel<T> = new SelectionModel<T>(
    true,
    [],
    true,
    (o1, o2) => o1[this.identifierField()] === o2[this.identifierField()]
  );

  public refresh = output();

  public rowSelectionMaster = contentChild<RowSelectionMaster>(
    RowSelectionMaster,
    { descendants: true }
  );

  public rowSelectionItems = contentChildren<RowSelectionItem>(
    RowSelectionItem,
    { descendants: true }
  );

  // ContentChild
  @ContentChild('header') header!: TemplateRef<any>;
  @ContentChild('body') body!: TemplateRef<any>;
  @ContentChild('caption') caption!: TemplateRef<any>;

  public dataSource!: TableDataSource<T>;

  public ngAfterViewInit() {
    // Whenever the selection change emit selectionItems event
    this.selection.changed.subscribe(() => {
      this.selectionItemsChange.emit(this.selection.selected);
    });

    // Master selection
    if (this.rowSelectionMaster() && this.rowSelectionItems()) {
      this._handleMasterSelection();
      this._handleItemSelection();
    }

    this._updateDatasource(this.data());
  }

  private _handleMasterSelection(): void {
    this.rowSelectionMaster()?.valueChange.subscribe((res) => {
      // Check all checkboxes
      this.rowSelectionItems()?.forEach((rowItem) => {
        rowItem.toggle();
      });
      // Select all
      if (res) {
        this.selection.select(...this.data());
      } else {
        this.selection.clear();
      }
    });
  }

  private _handleItemSelection(): void {
    this.rowSelectionItems().map((item: RowSelectionItem, index: number) => {
      const currentItem = this.data().find((el, i) => i === index);
      if (currentItem) {
        item.valueChange.subscribe(() => {
          this.selection.toggle(currentItem);
          this.rowSelectionMaster()?.isChecked.set(
            this.selection.selected.length === this.data().length
          );
        });
      }
    });
  }

  public ngOnInit(): void {
    this._updateDatasource(this.data());
  }

  public pageEvent(event: PageEvent) {
    if (this.config()?.pagination.serverSide) {
      this.pageEventChange.emit(event);
    }
  }

  public ngOnChanges(changes: SimpleChanges) {
    if (!changes['data']?.firstChange) {
      this._updateDatasource(changes['data']?.currentValue);
    }
  }

  public isMasterSelected(): boolean {
    if (!this.data()?.length) return false;
    return this.data()?.length === this.selection.selected.length;
  }

  private _updateDatasource(data: T[]) {
    this.dataSource = new TableDataSource(data);

    this.paginator.pageIndex = this.config()?.pagination?.pageIndex;
    this.paginator.pageSizeOptions = this.config()?.pagination.pageSizeOptions;
    this.paginator.pageSize = this.config()?.pagination.pageSize;

    if (this.config()?.pagination?.serverSide) {
      this.paginator.length =
        this.config()?.pagination.totalElements ?? this.data.length;
    } else {
      this.paginator.length = this.data().length;
    }

    this.dataSource.paginator = this.paginator;
  }
}
