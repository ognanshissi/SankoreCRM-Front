import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { catchError, EMPTY, firstValueFrom, forkJoin, map, of } from 'rxjs';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import {
  AddTriggerRequestTriggerTypeEnum,
  RolesApiService,
  TriggerDto,
  WorkflowStepDto,
  WorkflowTemplateDto,
  WorkflowTemplatesApiService,
} from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import {
  FlowRow,
  hasAssignee,
  InsertSlot,
  kindsOf,
  lastOrderOf,
  layoutFlow,
  PALETTE_GROUPS,
  parseStepConfig,
  productCondition,
  productOfTrigger,
  STEP_KIND_META,
  StepKind,
  stepKind,
  TARGET_OPTIONS,
  TRIGGER_PRESETS,
  TriggerPreset,
  triggerLabel,
  validateJourney,
  notificationRecipients,
} from './journey-model';
import { JourneyStepPanel } from './step-panel';

type DragPayload = { type: 'step'; kind: StepKind } | { type: 'trigger'; preset: TriggerPreset };

/**
 * Constructeur de parcours : palette à gauche, parcours vertical au centre, propriétés à droite.
 *
 * Il remplace le canevas libre (nœuds et transitions dessinées à la main) par l'ordre des étapes,
 * qui est ce que le moteur exécute : une transition tracée sur l'ancien canevas n'avait d'effet que
 * si elle respectait cet ordre, sans que rien ne le montre.
 */
@Component({
  selector: 'journey-builder',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    Anchor,
    Button,
    TasIcon,
    TasSpinner,
    TasFormField,
    TasLabel,
    TasInput,
    Menu,
    MenuItem,
    TasMenuTrigger,
    TimeagoPipe,
    JourneyStepPanel,
  ],
  templateUrl: './journey-builder.html',
})
export class JourneyBuilder implements OnInit {
  private readonly _api = inject(WorkflowTemplatesApiService);
  private readonly _rolesApi = inject(RolesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _router = inject(Router);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);

  public readonly canManageSteps = this._permissions.can('workflow:manage-steps');
  public readonly canManageTriggers = this._permissions.can('workflow:trigger:manage');
  public readonly canActivate = this._permissions.can('workflow:activate');

  public readonly id = input.required<string>();

  public readonly paletteGroups = PALETTE_GROUPS;
  public readonly kindsOf = kindsOf;
  public readonly STEP_KIND_META = STEP_KIND_META;
  public readonly triggerPresets = TRIGGER_PRESETS;
  public readonly triggerLabel = triggerLabel;
  public readonly productOfTrigger = productOfTrigger;
  public readonly stepKind = stepKind;
  public readonly StepKind = StepKind;

  public isLoading = signal(true);
  public isBusy = signal(false);
  public template = signal<WorkflowTemplateDto | null>(null);
  public published = signal<WorkflowTemplateDto | null>(null);
  public triggers = signal<TriggerDto[]>([]);
  public roleOptions = signal<{ label: string; value: string }[]>([]);

  public selectedStepId = signal<string | null>(null);
  public triggerPanelOpen = signal(false);
  public zoom = signal(1);

  /** Emplacement visé par le menu « + » qui vient d'être ouvert. */
  public pendingSlot = signal<InsertSlot | null>(null);
  public dragging = signal<DragPayload | null>(null);
  public dropTarget = signal<string | null>(null);

  // Panneau déclencheur : saisie locale, enregistrée explicitement (remplacement côté serveur).
  public triggerProduct = signal('');

  public readonly steps = computed(() => this.template()?.steps ?? []);
  public readonly rows = computed(() => layoutFlow(this.steps()));
  public readonly trigger = computed(() => this.triggers()[0] ?? null);
  public readonly selectedStep = computed(() => this.steps().find((s) => s.id === this.selectedStepId()) ?? null);
  public readonly isDraft = computed(() => !!this.template() && !this.template()!.isActive);
  public readonly readOnly = computed(() => !this.isDraft() || !this.canManageSteps());
  public readonly issues = computed(() => validateJourney(this.steps(), this.triggers(), this.template()?.entityType));
  public readonly issuesTitle = computed(() => this.issues().map((i) => i.label).join('\n'));
  public readonly zoomPercent = computed(() => Math.round(this.zoom() * 100));

  ngOnInit(): void {
    this._load();
  }

  // ——— Lecture ———

  public roleLabel(code: string | null | undefined): string {
    if (!code) return '';
    return this.roleOptions().find((r) => r.value === code)?.label ?? code;
  }

  /** Les destinataires d'une étape Notification, en badges sur le canevas. */
  public notificationChips(step: WorkflowStepDto): string[] {
    const config = parseStepConfig(step.configJson);
    const recipients = notificationRecipients(config);
    const chips: string[] = [];
    if (recipients.includes('subject')) chips.push(config.channel === 'Sms' ? 'SMS à la personne' : 'E-mail à la personne');
    if (recipients.includes('assignedAgent')) chips.push('Agent');
    if (recipients.includes('role')) chips.push(...(config.roleCodes ?? []).map((code) => this.roleLabel(code)));
    if (!config.message?.trim()) chips.push('Sans message');
    return chips;
  }

  public targetLabel(step: WorkflowStepDto): string {
    const target = parseStepConfig(step.configJson).target;
    return TARGET_OPTIONS.find((o) => o.value === target)?.label ?? '';
  }

  public slotKey(slot: InsertSlot): string {
    return `${slot.order}-${slot.branch ?? ''}`;
  }

  /** Emplacement « après la ligne `index` » (−1 : avant la première). */
  public slotAfter(index: number): InsertSlot {
    const rows = this.rows();
    if (index < 0) return { order: rows.length ? this._firstOrderOf(rows[0]) : 1 };
    return { order: lastOrderOf(rows[index]) + 1 };
  }

  public branchSlot(row: FlowRow, branch: 'yes' | 'no'): InsertSlot {
    return { order: lastOrderOf(row) + 1, branch };
  }

  // ——— Sélection ———

  public selectStep(step: WorkflowStepDto, event?: Event): void {
    event?.stopPropagation();
    this.triggerPanelOpen.set(false);
    this.selectedStepId.set(step.id ?? null);
  }

  public openTriggerPanel(event?: Event): void {
    event?.stopPropagation();
    this.selectedStepId.set(null);
    this.triggerProduct.set(productOfTrigger(this.trigger()) ?? '');
    this.triggerPanelOpen.set(true);
  }

  public clearSelection(): void {
    this.selectedStepId.set(null);
    this.triggerPanelOpen.set(false);
  }

  public onStepUpdated(step: WorkflowStepDto): void {
    this.template.update((t) => (t ? { ...t, steps: (t.steps ?? []).map((s) => (s.id === step.id ? step : s)) } : t));
  }

  // ——— Zoom ———

  public zoomIn(): void {
    this.zoom.update((z) => Math.min(1.5, +(z + 0.1).toFixed(2)));
  }

  public zoomOut(): void {
    this.zoom.update((z) => Math.max(0.5, +(z - 0.1).toFixed(2)));
  }

  // ——— Glisser-déposer depuis la palette ———

  public onPaletteDragStart(event: DragEvent, payload: DragPayload): void {
    if (this.readOnly()) {
      event.preventDefault();
      return;
    }
    this.dragging.set(payload);
    event.dataTransfer?.setData('text/plain', payload.type);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  }

  public onDragEnd(): void {
    this.dragging.set(null);
    this.dropTarget.set(null);
  }

  public onSlotDragOver(event: DragEvent, key: string): void {
    if (this.dragging()?.type !== 'step') return;
    event.preventDefault();
    this.dropTarget.set(key);
  }

  public onSlotDrop(event: DragEvent, slot: InsertSlot): void {
    event.preventDefault();
    const payload = this.dragging();
    this.onDragEnd();
    if (payload?.type === 'step') this.insertStep(payload.kind, slot);
  }

  public onTriggerDragOver(event: DragEvent): void {
    if (this.dragging()?.type !== 'trigger') return;
    event.preventDefault();
    this.dropTarget.set('trigger');
  }

  public onTriggerDrop(event: DragEvent): void {
    event.preventDefault();
    const payload = this.dragging();
    this.onDragEnd();
    if (payload?.type === 'trigger') this.setTrigger(payload.preset.eventName);
  }

  /** Clic sur la palette : l'étape s'ajoute en fin de parcours. */
  public appendStep(kind: StepKind): void {
    this.insertStep(kind, this.slotAfter(this.rows().length - 1));
  }

  // ——— Écritures ———

  public async insertStep(kind: StepKind, slot: InsertSlot | null): Promise<void> {
    if (!slot || this.readOnly() || this.isBusy()) return;
    this.isBusy.set(true);
    const meta = STEP_KIND_META[kind];
    const stepId = await firstValueFrom(
      this._api
        .addWorkflowStep(this.id(), {
          order: Math.max(1, slot.order),
          name: meta.label,
          kind,
          insertAt: true,
          timeoutHours: hasAssignee(kind) ? 48 : null,
          configJson: slot.branch ? JSON.stringify({ branch: slot.branch }) : null,
        })
        .pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Erreur', err.error?.detail ?? "L'étape n'a pas pu être ajoutée.");
            return of(null);
          }),
        ),
    );
    this.isBusy.set(false);
    if (!stepId) return;
    // Recharger plutôt que d'insérer localement : l'insertion a décalé l'ordre des étapes suivantes.
    await this._reloadTemplate();
    this.triggerPanelOpen.set(false);
    this.selectedStepId.set(String(stepId));
  }

  public deleteStep(step: WorkflowStepDto): void {
    this._confirm.confirm({
      title: "Supprimer l'étape",
      message: `L'étape « ${step.name} » sera retirée du parcours.`,
      closable: true,
      acceptButtonProps: { label: 'Supprimer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isBusy.set(true);
        this._api
          .removeWorkflowStep(this.id(), step.id!)
          .pipe(
            catchError(() => {
              this.isBusy.set(false);
              this._snackbar.error('Erreur', "L'étape n'a pas pu être supprimée.");
              return EMPTY;
            }),
          )
          .subscribe(async () => {
            this.selectedStepId.set(null);
            await this._reloadTemplate();
            this.isBusy.set(false);
          });
      },
    });
  }

  /**
   * Un parcours a un seul déclencheur dans ce constructeur. Le contrat n'a pas de mise à jour :
   * changer d'événement ou de filtre, c'est ajouter le nouveau puis retirer l'ancien — dans cet
   * ordre, pour qu'un échec laisse l'ancien en place plutôt qu'un parcours sans déclencheur.
   */
  public async setTrigger(eventName: string, product = productOfTrigger(this.trigger()) ?? ''): Promise<void> {
    if (!this.canManageTriggers() || !this.isDraft() || this.isBusy()) return;
    const previous = this.trigger();
    const conditionJson = productCondition(product);
    if (previous && previous.eventName === eventName && (previous.conditionJson ?? null) === conditionJson) return;

    this.isBusy.set(true);
    try {
      if (previous && previous.eventName === eventName) {
        // Même événement : l'index unique (template, événement) interdit d'ajouter avant de retirer.
        await firstValueFrom(this._api.removeTrigger(this.id(), previous.id!));
        await firstValueFrom(this._api.addTrigger(this.id(), { triggerType: AddTriggerRequestTriggerTypeEnum.EntityEvent, eventName, conditionJson }));
      } else {
        await firstValueFrom(this._api.addTrigger(this.id(), { triggerType: AddTriggerRequestTriggerTypeEnum.EntityEvent, eventName, conditionJson }));
        if (previous) await firstValueFrom(this._api.removeTrigger(this.id(), previous.id!));
      }
      this._snackbar.success('Déclencheur enregistré', triggerLabel({ eventName }));
    } catch (err) {
      const detail = (err as HttpErrorResponse)?.error?.detail;
      this._snackbar.error('Erreur', detail ?? "Le déclencheur n'a pas pu être enregistré.");
    }
    await this._reloadTriggers();
    this.isBusy.set(false);
  }

  public saveTriggerProduct(): void {
    const trigger = this.trigger();
    if (trigger?.eventName) this.setTrigger(trigger.eventName, this.triggerProduct());
  }

  /**
   * Publier : le serveur n'admet qu'un parcours actif par type d'entité. La version publiée est donc
   * désactivée d'abord, puis le brouillon activé ; si l'activation échoue, l'ancienne est réactivée
   * pour ne pas laisser l'entité sans parcours.
   */
  public async publish(): Promise<void> {
    const template = this.template();
    if (!template || !this.isDraft() || this.isBusy() || this.issues().length) return;
    this.isBusy.set(true);
    const previous = this.published();
    try {
      if (previous?.id) await firstValueFrom(this._api.deactivateWorkflowTemplate(previous.id));
      try {
        await firstValueFrom(this._api.activateWorkflowTemplate(template.id!));
      } catch (err) {
        if (previous?.id) await firstValueFrom(this._api.activateWorkflowTemplate(previous.id)).catch(() => undefined);
        throw err;
      }
      this._snackbar.success('Parcours publié', `La version ${template.version} est maintenant active.`);
      await this._load();
    } catch (err) {
      const detail = (err as HttpErrorResponse)?.error?.detail;
      this._snackbar.error('Publication impossible', detail ?? "Le parcours n'a pas pu être publié.");
    }
    this.isBusy.set(false);
  }

  public createDraft(): void {
    if (this.isBusy()) return;
    this.isBusy.set(true);
    this._api
      .createWorkflowTemplateDraft(this.id())
      .pipe(
        catchError(() => {
          this.isBusy.set(false);
          this._snackbar.error('Erreur', "Le brouillon n'a pas pu être créé.");
          return EMPTY;
        }),
      )
      .subscribe((draftId: unknown) => {
        this.isBusy.set(false);
        const id = typeof draftId === 'string' ? draftId : (draftId as { id?: string })?.id;
        if (id) this._router.navigate(['/settings/workflows', id, 'parcours']);
      });
  }

  // ——— Chargement ———

  private _load(): Promise<void> {
    this.isLoading.set(true);
    return new Promise((resolve) => {
      forkJoin({
        template: this._api.getWorkflowTemplate(this.id()),
        triggers: this._api.listTriggers(this.id()).pipe(catchError(() => of([] as TriggerDto[]))),
        roles: this._rolesApi.listRoles().pipe(catchError(() => of([]))),
        all: this._api.listWorkflowTemplates(false).pipe(catchError(() => of([] as WorkflowTemplateDto[]))),
      }).subscribe({
        next: ({ template, triggers, roles, all }) => {
          this.template.set(template);
          this.triggers.set(triggers ?? []);
          this.roleOptions.set(
            (roles ?? [])
              .filter((r) => !!r.name)
              .map((r) => ({ label: r.label || r.name!, value: r.name! })),
          );
          // Les versions d'un même parcours partagent nom et type d'entité (CreateDraft les recopie).
          this.published.set(
            (all ?? []).find(
              (t) => t.isActive && t.id !== template.id && t.entityType === template.entityType && t.name === template.name,
            ) ?? null,
          );
          this._breadcrumb.set([
            { label: 'Paramétrage', link: ['/settings'] },
            { label: 'Parcours', link: ['/settings/workflows'] },
            { label: template.name ?? 'Parcours' },
          ]);
          this.isLoading.set(false);
          resolve();
        },
        error: () => {
          this._snackbar.error('Erreur', 'Le parcours ne peut pas être chargé.');
          this.isLoading.set(false);
          resolve();
        },
      });
    });
  }

  private _reloadTemplate(): Promise<void> {
    return firstValueFrom(
      this._api.getWorkflowTemplate(this.id()).pipe(
        map((t) => this.template.set(t)),
        catchError(() => of(undefined)),
      ),
    );
  }

  private _reloadTriggers(): Promise<void> {
    return firstValueFrom(
      this._api.listTriggers(this.id()).pipe(
        map((t) => this.triggers.set(t ?? [])),
        catchError(() => of(undefined)),
      ),
    );
  }

  private _firstOrderOf(row: FlowRow): number {
    return (row.type === 'step' ? row.step.order : row.condition.order) ?? 1;
  }
}

export default JourneyBuilder;
