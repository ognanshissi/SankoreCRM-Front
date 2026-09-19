import { Component, effect, inject, input, signal } from '@angular/core';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import {
  AddTriggerRequestTriggerTypeEnum,
  TriggerDto,
  WorkflowTemplateDto,
  WorkflowTemplatesApiService,
} from '@sankore/crm-api';
import { TRIGGER_TYPE_OPTIONS, triggerTypeLabel } from '../workflow-shared';

@Component({
  selector: 'workflow-triggers',
  imports: [TasCard, Button, TasSpinner, TasIcon, TasTag, TimeagoPipe],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="pb-6 flex flex-col gap-4">

        <!-- Info banner when active -->
        @if (template()?.isActive) {
          <div class="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50">
            <tas-icon iconName="feather:sliders" iconSize="sm" class="text-slate-400 flex-shrink-0 mt-0.5"></tas-icon>
            <p class="text-sm text-slate-500">
              Ce modèle est actif. Désactivez-le pour modifier les déclencheurs.
            </p>
          </div>
        }

        <!-- Triggers list -->
        <tas-card>
          <div class="p-4 flex items-start justify-between border-b border-slate-100">
            <div>
              <p class="font-semibold text-slate-800">Déclencheurs</p>
              <p class="text-sm text-slate-500 mt-0.5">
                Événements qui démarrent automatiquement une instance de ce workflow
              </p>
            </div>
            @if (!template()?.isActive) {
              <button
                tas-outlined-button
                color="primary"
                type="button"
                [disabled]="isSaving()"
                (click)="toggleAddForm()"
                class="shrink-0"
              >
                <tas-icon iconName="feather:plus" iconSize="sm"></tas-icon>
                Ajouter
              </button>
            }
          </div>

          <div class="px-4 pb-4">

            @if (triggers().length === 0 && !showAddForm()) {
              <p class="text-sm text-slate-400 py-6 text-center">
                Aucun déclencheur configuré. Les instances devront être démarrées manuellement.
              </p>
            } @else {
              <div class="flex flex-col divide-y divide-slate-100">
                @for (trigger of triggers(); track trigger.id) {
                  <div class="flex items-center justify-between gap-4 py-3">
                    <div class="flex items-center gap-3 min-w-0">
                      <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <tas-icon
                          [iconName]="triggerIcon(trigger)"
                          class="text-primary"
                          style="font-size:14px"
                        ></tas-icon>
                      </div>
                      <div class="min-w-0">
                        <p class="text-sm font-medium text-slate-800">
                          {{ triggerTypeLabel(trigger.triggerType) }}
                        </p>
                        @if (trigger.eventName) {
                          <p class="text-xs text-slate-400 font-mono truncate">{{ trigger.eventName }}</p>
                        }
                        @if (trigger.createdAt) {
                          <p class="text-xs text-slate-400 mt-0.5">{{ trigger.createdAt | dateTimeAgo }}</p>
                        }
                      </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <tas-tag [severity]="trigger.isActive ? 'success' : 'neutral'">
                        {{ trigger.isActive ? 'Actif' : 'Inactif' }}
                      </tas-tag>
                      @if (!template()?.isActive) {
                        <button
                          tas-button
                          iconButton
                          type="button"
                          title="Supprimer le déclencheur"
                          [disabled]="removingId() === trigger.id || isSaving()"
                          (click)="removeTrigger(trigger)"
                        >
                          <tas-icon iconName="feather:trash-2" iconSize="sm" class="text-functional-error"></tas-icon>
                        </button>
                      }
                    </div>
                  </div>
                }
              </div>
            }

            <!-- Add form -->
            @if (showAddForm()) {
              <div class="mt-3 p-4 rounded-lg border border-slate-200 bg-slate-50 flex flex-col gap-3">
                <p class="text-sm font-medium text-slate-700">Nouveau déclencheur</p>

                <div>
                  <label class="text-xs text-slate-500 mb-1 block">Type</label>
                  <select
                    class="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40"
                    [value]="newTriggerType()"
                    (change)="newTriggerType.set($any($event.target).value)"
                  >
                    @for (opt of triggerTypeOptions; track opt.value) {
                      <option [value]="opt.value">{{ opt.label }}</option>
                    }
                  </select>
                </div>

                @if (newTriggerType() === AddTriggerRequestTriggerTypeEnum.EntityEvent) {
                  <div>
                    <label class="text-xs text-slate-500 mb-1 block">Nom de l'événement</label>
                    <input
                      type="text"
                      class="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 font-mono"
                      placeholder="ex: lead.created"
                      [value]="newEventName()"
                      (input)="newEventName.set($any($event.target).value)"
                    />
                  </div>
                }

                <div class="flex items-center gap-2 pt-1">
                  <button
                    tas-raised-button
                    color="primary"
                    type="button"
                    [disabled]="isSaving() || (newTriggerType() === AddTriggerRequestTriggerTypeEnum.EntityEvent && !newEventName().trim())"
                    (click)="addTrigger()"
                  >
                    Ajouter le déclencheur
                  </button>
                  <button
                    tas-text-button
                    type="button"
                    [disabled]="isSaving()"
                    (click)="toggleAddForm()"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            }
          </div>
        </tas-card>

      </div>
    }
  `,
})
export class WorkflowTriggersPage {
  private readonly _api = inject(WorkflowTemplatesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public readonly id = input.required<string>();
  public readonly triggerTypeLabel = triggerTypeLabel;
  public readonly triggerTypeOptions = TRIGGER_TYPE_OPTIONS;
  public readonly AddTriggerRequestTriggerTypeEnum = AddTriggerRequestTriggerTypeEnum;

  public isLoading = signal(true);
  public isSaving = signal(false);
  public removingId = signal<string | null>(null);
  public triggers = signal<TriggerDto[]>([]);
  public template = signal<WorkflowTemplateDto | null>(null);
  public showAddForm = signal(false);
  public newTriggerType = signal<AddTriggerRequestTriggerTypeEnum>(AddTriggerRequestTriggerTypeEnum.EntityEvent);
  public newEventName = signal('');

  constructor() {
    effect(() => {
      this._load();
    });
  }

  public triggerIcon(trigger: TriggerDto): string {
    switch (trigger.triggerType as string) {
      case AddTriggerRequestTriggerTypeEnum.EntityEvent: return 'feather:zap';
      case AddTriggerRequestTriggerTypeEnum.Schedule: return 'feather:clock';
      case AddTriggerRequestTriggerTypeEnum.ExternalEvent: return 'feather:mouse-pointer';
      default: return 'feather:zap';
    }
  }

  public toggleAddForm(): void {
    this.showAddForm.update((v) => !v);
    this.newTriggerType.set(AddTriggerRequestTriggerTypeEnum.EntityEvent);
    this.newEventName.set('');
  }

  public addTrigger(): void {
    this.isSaving.set(true);
    this._api
      .addTrigger(this.id(), {
        triggerType: this.newTriggerType(),
        eventName: this.newTriggerType() === AddTriggerRequestTriggerTypeEnum.EntityEvent ? this.newEventName().trim() : null,
      })
      .subscribe({
        next: () => {
          this._snackbar.success('Succès', 'Déclencheur ajouté.');
          this.showAddForm.set(false);
          this.newTriggerType.set(AddTriggerRequestTriggerTypeEnum.EntityEvent);
          this.newEventName.set('');
          this.isSaving.set(false);
          this._reloadTriggers();
        },
        error: () => {
          this._snackbar.error('Erreur', "Impossible d'ajouter le déclencheur.");
          this.isSaving.set(false);
        },
      });
  }

  public removeTrigger(trigger: TriggerDto): void {
    if (!trigger.id) return;
    this._confirm.confirm({
      title: 'Supprimer le déclencheur',
      message: `Le déclencheur "${triggerTypeLabel(trigger.triggerType)}" sera supprimé. Continuer ?`,
      closable: true,
      acceptButtonProps: { label: 'Supprimer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.removingId.set(trigger.id!);
        this._api
          .removeTrigger(this.id(), trigger.id!)
          .pipe(
            catchError(() => {
              this._snackbar.error('Erreur', 'Impossible de supprimer le déclencheur.');
              this.removingId.set(null);
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this._snackbar.success('Succès', 'Déclencheur supprimé.');
            this.removingId.set(null);
            this.triggers.update((ts) => ts.filter((t) => t.id !== trigger.id));
          });
      },
    });
  }

  private _load(): void {
    this.isLoading.set(true);
    this._api.getWorkflowTemplate(this.id()).subscribe({
      next: (template) => {
        this.template.set(template);
        this._api.listTriggers(this.id()).subscribe({
          next: (triggers) => {
            this.triggers.set(triggers ?? []);
            this.isLoading.set(false);
          },
          error: () => this.isLoading.set(false),
        });
      },
      error: () => this.isLoading.set(false),
    });
  }

  private _reloadTriggers(): void {
    this._api.listTriggers(this.id()).subscribe((triggers) => {
      this.triggers.set(triggers ?? []);
    });
  }
}

export default WorkflowTriggersPage;
