import OverviewComponent from './containers/overview/overview.component';
import { Routes } from '@angular/router';
import AgenciesHomePage from './containers/agencies/agencies-homepage/agencies-homepage';

const settingsRoutes: Routes = [
    {
      path: '',
      loadComponent: () => OverviewComponent,
    },
    {
      path: 'agencies',
      loadComponent: () => AgenciesHomePage,
    }
  ];


export default settingsRoutes;
