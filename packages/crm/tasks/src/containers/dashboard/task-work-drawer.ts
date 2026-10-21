import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { CrmTaskDto, LeadDto } from '@sankore/crm-api';
import { TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';
import { TaskWorkPanel } from './task-work-panel';

export interface TaskWorkDrawerData {
  task: CrmTaskDto;
  lead: LeadDto | null;
  agentName: string;
}

/**
 * Ce que l'agent a fait dans le panneau. Les suites (recharger, réassigner, ouvrir la fiche) sont
 * jouées par l'hôte, une fois le drawer fermé : ouvrir un drawer depuis un drawer se passe mal.
 */
export type TaskWorkDrawerResult =
  | { action: 'completed' }
  | { action: 'reassign'; task: CrmTaskDto }
  | { action: 'open-lead'; leadId: string };

/**
 * Le panneau de travail d'une tâche, dans un drawer. Il était la colonne de droite de l'ancienne
 * « Ma journée » ; la nouvelle mise en page lui laisse la largeur de la liste, et c'est au clic
 * sur une ligne qu'il s'ouvre. Il garde son rôle : clore la tâche en consignant le résultat de
 * l'appel sur le lead, ce que le drawer « Terminer » des autres écrans ne fait pas.
 */
@Component({
  selector: 'task-work-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasTitle, TaskWorkPanel],
  template: `
    <tas-side-drawer width="560px">
      <tas-drawer-title>
        <tas-title>Traiter la tâche</tas-title>
      </tas-drawer-title>
      <tas-drawer-content>
        <div class="-m-4">
          <task-work-panel
            [task]="data.task"
            [lead]="data.lead"
            [agentName]="data.agentName"
            [now]="now"
            (completed)="close({ action: 'completed' })"
            (reassignRequested)="close({ action: 'reassign', task: $event })"
            (openLeadRequested)="close({ action: 'open-lead', leadId: $event })"
          ></task-work-panel>
        </div>
      </tas-drawer-content>
    </tas-side-drawer>
  `,
})
export class TaskWorkDrawer {
  private readonly _dialogRef = inject<DialogRef<TaskWorkDrawerResult>>(DialogRef);
  public readonly data = inject<TaskWorkDrawerData>(DIALOG_DATA);
  public readonly now = Date.now();

  public close(result: TaskWorkDrawerResult): void {
    this._dialogRef.close(result);
  }
}
