import { DatePipe, LowerCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ProjectValidationDto } from '@sankore/crm-api';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';

/** Les circuits de validation lancés par les étapes, relances comprises, et qui a décidé — le plus récent d'abord. */
@Component({
  selector: 'project-validations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, LowerCasePipe, TasCard, TasIcon],
  template: `
    <tas-card class="block" id="validations">
      <div class="p-5">
        <h2 class="text-base font-semibold text-slate-900">Circuits de validation</h2>
        <p class="mb-4 text-xs text-slate-500">Les circuits de validation lancés par les étapes du projet, le plus récent d'abord.</p>
        <ol class="flex flex-col gap-4">
          @for (v of validations(); track v.instanceId) {
            @let st = validationStatus(v.status);
            <li class="rounded-xl border border-slate-200 p-4">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p class="text-sm font-semibold text-slate-900">{{ v.stepLabel }} <span class="font-normal text-slate-500">· {{ v.workflowName }}</span></p>
                  <p class="text-xs text-slate-500">
                    Lancé le {{ v.startedAt | date: 'dd/MM/yyyy à HH:mm' }}
                    @if (v.completedAt) { · clos le {{ v.completedAt | date: 'dd/MM/yyyy à HH:mm' }} }
                  </p>
                </div>
                <span class="inline-flex items-center gap-1 text-sm font-semibold" [class]="st.tone">
                  <tas-icon [iconName]="st.icon" style="font-size:14px"></tas-icon>{{ st.label }}
                </span>
              </div>
              @if (v.decisions?.length) {
                <ul class="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3">
                  @for (d of v.decisions; track d.order) {
                    @let ds = validationStatus(d.status);
                    <li class="flex items-start gap-2 text-sm">
                      <tas-icon [iconName]="ds.icon" style="font-size:14px" class="mt-0.5 shrink-0" [class]="ds.tone"></tas-icon>
                      <div class="min-w-0">
                        <p class="text-slate-800">
                          <span class="font-medium">{{ d.name }}</span>
                          @if (d.decidedBy) {
                            — {{ ds.label | lowercase }} par <span class="font-medium">{{ d.decidedBy }}</span>
                            @if (d.decidedAt) { le {{ d.decidedAt | date: 'dd/MM/yyyy à HH:mm' }} }
                          } @else if (d.status === 'AwaitingApproval' || d.status === 'Pending') {
                            — en attente
                            @if (d.approverRole) { de : {{ d.approverRole }} }
                            @if (d.dueAt) { · échéance le {{ d.dueAt | date: 'dd/MM/yyyy à HH:mm' }} }
                          } @else {
                            — {{ ds.label | lowercase }}
                          }
                        </p>
                        @if (d.comment) {
                          <p class="mt-0.5 text-xs text-slate-600">« {{ d.comment }} »</p>
                        }
                      </div>
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ol>
      </div>
    </tas-card>
  `,
})
export class ProjectValidations {
  public readonly validations = input.required<ProjectValidationDto[]>();

  /** Libellé et couleur d'un statut de circuit ou de décision, tels que le moteur les nomme. */
  public validationStatus(status: string | null | undefined): { label: string; tone: string; icon: string } {
    switch (status) {
      case 'Completed':
      case 'Approved':
        return { label: 'Approuvé', tone: 'text-primary', icon: 'feather:check-circle' };
      case 'Rejected':
        return { label: 'Refusé', tone: 'text-red-700', icon: 'feather:x-circle' };
      case 'Cancelled':
        return { label: 'Annulé', tone: 'text-slate-500', icon: 'feather:slash' };
      case 'TimedOut':
        return { label: 'Délai dépassé', tone: 'text-red-700', icon: 'feather:alert-circle' };
      case 'Skipped':
        return { label: 'Sans objet', tone: 'text-slate-400', icon: 'feather:minus-circle' };
      case 'Executed':
        return { label: 'Exécutée automatiquement', tone: 'text-primary', icon: 'feather:bell' };
      case 'Unknown':
        return { label: 'Illisible', tone: 'text-amber-700', icon: 'feather:help-circle' };
      default:
        return { label: 'En attente', tone: 'text-amber-700', icon: 'feather:clock' };
    }
  }
}
