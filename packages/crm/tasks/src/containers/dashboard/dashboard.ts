import { Component, inject, OnInit } from '@angular/core';
import { TasTitle } from '@talisoft/ui/title';
import { BreadcrumbService } from '@sankore/crm/common';

@Component({
    templateUrl: './dashboard.html',
    imports: [
        TasTitle
    ],
})
export class DashboardComponent implements OnInit {
  private readonly _breadcrumbService = inject(BreadcrumbService);

  ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Ma journée' }]);
  }
}

