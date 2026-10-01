import tasksRoutes from './tasks.routes';

export { CompleteTaskDrawer } from './containers/dashboard/complete-task-drawer';
export type { CompleteTaskDrawerData, CompleteTaskDrawerResult } from './containers/dashboard/complete-task-drawer';
export { DeclineTaskDrawer } from './containers/dashboard/decline-task-drawer';
export type { DeclineTaskDrawerData } from './containers/dashboard/decline-task-drawer';
export { TaskDetailDrawer } from './containers/dashboard/task-detail-drawer';
export type { TaskDetailDrawerData, TaskDetailDrawerResult } from './containers/dashboard/task-detail-drawer';
export { CreateTaskDrawer } from './containers/dashboard/create-task-drawer';
export type { CreateTaskDrawerData } from './containers/dashboard/create-task-drawer';

export default tasksRoutes;