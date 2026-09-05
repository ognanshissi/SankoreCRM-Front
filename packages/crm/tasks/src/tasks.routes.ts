import { DashboardComponent } from "./containers/dashboard/dashboard";
import { Route } from "@angular/router";

const tasksRoutes: Route[] = [
  {
    path: 'my-day',
    component: DashboardComponent
  }
];

export default tasksRoutes;