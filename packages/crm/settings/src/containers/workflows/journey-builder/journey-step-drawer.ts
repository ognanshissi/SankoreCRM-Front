import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { WorkflowStepDto } from '@sankore/crm-api';
import { TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { ConditionFieldOption } from './journey-model';
import { JourneyStepPanel } from './step-panel';

export interface JourneyStepDrawerData {
  templateId: string;
  step: WorkflowStepDto;
  roleOptions: { label: string; value: string }[];
  waitEvents: { label: string; value: string }[];
  conditionFields: ConditionFieldOption[];
  formFieldOptions: { label: string; value: string }[];
  entityType: string | null;
  readOnly: boolean;
  /** Chaque enregistrement automatique du panneau, pour que le canevas suive. */
  onUpdated: (step: WorkflowStepDto) => void;
}

/**
 * Les propriétés d'une étape, dans un tiroir : le canevas garde toute la largeur. Le panneau
 * enregistre de lui-même ; le tiroir se ferme sur « Supprimer l'étape », que le constructeur
 * confirme et exécute (une condition part avec ses branches).
 */
@Component({
  selector: 'journey-step-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasSideDrawer, TasDrawerTitle, TasDrawerContent, JourneyStepPanel],
  template: `
    <tas-side-drawer width="460px">
      <tas-drawer-title>
        <p class="text-base font-semibold text-slate-900">Propriétés de l'étape</p>
      </tas-drawer-title>
      <tas-drawer-content>
        <div class="-m-4">
          <journey-step-panel
            [templateId]="data.templateId"
            [step]="data.step"
            [roleOptions]="data.roleOptions"
            [waitEvents]="data.waitEvents"
            [conditionFields]="data.conditionFields"
            [formFieldOptions]="data.formFieldOptions"
            [entityType]="data.entityType"
            [readOnly]="data.readOnly"
            (updated)="data.onUpdated($event)"
            (deleteRequested)="_dialogRef.close('delete')"
          ></journey-step-panel>
        </div>
      </tas-drawer-content>
    </tas-side-drawer>
  `,
})
export class JourneyStepDrawer {
  public readonly data = inject<JourneyStepDrawerData>(DIALOG_DATA);
  protected readonly _dialogRef = inject(DialogRef<'delete' | undefined>);
}
