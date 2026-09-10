import { Component, signal } from '@angular/core';
import { TasTitle } from '@talisoft/ui/title';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TableConfig, TasTable } from '@talisoft/ui/table';

@Component({
  templateUrl: './agencies-homepage.html',
  imports: [TasTitle, Button, TasIcon, TasCard, TasTable],
})
export class AgenciesHomePage {

  public isLoading = signal(false)

  public tableConfig: TableConfig = {
    property: 'id',
    pagination: {
      serverSide: true,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [5, 10, 30, 50],
      totalElements: 0,
    },
  };
}


export default AgenciesHomePage;
