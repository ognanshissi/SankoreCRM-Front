import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProjectBlockingCircuitDto, ProjectBlockingStepDto } from '@sankore/crm-api';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';

/** Les champs que le tiroir « Modifier les informations » du lead remplit ; le reste se trouve dans « Détails du lead ». */
const LEAD_DRAWER_FIELDS = new Set([
  'firstName', 'lastName', 'email', 'gender', 'dateOfBirth', 'companyName', 'companyEmail', 'companyPhone',
  'website', 'interestedProduct', 'campaign', 'preferredLanguage', 'preferredAgencyId', 'comment',
]);
const LEAD_DETAIL_FIELDS = new Set(['profession', 'maritalStatus', 'addressLine', 'postalCode', 'city', 'countryCode']);

type Link = { commands: unknown[]; queryParams: Record<string, string> | null };

/**
 * Les circuits qui retiennent le gain du projet, dits comme l'agent en a besoin (2026-11-02) :
 * l'étape ouverte, qui la décide, ce qu'elle attend du dossier et où le compléter. L'encart ne
 * nommait que l'étape, sans dire où aller ni quoi faire.
 */
@Component({
  selector: 'project-blocking-circuits',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Anchor, Button, TasIcon],
  template: `
    <div class="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <tas-icon iconName="feather:git-pull-request" class="mt-0.5 shrink-0 text-amber-600" style="font-size:16px"></tas-icon>
      <div class="flex min-w-0 flex-1 flex-col gap-3">
        <div>
          <p class="font-semibold">Un circuit de validation retient ce projet</p>
          <p class="mt-0.5">Il ne pourra être marqué gagné qu'une fois {{ circuits().length > 1 ? 'ces circuits avancés' : 'ce circuit avancé' }} :</p>
        </div>

        @for (c of circuits(); track c.instanceId) {
          <div class="rounded-lg border border-amber-200 bg-white/70 px-3 py-2.5">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="font-medium text-slate-800">
                {{ c.circuit }}
                <span class="font-normal text-slate-500">· étape bloquante : {{ (c.blockingSteps ?? []).join(', ') }}</span>
              </p>
              <a tas-text-button size="small" [routerLink]="['/settings/workflows/instances', c.instanceId]">
                Voir le circuit
                <tas-icon iconName="feather:arrow-right" style="font-size:13px"></tas-icon>
              </a>
            </div>

            @if (c.openStep; as s) {
              <p class="mt-1.5 text-slate-700">
                Étape en cours : <span class="font-medium">« {{ s.name }} »</span>
                @if (decider(s); as who) { — décidée par <span class="font-medium">{{ who }}</span> }
              </p>

              <p class="mt-1 text-slate-700">{{ instruction(s) }}</p>

              @if (s.requirements?.length) {
                <ul class="mt-2 flex flex-col gap-1">
                  @for (r of s.requirements ?? []; track $index) {
                    <li class="flex items-start gap-2">
                      @if (r.satisfied) {
                        <tas-icon iconName="feather:check-circle" class="mt-0.5 shrink-0 text-green-600" style="font-size:14px"></tas-icon>
                        <span class="text-slate-700">{{ r.label }}</span>
                      } @else {
                        <tas-icon iconName="feather:x-circle" class="mt-0.5 shrink-0 text-amber-600" style="font-size:14px"></tas-icon>
                        <span class="font-medium text-amber-900">{{ r.label }}</span>
                      }
                    </li>
                  }
                </ul>
              }

              <div class="mt-2.5 flex flex-wrap gap-2">
                @if (missing(s)) {
                  @if (s.kind === 'QualificationForm' && s.completeOnEntityType === 'Opportunity') {
                    <button tas-raised-button color="primary" size="small" type="button" (click)="goTo.emit('questionnaires')">
                      Remplir les questionnaires
                    </button>
                  } @else if (completeLink(s); as link) {
                    <a tas-raised-button color="primary" size="small" [routerLink]="link.commands" [queryParams]="link.queryParams">
                      <tas-icon iconName="feather:edit-2" style="font-size:13px"></tas-icon>
                      Compléter le dossier
                    </a>
                  }
                }
                @if (s.kind === 'ManualTask' && taskOpen(s)) {
                  <button tas-outlined-button color="primary" size="small" type="button" (click)="goTo.emit('tasks')">
                    Voir la tâche
                  </button>
                }
                @if (s.canAct && !missing(s) && !taskOpen(s)) {
                  <a tas-raised-button color="primary" size="small" [routerLink]="['/settings/workflows/instances', c.instanceId]">
                    Valider l'étape
                  </a>
                }
              </div>
            } @else {
              <p class="mt-1.5 text-slate-700">Le circuit n'attend aucune décision pour l'instant : il reprendra de lui-même.</p>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class ProjectBlockingCircuits {
  public readonly circuits = input.required<ProjectBlockingCircuitDto[]>();
  public readonly projectId = input.required<string>();
  public readonly goTo = output<'questionnaires' | 'tasks'>();

  /** Le retour après l'enregistrement du lead : ce projet. */
  private readonly _back = computed(() => `/leads/projets/${this.projectId()}`);

  public decider(s: ProjectBlockingStepDto): string | null {
    if (s.assignedTo) return s.assignedTo;
    return s.approverRole ?? null;
  }

  public missing(s: ProjectBlockingStepDto): number {
    return (s.requirements ?? []).filter((r) => !r.satisfied).length;
  }

  public taskOpen(s: ProjectBlockingStepDto): boolean {
    return !!s.task && (s.task.status === 'Pending' || s.task.status === 'InProgress');
  }

  /** Ce qu'il faut faire, dit selon la nature de l'étape et ce qu'elle attend encore. */
  public instruction(s: ProjectBlockingStepDto): string {
    const who = this.decider(s);
    const decision = s.canAct
      ? 'C\'est à vous de la valider.'
      : who ? `Elle attend la décision de ${who}.` : 'Elle attend une décision.';
    if (this.missing(s)) {
      return s.canAct
        ? 'Complétez d\'abord les points ci-dessous : vous pourrez ensuite valider l\'étape.'
        : `Complétez les points ci-dessous ; ${who ? who + ' pourra' : 'on pourra'} ensuite valider l'étape.`;
    }
    switch (s.kind) {
      case 'ManualTask':
        if (this.taskOpen(s)) {
          const holder = s.task!.assignedTo ? ` (${s.task!.assignedTo})` : '';
          return `Terminez la tâche « ${s.task!.title} »${holder} : l'étape passera d'elle-même.`;
        }
        if (s.task?.status === 'Cancelled') return `Sa tâche « ${s.task.title} » a été annulée. ${decision}`;
        return decision;
      default:
        return s.requirements?.length ? `Le dossier est prêt. ${decision}` : decision;
    }
  }

  /** Le dossier où se remplissent les points manquants, ouvert là où le champ se saisit. */
  public completeLink(s: ProjectBlockingStepDto): Link | null {
    const id = s.completeOnEntityId;
    if (!id) return null;
    switch (s.completeOnEntityType) {
      case 'Lead': {
        const missing = (s.requirements ?? []).filter((r) => !r.satisfied).map((r) => r.fieldKey ?? '');
        if (missing.some((k) => LEAD_DRAWER_FIELDS.has(k)))
          return { commands: ['/leads', id, 'informations'], queryParams: { modifier: '1', retour: this._back() } };
        if (missing.some((k) => LEAD_DETAIL_FIELDS.has(k))) return { commands: ['/leads', id, 'identite'], queryParams: null };
        return { commands: ['/leads', id, 'informations'], queryParams: null };
      }
      case 'Account':
        return { commands: ['/customers', id], queryParams: null };
      default:
        return null;
    }
  }
}
