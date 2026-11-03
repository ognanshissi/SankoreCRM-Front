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
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import {
  AddTriggerRequestTriggerTypeEnum,
  RolesApiService,
  UpdateStepRequestKindEnum,
  TriggerDto,
  TriggerEventDto,
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
  conditionSummary,
  ConditionFieldOption,
  STEP_KIND_SUPPORT,
  notificationRecipients,
  endsWithFin,
  endSummary,
  newConditionNode,
  serializeStepConfig,
  StepConfig,
  stepsOf,
} from './journey-model';
import { JourneyStepDrawer, JourneyStepDrawerData } from './journey-step-drawer';
import { JourneyTriggerDrawer, JourneyTriggerDrawerData } from './journey-trigger-drawer';

/** La palette ouverte ou fermée, retenue d'une visite à l'autre sur ce poste. */
const PALETTE_KEY = 'journey-builder.palette-open';

function readPaletteOpen(): boolean {
  try {
    return localStorage.getItem(PALETTE_KEY) === '1';
  } catch {
    return false;
  }
}

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
  ],
  templateUrl: './journey-builder.html',
})
export class JourneyBuilder implements OnInit {
  private readonly _api = inject(WorkflowTemplatesApiService);
  private readonly _rolesApi = inject(RolesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _sideDrawer = inject(SideDrawerService);
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
  public readonly STEP_KIND_SUPPORT = STEP_KIND_SUPPORT;
  public readonly triggerPresets = TRIGGER_PRESETS;
  public readonly triggerLabel = triggerLabel;
  public readonly productOfTrigger = productOfTrigger;
  public readonly stepKind = stepKind;
  public readonly StepKind = StepKind;
  public readonly endsWithFin = endsWithFin;

  public isLoading = signal(true);
  public isBusy = signal(false);
  public template = signal<WorkflowTemplateDto | null>(null);
  public published = signal<WorkflowTemplateDto | null>(null);
  public triggers = signal<TriggerDto[]>([]);
  public roleOptions = signal<{ label: string; value: string }[]>([]);
  /** Les événements internes du type de dossier, qu'une étape Attente peut attendre. */
  public waitEvents = signal<{ label: string; value: string }[]>([]);
  /** Les faits que les étapes Condition peuvent comparer, pour le type de dossier du modèle. */
  public conditionFields = signal<ConditionFieldOption[]>([]);
  /** Les champs qu'une étape Formulaire peut exiger, pour le type de dossier du modèle. */
  public formFieldOptions = signal<{ label: string; value: string }[]>([]);

  public selectedStepId = signal<string | null>(null);
  public triggerPanelOpen = signal(false);
  /** La palette des étapes, posée sur le canevas : fermée, le canevas a toute la place. */
  public paletteOpen = signal(readPaletteOpen());
  public zoom = signal(1);

  /** Emplacement visé par le menu « + » qui vient d'être ouvert. */
  public pendingSlot = signal<InsertSlot | null>(null);
  public dragging = signal<DragPayload | null>(null);
  public dropTarget = signal<string | null>(null);


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

  public conditionLabel(step: WorkflowStepDto): string | null {
    return conditionSummary(parseStepConfig(step.configJson).condition, this.conditionFields());
  }

  public waitEventLabel(step: WorkflowStepDto): string | null {
    const code = parseStepConfig(step.configJson).eventCode;
    if (!code) return null;
    return this.waitEvents().find((e) => e.value === code)?.label ?? code;
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

  public endChips(step: WorkflowStepDto): string[] {
    return endSummary(parseStepConfig(step.configJson));
  }

  public targetLabel(step: WorkflowStepDto): string {
    const target = parseStepConfig(step.configJson).target;
    return TARGET_OPTIONS.find((o) => o.value === target)?.label ?? '';
  }

  public slotKey(slot: InsertSlot): string {
    return `${slot.order}-${slot.branch ?? ''}-${slot.condition?.id ?? ''}`;
  }

  /** Emplacement « après la ligne `index` » (−1 : avant la première). */
  public slotAfter(index: number): InsertSlot {
    const rows = this.rows();
    if (index < 0) return { order: rows.length ? this._firstOrderOf(rows[0]) : 1 };
    return { order: lastOrderOf(rows[index]) + 1 };
  }

  public branchSlot(row: FlowRow, branch: 'yes' | 'no'): InsertSlot {
    return { order: lastOrderOf(row) + 1, branch, condition: row.type === 'branches' ? row.condition : undefined };
  }

  /** Emplacement « juste avant `inner` » dans une branche de `row` : l'étape prend sa place, il est décalé. */
  public branchSlotBefore(row: FlowRow, branch: 'yes' | 'no', inner: FlowRow): InsertSlot {
    return {
      order: Math.min(...stepsOf(inner).map((s) => s.order ?? 0)),
      branch,
      condition: row.type === 'branches' ? row.condition : undefined,
    };
  }

  // ——— Sélection ———

  public togglePalette(): void {
    this.paletteOpen.update((open) => !open);
    try {
      localStorage.setItem(PALETTE_KEY, this.paletteOpen() ? '1' : '0');
    } catch {
      // Stockage indisponible (navigation privée) : le choix vaut pour cette visite.
    }
  }

  /** Les propriétés de l'étape s'ouvrent dans un tiroir ; la carte reste en surbrillance tant qu'il est ouvert. */
  public selectStep(step: WorkflowStepDto, event?: Event): void {
    event?.stopPropagation();
    this.triggerPanelOpen.set(false);
    this.selectedStepId.set(step.id ?? null);
    const data: JourneyStepDrawerData = {
      templateId: this.id(),
      step,
      roleOptions: this.roleOptions(),
      waitEvents: this.waitEvents(),
      conditionFields: this.conditionFields(),
      formFieldOptions: this.formFieldOptions(),
      entityType: this.template()?.entityType ?? null,
      readOnly: this.readOnly(),
      onUpdated: (updated) => this.onStepUpdated(updated),
    };
    const ref = this._sideDrawer.open<'delete' | undefined, JourneyStepDrawerData, JourneyStepDrawer>(JourneyStepDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });
    ref.closed.subscribe((result) => {
      if (this.selectedStepId() === step.id) this.selectedStepId.set(null);
      if (result === 'delete') {
        // La version la plus récente : le panneau a pu renommer l'étape avant qu'on la supprime.
        this.deleteStep(this.steps().find((s) => s.id === step.id) ?? step);
      }
    });
  }

  public openTriggerPanel(event?: Event): void {
    event?.stopPropagation();
    this.selectedStepId.set(null);
    this.triggerPanelOpen.set(true);
    const trigger = this.trigger();
    const data: JourneyTriggerDrawerData = {
      label: trigger ? triggerLabel(trigger) : null,
      product: productOfTrigger(trigger) ?? '',
      canEdit: this.isDraft() && this.canManageTriggers(),
      save: (product) => (trigger?.eventName ? this.setTrigger(trigger.eventName, product) : Promise.resolve(false)),
    };
    this._sideDrawer
      .open<void, JourneyTriggerDrawerData, JourneyTriggerDrawer>(JourneyTriggerDrawer, {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data,
      })
      .closed.subscribe(() => this.triggerPanelOpen.set(false));
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

    const config: StepConfig = {};
    if (slot.branch && slot.condition) {
      const node = await this._ensureTree(slot.condition);
      if (!node) {
        this.isBusy.set(false);
        return;
      }
      config.branch = slot.branch;
      config.parent = node;
    }
    if (kind === StepKind.Condition) config.node = newConditionNode();
    if (kind === StepKind.End) config.outcome = 'approved';

    const stepId = await firstValueFrom(
      this._api
        .addWorkflowStep(this.id(), {
          order: Math.max(1, slot.order),
          name: meta.label,
          kind,
          insertAt: true,
          timeoutHours: hasAssignee(kind) ? 48 : null,
          configJson: serializeStepConfig(config) || null,
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
    // L'étape ajoutée s'ouvre aussitôt : on vient l'ajouter pour la paramétrer.
    const added = this.steps().find((s) => s.id === String(stepId));
    if (added) this.selectStep(added);
  }

  /**
   * Une condition part avec ses branches : laissées seules, ses étapes seraient rattachées à une
   * condition disparue et le parcours ne pourrait plus être publié.
   */
  public deleteStep(step: WorkflowStepDto): void {
    const row = this._rowOf(step, this.rows());
    const removed = row ? stepsOf(row) : [step];
    const inside = removed.length - 1;
    this._confirm.confirm({
      title: stepKind(step) === StepKind.Condition ? 'Supprimer la condition' : "Supprimer l'étape",
      message: inside > 0
        ? `La condition « ${step.name} » et les ${inside} étape${inside > 1 ? 's' : ''} de ses branches seront retirées du parcours.`
        : `L'étape « ${step.name} » sera retirée du parcours.`,
      closable: true,
      acceptButtonProps: { label: 'Supprimer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: async () => {
        this.isBusy.set(true);
        // Les plus profondes d'abord : à aucun moment une étape ne reste sans sa condition.
        for (const s of [...removed].sort((a, b) => (b.order ?? 0) - (a.order ?? 0))) {
          const ok = await firstValueFrom(
            this._api.removeWorkflowStep(this.id(), s.id!).pipe(
              map(() => true),
              catchError(() => of(false)),
            ),
          );
          if (!ok) {
            this._snackbar.error('Erreur', `L'étape « ${s.name} » n'a pas pu être supprimée.`);
            break;
          }
        }
        this.selectedStepId.set(null);
        await this._reloadTemplate();
        this.isBusy.set(false);
      },
    });
  }

  private _rowOf(step: WorkflowStepDto, rows: FlowRow[]): FlowRow | null {
    for (const row of rows) {
      if (row.type === 'step' && row.step.id === step.id) return row;
      if (row.type === 'branches') {
        if (row.condition.id === step.id) return row;
        const inner = this._rowOf(step, row.yes) ?? this._rowOf(step, row.no);
        if (inner) return inner;
      }
    }
    return null;
  }

  /**
   * L'identifiant d'une condition, que ses étapes nomment, et le rattachement explicite de ses
   * étapes directes. Une condition enregistrée avant l'imbrication n'a pas d'identifiant, et ses
   * étapes n'ont qu'une `branch` : elles appartiennent à « la condition qui les précède ». Une
   * condition insérée devant elles les capterait — tout est donc rattaché nommément avant
   * d'insérer quoi que ce soit dans ses branches.
   */
  private async _ensureTree(condition: WorkflowStepDto): Promise<string | null> {
    const config = parseStepConfig(condition.configJson);
    const node = config.node ?? newConditionNode();
    if (!config.node && !(await this._saveConfig(condition, { ...config, node }))) return null;

    const row = this._rowOf(condition, this.rows());
    const children = row?.type === 'branches'
      ? [...row.yes, ...row.no].map((r) => (r.type === 'step' ? r.step : r.condition))
      : [];
    for (const child of children) {
      const childConfig = parseStepConfig(child.configJson);
      if (childConfig.parent || !childConfig.branch) continue;
      if (!(await this._saveConfig(child, { ...childConfig, parent: node }))) return null;
    }
    return node;
  }

  /** Réécrit la seule configuration d'une étape, le reste tel quel. */
  private async _saveConfig(step: WorkflowStepDto, config: StepConfig): Promise<boolean> {
    return firstValueFrom(
      this._api
        .updateWorkflowStep(this.id(), step.id!, {
          name: step.name,
          description: step.description ?? null,
          approverRoleCode: step.approverRoleCode ?? null,
          timeoutHours: step.timeoutHours ?? null,
          kind: stepKind(step) as unknown as UpdateStepRequestKindEnum,
          configJson: serializeStepConfig(config),
          isBlocking: !!step.isBlocking,
        })
        .pipe(
          map(() => true),
          catchError(() => {
            this._snackbar.error('Erreur', `L'étape « ${step.name} » n'a pas pu être rattachée à sa condition.`);
            return of(false);
          }),
        ),
    );
  }

  /**
   * Un parcours a un seul déclencheur dans ce constructeur. Le contrat n'a pas de mise à jour :
   * changer d'événement ou de filtre, c'est ajouter le nouveau puis retirer l'ancien — dans cet
   * ordre, pour qu'un échec laisse l'ancien en place plutôt qu'un parcours sans déclencheur.
   */
  /** Vrai quand le déclencheur voulu est en place (ou l'était déjà). */
  public async setTrigger(eventName: string, product = productOfTrigger(this.trigger()) ?? ''): Promise<boolean> {
    if (!this.canManageTriggers() || !this.isDraft() || this.isBusy()) return false;
    const previous = this.trigger();
    const conditionJson = productCondition(product);
    if (previous && previous.eventName === eventName && (previous.conditionJson ?? null) === conditionJson) return true;
    let saved = false;

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
      saved = true;
    } catch (err) {
      const detail = (err as HttpErrorResponse)?.error?.detail;
      this._snackbar.error('Erreur', detail ?? "Le déclencheur n'a pas pu être enregistré.");
    }
    await this._reloadTriggers();
    this.isBusy.set(false);
    return saved;
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
        all: this._api.listWorkflowTemplates().pipe(catchError(() => of([] as WorkflowTemplateDto[]))),
      }).subscribe({
        next: ({ template, triggers, roles, all }) => {
          this.template.set(template);
          if (template.entityType)
            this._api
              .listWorkflowFormFields(template.entityType)
              .pipe(catchError(() => of([])))
              .subscribe((fields) =>
                this.formFieldOptions.set((fields ?? []).map((f) => ({ label: f.label ?? f.key!, value: f.key! }))),
              );
          if (template.entityType)
            this._api
              .listWorkflowConditionFields(template.entityType)
              .pipe(catchError(() => of([])))
              .subscribe((fields) =>
                this.conditionFields.set(
                  (fields ?? []).map((f) => ({ key: f.key!, label: f.label ?? f.key!, type: f.type ?? 'text', options: f.options?.map((o) => ({ value: o.value!, label: o.label ?? o.value! })) })),
                ),
              );
          // La capture n'arrive qu'une fois, avant toute instance : l'attendre n'aurait pas de sens.
          this._api
            .listWorkflowTriggerEvents(template.entityType ?? undefined)
            .pipe(catchError(() => of([] as TriggerEventDto[])))
            .subscribe((events) =>
              this.waitEvents.set(
                (events ?? [])
                  .filter((e) => e.code && e.code !== 'LEAD_CAPTURED')
                  .map((e) => ({ label: e.label ?? e.code!, value: e.code! })),
              ),
            );
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
