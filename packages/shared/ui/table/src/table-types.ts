export interface TableColumn {
  prop: string;
  label: string;
}

export interface TableConfig {
  property: string;
  pagination: TablePagingConfig;
}

export interface TablePagingConfig {
  serverSide: boolean;
  pageIndex: number;
  pageSize: number;
  totalElements?: number;
  pageSizeOptions: number[];
}
