import tasksRoutes from './tasks.routes';

export { CompleteTaskDrawer } from './containers/dashboard/complete-task-drawer';
export type { CompleteTaskDrawerData, CompleteTaskDrawerResult } from './containers/dashboard/complete-task-drawer';
export { DeclineTaskDrawer } from './containers/dashboard/decline-task-drawer';
export type { DeclineTaskDrawerData } from './containers/dashboard/decline-task-drawer';
export { TaskDetailDrawer } from './containers/dashboard/task-detail-drawer';
export type { TaskDetailDrawerData, TaskDetailDrawerResult } from './containers/dashboard/task-detail-drawer';
export { NewTaskDrawer } from './containers/task/new-task-drawer';
export type { NewTaskDrawerData } from './containers/task/new-task-drawer';
export { CreateAppointmentDrawer } from './containers/dashboard/create-appointment-drawer';
export type { CreateAppointmentDrawerData } from './containers/dashboard/create-appointment-drawer';
export { PRIORITY_LABELS, STATUS_LABELS } from './containers/task/task-meta';
export { MailComposeDrawer } from './containers/mail/mail-compose-drawer';
export type { MailComposeDrawerData, MailComposeMode } from './containers/mail/mail-compose-drawer';
export { MailSignatureDrawer } from './containers/mail/mail-signature-drawer';
export type { MailSignatureDrawerData } from './containers/mail/mail-signature-drawer';

export default tasksRoutes;