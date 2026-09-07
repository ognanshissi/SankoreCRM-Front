import OverviewComponent from './containers/overview/overview.component';
import { Routes } from '@angular/router';

const settingsRoutes: Routes = [
  {
    path: '',
    loadComponent: () => OverviewComponent,
  }
  ];


export default settingsRoutes;
