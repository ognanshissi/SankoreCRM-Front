import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  input,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { forkJoin } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { ActionDto, AddActionRequestActionTypeEnum, TransitionDto, UpdateStepRequest, WorkflowTemplatesApiService } from '@sankore/crm-api';
import { ACTION_TYPE_OPTIONS, actionTypeLabel } from '../workflow-shared';

// ─── Domain Model ────────────────────────────────────────────────────────────

export type StateType =
  | 'Initial'
  | 'Normal'
  | 'Waiting'
  | 'Approval'
  | 'Success'
  | 'Rejected'
  | 'Cancelled'
  | 'Expired';

export interface CanvasState {
  id: string;
  code: string;
  name: string;
  type: StateType;
  position: { x: number; y: number };
  description: string | null;
  approverRoleCode: string | null;
  timeoutHours: number | null;
}

export interface CanvasTransition {
  id: string;
  sourceStateId: string;
  targetStateId: string;
  name: string;
}

interface BuilderMeta {
  positions: Record<string, { x: number; y: number }>;
  types: Record<string, StateType>;
  transitionNames: Record<string, string>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const NODE_W = 200;
export const NODE_H = 72;

export const STATE_TYPE_META: Record<
  StateType,
  { label: string; icon: string; color: string; border: string; text: string; dot: string }
> = {
  Initial:   { label: 'Initial',    icon: 'feather:play-circle',  color: 'bg-blue-500',   border: 'border-blue-200',   text: 'text-blue-600',   dot: '#3b82f6' },
  Normal:    { label: 'Normal',     icon: 'feather:circle',       color: 'bg-slate-400',  border: 'border-slate-200',  text: 'text-slate-500',  dot: '#94a3b8' },
  Waiting:   { label: 'Attente',    icon: 'feather:clock',        color: 'bg-purple-500', border: 'border-purple-200', text: 'text-purple-600', dot: '#a855f7' },
  Approval:  { label: 'Validation', icon: 'feather:check-square', color: 'bg-amber-500',  border: 'border-amber-200',  text: 'text-amber-600',  dot: '#f59e0b' },
  Success:   { label: 'Succès',     icon: 'feather:check-circle', color: 'bg-green-500',  border: 'border-green-200',  text: 'text-green-600',  dot: '#22c55e' },
  Rejected:  { label: 'Rejeté',     icon: 'feather:x-circle',     color: 'bg-red-500',    border: 'border-red-200',    text: 'text-red-600',    dot: '#ef4444' },
  Cancelled: { label: 'Annulé',     icon: 'feather:slash',        color: 'bg-gray-400',   border: 'border-gray-200',   text: 'text-gray-500',   dot: '#9ca3af' },
  Expired:   { label: 'Expiré',     icon: 'feather:alert-circle', color: 'bg-orange-500', border: 'border-orange-200', text: 'text-orange-600', dot: '#f97316' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bezier(sx: number, sy: number, tx: number, ty: number): string {
  const cp = Math.max(Math.abs(tx - sx) * 0.5, 80);
  return `M ${sx} ${sy} C ${sx + cp} ${sy} ${tx - cp} ${ty} ${tx} ${ty}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

@Component({
  selector: 'workflow-builder',
  templateUrl: './builder.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, TasIcon, TasSpinner],
  host: { class: 'flex flex-col' },
})
export class WorkflowBuilderPage implements OnInit {
  @ViewChild('viewport', { static: true }) viewportRef!: ElementRef<HTMLDivElement>;

  private readonly _api = inject(WorkflowTemplatesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public readonly id = input.required<string>();

  // ── Loading ───────────────────────────────────────────────────────────────
  public isLoading = signal(true);
  public isSaving = signal(false);
  public isUpdatingState = signal(false);

  // ── Canvas data ──────────────────────────────────────────────────────────
  public states = signal<CanvasState[]>([]);
  public transitions = signal<CanvasTransition[]>([]);

  // ── View transform ───────────────────────────────────────────────────────
  public viewX = signal(60);
  public viewY = signal(40);
  public viewScale = signal(1);

  // ── Selection ────────────────────────────────────────────────────────────
  public selectedStateId = signal<string | null>(null);
  public selectedTransitionId = signal<string | null>(null);

  // ── Interaction (non-signal, no CD needed for raw drag state) ────────────
  private _drag: { id: string; smx: number; smy: number; snx: number; sny: number } | null = null;
  private _didDrag = false;
  private _panning = false;
  private _panSmx = 0;
  private _panSmy = 0;
  private _panSvx = 0;
  private _panSvy = 0;
  private _spaceDown = false;

  // ── Connection drawing ───────────────────────────────────────────────────
  public connectFrom = signal<string | null>(null);
  public connectPt = signal({ x: 0, y: 0 });

  // ── Transition actions ────────────────────────────────────────────────────
  public selectedTransitionActions = signal<ActionDto[]>([]);
  public newActionType = signal<AddActionRequestActionTypeEnum>(AddActionRequestActionTypeEnum.AssignUser);
  public isAddingAction = signal(false);
  public removingActionId = signal<string | null>(null);
  public readonly ACTION_TYPE_OPTIONS = ACTION_TYPE_OPTIONS;
  public readonly AddActionRequestActionTypeEnum = AddActionRequestActionTypeEnum;
  public readonly actionTypeLabel = actionTypeLabel;

  // ── New state form (WF-006) ───────────────────────────────────────────────
  public pendingNewState = signal<{ type: StateType } | null>(null);
  public newStateName = signal('');
  public newStateDescription = signal('');
  public newStateRole = signal('');
  public newStateTimeoutHours = signal('');

  // ── Type edit tracking (WF-007) ───────────────────────────────────────────
  private _originalStateType: StateType | null = null;
  public hasTypeChange = signal(false);

  // ── Inline state editing (P4) ─────────────────────────────────────────────
  public editStateName = signal('');
  public editStateDescription = signal('');
  public editStateRole = signal('');
  public editStateTimeout = signal('');

  // ── Computed ─────────────────────────────────────────────────────────────
  public readonly NODE_W = NODE_W;
  public readonly NODE_H = NODE_H;
  public readonly STATE_TYPE_META = STATE_TYPE_META;

  /** Inline validation for the creation form — null means no error. */
  public newStateNameError = computed((): string | null => {
    if (!this.pendingNewState()) return null;
    const v = this.newStateName().trim();
    if (!v) return 'Le nom est obligatoire.';
    if (v.length < 2) return 'Au moins 2 caractères.';
    return null;
  });

  public newStateTimeoutError = computed((): string | null => {
    const v = this.newStateTimeoutHours();
    if (!v) return null; // field is optional
    const n = Number(v);
    if (isNaN(n) || n < 1 || !Number.isInteger(n)) return 'Entier positif requis.';
    return null;
  });

  /** True when the creation form is valid and can be submitted. */
  public newStateFormValid = computed(
    () => !!this.newStateName().trim() && !this.newStateNameError() && !this.newStateTimeoutError(),
  );

  /** Warn when the user is about to add a second Initial state. */
  public isDuplicateInitial = computed(
    () => this.pendingNewState()?.type === 'Initial' && this.states().some((s) => s.type === 'Initial'),
  );

  public selectedState = computed(() => this.states().find((s) => s.id === this.selectedStateId()) ?? null);
  public selectedTransition = computed(() => this.transitions().find((t) => t.id === this.selectedTransitionId()) ?? null);

  public canvasTransform = computed(
    () => `translate(${this.viewX()}px, ${this.viewY()}px) scale(${this.viewScale()})`,
  );

  public zoomPercent = computed(() => Math.round(this.viewScale() * 100));

  public connectingPath = computed(() => {
    const fromId = this.connectFrom();
    if (!fromId) return null;
    const src = this.states().find((s) => s.id === fromId);
    if (!src) return null;
    const sx = src.position.x + NODE_W;
    const sy = src.position.y + NODE_H / 2;
    const { x: tx, y: ty } = this.connectPt();
    return bezier(sx, sy, tx, ty);
  });

  public readonly paletteTypes = Object.keys(STATE_TYPE_META) as StateType[];

  public readonly typeSelectOptions = this.paletteTypes.map((k) => ({
    label: STATE_TYPE_META[k].label,
    value: k,
  }));

  // ── Lifecycle ────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this._loadCanvas();
  }

  // ── Persistence (meta = positions + visual types only) ───────────────────

  private _metaKey(): string {
    return `wf-meta-${this.id()}`;
  }

  private _loadMeta(): BuilderMeta {
    try {
      const raw = localStorage.getItem(this._metaKey());
      if (raw) return JSON.parse(raw);
    } catch {}
    return { positions: {}, types: {}, transitionNames: {} };
  }

  private _saveMeta(meta: BuilderMeta): void {
    localStorage.setItem(this._metaKey(), JSON.stringify(meta));
  }

  private _savePositions(): void {
    const meta = this._loadMeta();
    for (const state of this.states()) {
      meta.positions[state.id] = state.position;
    }
    this._saveMeta(meta);
  }

  // ── API load ─────────────────────────────────────────────────────────────

  private _loadCanvas(): void {
    this.isLoading.set(true);
    forkJoin({
      template: this._api.getWorkflowTemplate(this.id()),
      transitions: this._api.listWorkflowTransitions(this.id()),
    }).subscribe({
      next: ({ template, transitions }) => {
        const meta = this._loadMeta();
        const steps = template.steps ?? [];
        this.states.set(
          steps.map((step, i) => ({
            id: step.id!,
            code: `STEP_${step.order ?? i + 1}`,
            name: step.name ?? 'Étape',
            type: (meta.types?.[step.id!] as StateType) ?? 'Normal',
            position: meta.positions?.[step.id!] ?? { x: 80 + i * 260, y: 200 },
            description: step.description ?? null,
            approverRoleCode: step.approverRoleCode ?? null,
            timeoutHours: step.timeoutHours ?? null,
          })),
        );
        this.transitions.set(this._mapTransitions(transitions ?? [], meta));
        this.isLoading.set(false);
      },
      error: () => {
        this._snackbar.error('Erreur', 'Impossible de charger le workflow.');
        this.isLoading.set(false);
      },
    });
  }

  private _mapTransitions(dtos: TransitionDto[], meta: BuilderMeta): CanvasTransition[] {
    return dtos
      .filter((t) => t.fromStateId && t.toStateId)
      .map((t) => ({
        id: t.id!,
        sourceStateId: t.fromStateId!,
        targetStateId: t.toStateId!,
        name: meta.transitionNames?.[t.id!] ?? t.eventCode ?? '→',
      }));
  }

  private _reloadTransitions(): void {
    this._api.listWorkflowTransitions(this.id()).subscribe((dtos) => {
      this.transitions.set(this._mapTransitions(dtos ?? [], this._loadMeta()));
    });
  }

  // ── Palette: add state (WF-006) ───────────────────────────────────────────

  /** Opens the creation form in the right panel without touching the API yet. */
  public openNewStateForm(type: StateType): void {
    this.selectedStateId.set(null);
    this.selectedTransitionId.set(null);
    this.selectedTransitionActions.set([]);
    this._originalStateType = null;
    this.hasTypeChange.set(false);
    this.newStateName.set(STATE_TYPE_META[type].label);
    this.newStateDescription.set('');
    this.newStateRole.set('');
    this.newStateTimeoutHours.set('');
    this.pendingNewState.set({ type });
  }

  public cancelNewState(): void {
    this.pendingNewState.set(null);
  }

  /** Submits the creation form and calls the API. */
  public confirmAddState(): void {
    const pending = this.pendingNewState();
    if (!pending) return;
    const name = this.newStateName().trim();
    if (!name) return;

    const vp = this.viewportRef.nativeElement;
    const cx = (vp.clientWidth / 2 - this.viewX()) / this.viewScale();
    const cy = (vp.clientHeight / 2 - this.viewY()) / this.viewScale();
    const offset = this.states().filter((s) => s.type === pending.type).length * 24;
    const pos = { x: cx - NODE_W / 2 + offset, y: cy - NODE_H / 2 + offset };
    const order = this.states().length + 1;
    const timeoutHours = this.newStateTimeoutHours() ? +this.newStateTimeoutHours() : null;

    this.isSaving.set(true);
    this._api
      .addWorkflowStep(this.id(), {
        order,
        name,
        description: this.newStateDescription().trim() || null,
        approverRoleCode: this.newStateRole().trim() || null,
        timeoutHours,
      })
      .subscribe({
        next: (stepId) => {
          const meta = this._loadMeta();
          meta.positions[stepId] = pos;
          meta.types[stepId] = pending.type;
          this._saveMeta(meta);
          this.states.update((ss) => [
            ...ss,
            {
              id: stepId,
              code: `STEP_${order}`,
              name,
              type: pending.type,
              position: pos,
              description: this.newStateDescription().trim() || null,
              approverRoleCode: this.newStateRole().trim() || null,
              timeoutHours,
            },
          ]);
          this.selectedStateId.set(stepId);
          this.selectedTransitionId.set(null);
          this.pendingNewState.set(null);
          this._originalStateType = pending.type;
          this.hasTypeChange.set(false);
          this.isSaving.set(false);
        },
        error: () => {
          this._snackbar.error('Erreur', "Impossible d'ajouter l'étape.");
          this.isSaving.set(false);
        },
      });
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  public selectState(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedStateId.set(id);
    this.selectedTransitionId.set(null);
    this.pendingNewState.set(null);
    const state = this.states().find((s) => s.id === id);
    this._originalStateType = state?.type ?? null;
    this.hasTypeChange.set(false);
    // Pre-fill inline edit fields
    this.editStateName.set(state?.name ?? '');
    this.editStateDescription.set(state?.description ?? '');
    this.editStateRole.set(state?.approverRoleCode ?? '');
    this.editStateTimeout.set(state?.timeoutHours != null ? String(state.timeoutHours) : '');
  }

  public selectTransition(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedStateId.set(null);
    this.selectedTransitionId.set(id);
    this.selectedTransitionActions.set([]);
    if (!id.startsWith('temp-')) {
      this._loadTransitionActions(id);
    }
  }

  public clearSelection(): void {
    this.selectedStateId.set(null);
    this.selectedTransitionId.set(null);
    this.selectedTransitionActions.set([]);
    this.pendingNewState.set(null);
    this._originalStateType = null;
    this.hasTypeChange.set(false);
    this.editStateName.set('');
    this.editStateDescription.set('');
    this.editStateRole.set('');
    this.editStateTimeout.set('');
  }

  // ── Deletion ──────────────────────────────────────────────────────────────

  public deleteSelectedState(): void {
    const id = this.selectedStateId();
    if (!id) return;

    const state = this.states().find((s) => s.id === id);

    // WF-008: Block deletion of the last Initial state
    if (state?.type === 'Initial' && this.states().filter((s) => s.type === 'Initial').length === 1) {
      this._snackbar.error(
        'Suppression impossible',
        'Le workflow doit conserver au moins un état initial.',
      );
      return;
    }

    // WF-008: List affected transitions by name in the confirm message
    const affected = this.transitions().filter(
      (t) => t.sourceStateId === id || t.targetStateId === id,
    );
    const transitionLines = affected
      .map((t) => `· ${this.stateName(t.sourceStateId)} → ${this.stateName(t.targetStateId)}`)
      .join('\n');
    const message =
      affected.length > 0
        ? `L'étape "${state?.name}" sera supprimée ainsi que ${affected.length} transition${affected.length > 1 ? 's' : ''} :\n\n${transitionLines}`
        : `L'étape "${state?.name}" sera définitivement supprimée.`;

    this._confirm.confirm({
      title: "Supprimer l'étape",
      message,
      closable: true,
      acceptButtonProps: { label: 'Supprimer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isSaving.set(true);
        this._api.removeWorkflowStep(this.id(), id).subscribe({
          next: () => {
            this.states.update((ss) => ss.filter((s) => s.id !== id));
            this.transitions.update((ts) =>
              ts.filter((t) => t.sourceStateId !== id && t.targetStateId !== id),
            );
            this.selectedStateId.set(null);
            this.isSaving.set(false);
          },
          error: () => {
            this._snackbar.error('Erreur', "Impossible de supprimer l'étape.");
            this.isSaving.set(false);
          },
        });
      },
    });
  }

  public deleteSelectedTransition(): void {
    const id = this.selectedTransitionId();
    if (!id || id.startsWith('temp-')) return;
    this.isSaving.set(true);
    this._api.removeWorkflowTransition(this.id(), id).subscribe({
      next: () => {
        this.transitions.update((ts) => ts.filter((t) => t.id !== id));
        this.selectedTransitionId.set(null);
        this.isSaving.set(false);
      },
      error: () => {
        this._snackbar.error('Erreur', "Impossible de supprimer la transition.");
        this.isSaving.set(false);
      },
    });
  }

  // ── Property updates ──────────────────────────────────────────────────────

  /** Cancel a pending type change and revert the node to its original type (WF-007). */
  public cancelTypeEdit(): void {
    const id = this.selectedStateId();
    if (!id || !this._originalStateType) return;
    const original = this._originalStateType;
    this.states.update((ss) => ss.map((s) => (s.id === id ? { ...s, type: original } : s)));
    const meta = this._loadMeta();
    meta.types[id] = original;
    this._saveMeta(meta);
    this.hasTypeChange.set(false);
  }

  // ── Inline state field saves (P4) ─────────────────────────────────────────

  public saveStateName(name: string): void {
    const id = this.selectedStateId();
    const state = this.states().find((s) => s.id === id);
    if (!id || !state || !name.trim() || name.trim() === state.name) return;
    this._patchState(id, state, { name: name.trim() });
  }

  public saveStateDescription(description: string): void {
    const id = this.selectedStateId();
    const state = this.states().find((s) => s.id === id);
    if (!id || !state || description === (state.description ?? '')) return;
    this._patchState(id, state, { description: description.trim() || null });
  }

  public saveStateRole(role: string): void {
    const id = this.selectedStateId();
    const state = this.states().find((s) => s.id === id);
    if (!id || !state || role === (state.approverRoleCode ?? '')) return;
    this._patchState(id, state, { approverRoleCode: role.trim() || null });
  }

  public saveStateTimeout(val: string): void {
    const id = this.selectedStateId();
    const state = this.states().find((s) => s.id === id);
    if (!id || !state) return;
    const n = val ? Number(val) : null;
    if (n === state.timeoutHours) return;
    if (val && (isNaN(n!) || n! < 1 || !Number.isInteger(n!))) return;
    this._patchState(id, state, { timeoutHours: n });
  }

  private _patchState(id: string, state: CanvasState, patch: UpdateStepRequest): void {
    if (this.isUpdatingState()) return;
    this.isUpdatingState.set(true);
    const payload: UpdateStepRequest = {
      name: state.name,
      description: state.description,
      approverRoleCode: state.approverRoleCode,
      timeoutHours: state.timeoutHours,
      ...patch,
    };
    this._api.updateWorkflowStep(this.id(), id, payload).subscribe({
      next: () => {
        this.states.update((canvas) =>
          canvas.map((s) =>
            s.id === id
              ? {
                  ...s,
                  name: patch.name ?? s.name,
                  description: patch.description !== undefined ? patch.description : s.description,
                  approverRoleCode: patch.approverRoleCode !== undefined ? patch.approverRoleCode : s.approverRoleCode,
                  timeoutHours: patch.timeoutHours !== undefined ? patch.timeoutHours : s.timeoutHours,
                }
              : s,
          ),
        );
        this.isUpdatingState.set(false);
      },
      error: () => {
        this._snackbar.error('Erreur', "Impossible de mettre à jour l'étape.");
        // Revert edit fields to stored state values
        const s = this.states().find((s) => s.id === id);
        if (s) {
          this.editStateName.set(s.name ?? '');
          this.editStateDescription.set(s.description ?? '');
          this.editStateRole.set(s.approverRoleCode ?? '');
          this.editStateTimeout.set(s.timeoutHours != null ? String(s.timeoutHours) : '');
        }
        this.isUpdatingState.set(false);
      },
    });
  }

  public updateTransitionName(name: string): void {
    const id = this.selectedTransitionId();
    if (!id || id.startsWith('temp-')) return;
    this.transitions.update((ts) => ts.map((t) => (t.id === id ? { ...t, name } : t)));
    const meta = this._loadMeta();
    meta.transitionNames[id] = name;
    this._saveMeta(meta);
  }

  public updateStateType(type: StateType): void {
    const id = this.selectedStateId();
    if (!id) return;
    this.states.update((ss) => ss.map((s) => (s.id === id ? { ...s, type } : s)));
    const meta = this._loadMeta();
    meta.types[id] = type;
    this._saveMeta(meta);
    this.hasTypeChange.set(type !== this._originalStateType);
  }

  // ── Node drag ─────────────────────────────────────────────────────────────

  public onNodeMouseDown(state: CanvasState, event: MouseEvent): void {
    event.stopPropagation();
    if (this.connectFrom()) return;
    if ((event.target as HTMLElement).closest('[data-port]')) return;
    this._drag = {
      id: state.id,
      smx: event.clientX,
      smy: event.clientY,
      snx: state.position.x,
      sny: state.position.y,
    };
    this._didDrag = false;
  }

  // ── Connection ports ──────────────────────────────────────────────────────

  public onOutputPortMouseDown(stateId: string, event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.connectFrom.set(stateId);
    this.connectPt.set(this._screenToCanvas(event.clientX, event.clientY));
  }

  public onInputPortMouseUp(targetId: string, event: MouseEvent): void {
    event.stopPropagation();
    const fromId = this.connectFrom();
    if (!fromId || fromId === targetId) {
      this.connectFrom.set(null);
      return;
    }
    this.connectFrom.set(null);

    const exists = this.transitions().some(
      (t) => t.sourceStateId === fromId && t.targetStateId === targetId,
    );
    if (exists) return;

    // Optimistic temp transition
    const tempId = `temp-${Date.now()}`;
    const srcName = this.states().find((s) => s.id === fromId)?.name ?? '';
    const tgtName = this.states().find((s) => s.id === targetId)?.name ?? '';
    this.transitions.update((ts) => [
      ...ts,
      { id: tempId, sourceStateId: fromId, targetStateId: targetId, name: `${srcName} → ${tgtName}` },
    ]);

    this._api
      .addWorkflowTransition(this.id(), {
        fromStateId: fromId,
        toStateId: targetId,
        eventCode: 'manual',
        priority: this.transitions().length,
      })
      .subscribe({
        next: () => this._reloadTransitions(),
        error: () => {
          this.transitions.update((ts) => ts.filter((t) => t.id !== tempId));
          this._snackbar.error('Erreur', "Impossible d'ajouter la transition.");
        },
      });
  }

  // ── Canvas events ─────────────────────────────────────────────────────────

  public onCanvasMouseDown(event: MouseEvent): void {
    this.clearSelection();
    if (this._spaceDown || event.button === 1) {
      this._panning = true;
      this._panSmx = event.clientX;
      this._panSmy = event.clientY;
      this._panSvx = this.viewX();
      this._panSvy = this.viewY();
    }
  }

  @HostListener('document:mousemove', ['$event'])
  onDocMouseMove(event: MouseEvent): void {
    if (this._drag) {
      const scale = this.viewScale();
      const dx = (event.clientX - this._drag.smx) / scale;
      const dy = (event.clientY - this._drag.smy) / scale;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this._didDrag = true;
      this.states.update((ss) =>
        ss.map((s) =>
          s.id === this._drag!.id
            ? { ...s, position: { x: this._drag!.snx + dx, y: this._drag!.sny + dy } }
            : s,
        ),
      );
    }

    if (this.connectFrom()) {
      this.connectPt.set(this._screenToCanvas(event.clientX, event.clientY));
    }

    if (this._panning) {
      this.viewX.set(this._panSvx + event.clientX - this._panSmx);
      this.viewY.set(this._panSvy + event.clientY - this._panSmy);
    }
  }

  @HostListener('document:mouseup')
  onDocMouseUp(): void {
    if (this._drag && this._didDrag) {
      this._savePositions();
    }
    this._drag = null;
    this._didDrag = false;
    this._panning = false;
    if (this.connectFrom()) {
      this.connectFrom.set(null);
    }
  }

  public onWheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    const oldScale = this.viewScale();
    const newScale = Math.min(3, Math.max(0.15, oldScale * factor));
    const vp = this.viewportRef.nativeElement.getBoundingClientRect();
    const cx = event.clientX - vp.left;
    const cy = event.clientY - vp.top;
    const f = newScale / oldScale;
    this.viewX.set(cx + (this.viewX() - cx) * f);
    this.viewY.set(cy + (this.viewY() - cy) * f);
    this.viewScale.set(newScale);
  }

  // ── Zoom controls ─────────────────────────────────────────────────────────

  public zoomIn(): void {
    this._zoomCenter(1.2);
  }

  public zoomOut(): void {
    this._zoomCenter(0.8);
  }

  private _zoomCenter(factor: number): void {
    const vp = this.viewportRef.nativeElement;
    const cx = vp.clientWidth / 2;
    const cy = vp.clientHeight / 2;
    const oldScale = this.viewScale();
    const newScale = Math.min(3, Math.max(0.15, oldScale * factor));
    const f = newScale / oldScale;
    this.viewX.set(cx + (this.viewX() - cx) * f);
    this.viewY.set(cy + (this.viewY() - cy) * f);
    this.viewScale.set(newScale);
  }

  public fitToScreen(): void {
    const vp = this.viewportRef.nativeElement;
    if (this.states().length === 0) {
      this.viewX.set(60);
      this.viewY.set(40);
      this.viewScale.set(1);
      return;
    }
    const pad = 64;
    const xs = this.states().map((s) => s.position.x);
    const ys = this.states().map((s) => s.position.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const boundsW = Math.max(...xs) + NODE_W - minX;
    const boundsH = Math.max(...ys) + NODE_H - minY;
    const scale = Math.min(
      2,
      Math.max(0.15, Math.min((vp.clientWidth - pad * 2) / boundsW, (vp.clientHeight - pad * 2) / boundsH)),
    );
    this.viewScale.set(scale);
    this.viewX.set((vp.clientWidth - boundsW * scale) / 2 - minX * scale);
    this.viewY.set((vp.clientHeight - boundsH * scale) / 2 - minY * scale);
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    const tag = (event.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (event.code === 'Space') {
      event.preventDefault();
      this._spaceDown = true;
    }
    if (event.key === 'Escape') {
      this.clearSelection(); // also cancels pendingNewState
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.selectedStateId()) this.deleteSelectedState();
      else if (this.selectedTransitionId()) this.deleteSelectedTransition();
    }
  }

  @HostListener('document:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent): void {
    if (event.code === 'Space') this._spaceDown = false;
  }

  // ── Transition actions ────────────────────────────────────────────────────

  private _loadTransitionActions(transitionId: string): void {
    this._api.listWorkflowActions(this.id(), transitionId).subscribe({
      next: (actions) => this.selectedTransitionActions.set(actions ?? []),
    });
  }

  public addAction(): void {
    const transitionId = this.selectedTransitionId();
    if (!transitionId || transitionId.startsWith('temp-')) return;
    this.isAddingAction.set(true);
    this._api
      .addWorkflowAction(this.id(), transitionId, {
        actionType: this.newActionType(),
        executionOrder: this.selectedTransitionActions().length + 1,
      })
      .subscribe({
        next: () => {
          this._api.listWorkflowActions(this.id(), transitionId).subscribe((actions) => {
            this.selectedTransitionActions.set(actions ?? []);
            this.isAddingAction.set(false);
          });
        },
        error: () => {
          this._snackbar.error('Erreur', "Impossible d'ajouter l'action.");
          this.isAddingAction.set(false);
        },
      });
  }

  public removeAction(actionId: string): void {
    const transitionId = this.selectedTransitionId();
    if (!transitionId || !actionId) return;
    this.removingActionId.set(actionId);
    this._api.removeWorkflowAction(this.id(), transitionId, actionId).subscribe({
      next: () => {
        this.selectedTransitionActions.update((actions) => actions.filter((a) => a.id !== actionId));
        this.removingActionId.set(null);
      },
      error: () => {
        this._snackbar.error('Erreur', "Impossible de supprimer l'action.");
        this.removingActionId.set(null);
      },
    });
  }

  // ── SVG helpers ───────────────────────────────────────────────────────────

  public transitionPath(t: CanvasTransition): string {
    const src = this.states().find((s) => s.id === t.sourceStateId);
    const tgt = this.states().find((s) => s.id === t.targetStateId);
    if (!src || !tgt) return '';
    return bezier(
      src.position.x + NODE_W, src.position.y + NODE_H / 2,
      tgt.position.x, tgt.position.y + NODE_H / 2,
    );
  }

  public transitionMid(t: CanvasTransition): { x: number; y: number } | null {
    const src = this.states().find((s) => s.id === t.sourceStateId);
    const tgt = this.states().find((s) => s.id === t.targetStateId);
    if (!src || !tgt) return null;
    return {
      x: (src.position.x + NODE_W + tgt.position.x) / 2,
      y: (src.position.y + tgt.position.y) / 2 + NODE_H / 2,
    };
  }

  public stateName(id: string | undefined): string {
    return this.states().find((s) => s.id === id)?.name ?? '—';
  }

  private _screenToCanvas(sx: number, sy: number): { x: number; y: number } {
    const vp = this.viewportRef.nativeElement.getBoundingClientRect();
    return {
      x: (sx - vp.left - this.viewX()) / this.viewScale(),
      y: (sy - vp.top - this.viewY()) / this.viewScale(),
    };
  }
}

export default WorkflowBuilderPage;
