import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { TaskTypeDto, TaskTypesApiService } from '@sankore/crm-api';

/**
 * Les codes des types système. Le type d'une tâche est le code d'un type paramétré du tenant
 * (Paramétrage > Types de tâches) ; ces sept-là existent partout, ne se désactivent pas et sont
 * les seuls que l'application interprète (règles de clôture, tâche suivante suggérée, verbe
 * d'action de « Ma journée »). Un type ajouté par le tenant se traite comme une tâche générique.
 */
export const SYSTEM_TASK_TYPES = {
  FirstContact: 'FirstContact',
  Qualification: 'Qualification',
  SlaFollowUp: 'SlaFollowUp',
  ScoreReview: 'ScoreReview',
  OwnerHandover: 'OwnerHandover',
  ManualDispatch: 'ManualDispatch',
  Generic: 'Generic',
} as const;

/** Libellés de départ, en repli quand le paramétrage n'a pas pu être lu. */
const SYSTEM_TASK_TYPE_LABELS: Record<string, string> = {
  FirstContact: 'Premier contact',
  Qualification: 'Qualification',
  SlaFollowUp: 'Suivi SLA',
  ScoreReview: 'Revue score',
  OwnerHandover: 'Passation',
  ManualDispatch: 'Dispatch manuel',
  Generic: 'Générique',
};

/**
 * Le libellé d'un type de tâche : celui que le serveur a joint à la tâche (`typeLabel`, lu dans le
 * paramétrage), sinon le libellé de départ d'un type système, sinon le code.
 */
export function taskTypeLabel(code: string | null | undefined, given?: string | null): string {
  if (given) return given;
  if (!code) return '—';
  return SYSTEM_TASK_TYPE_LABELS[code] ?? code;
}

/**
 * Les types de tâches du tenant, chargés une fois pour toute l'application : libellés et choix
 * proposés dans les tiroirs de création. Un échec de chargement laisse les libellés de départ —
 * un écran de tâches ne doit pas tomber parce que le paramétrage est indisponible.
 */
@Injectable({ providedIn: 'root' })
export class TaskTypesStore {
  private readonly _api = inject(TaskTypesApiService);
  private _requested = false;

  public readonly types = signal<TaskTypeDto[]>([]);
  public readonly loaded = signal(false);

  /** Types actifs, dans l'ordre du paramétrage, au format de `tas-select`. */
  public readonly options = computed(() =>
    this.types()
      .filter((t) => t.isActive && t.code)
      .map((t) => ({ label: t.label || t.code!, value: t.code! })),
  );

  private readonly _labels = computed(() => {
    const labels: Record<string, string> = { ...SYSTEM_TASK_TYPE_LABELS };
    for (const t of this.types()) if (t.code && t.label) labels[t.code] = t.label;
    return labels;
  });

  /** Charge les types si personne ne l'a encore fait. */
  public ensureLoaded(): void {
    if (this._requested) return;
    this.refresh();
  }

  /** Recharge, après une modification dans le paramétrage. */
  public refresh(): void {
    this._requested = true;
    // La liste arrive triée par le serveur (ordre d'affichage, puis libellé).
    this._api.listTaskTypes().pipe(catchError(() => of(null))).subscribe((types) => {
      if (types) this.types.set(types);
      this.loaded.set(true);
    });
  }

  /**
   * Le libellé d'un type. `given` est celui que le serveur a joint à la tâche (`typeLabel`), à
   * préférer quand il est là ; sinon celui du paramétrage, sinon le code lui-même.
   * Lit un signal : utilisable dans un template ou un `computed`.
   */
  public label(code: string | null | undefined, given?: string | null): string {
    if (given) return given;
    if (!code) return '—';
    return this._labels()[code] ?? code;
  }
}
