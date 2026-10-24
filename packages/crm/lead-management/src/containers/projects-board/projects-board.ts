import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { catchError, debounceTime, EMPTY, finalize, Subject } from 'rxjs';
import { OpportunitiesApiService, OpportunityDto } from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService, projectGateCode, projectGateMessage } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { formatAmount } from '../edit-lead/lead-view.models';
import { NewProjectDrawer } from './new-project-drawer';
import { currentStep, isClosed, OPEN_STAGES, probabilityPercent, projectSteps } from '../edit-lead/opportunities/opportunity.model';

/** Toutes les familles à la fois : les colonnes sont alors les cinq phases, communes à tous. */
const ALL = 'tous';
const BUILT_IN = 'standard';

interface Column {
  id: string;
  label: string;
  hint: string;
  projects: OpportunityDto[];
  amount: number;
}

function templateKey(opp: OpportunityDto): string {
  return opp.templateId ?? BUILT_IN;
}

/** Minuscules sans accents : « Koné » se trouve en tapant « kone ». */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Ce que la recherche lit d'un projet : son titre, son produit, et la personne — prénom, nom, nom
 * complet, téléphone, e-mail du lead, ou nom et numéro du client. Le téléphone est aussi indexé
 * sans espaces ni signes, pour qu'un numéro tapé d'une autre façon se retrouve.
 */
function searchText(p: OpportunityDto): string {
  const c = p.contact;
  const phoneDigits = (c?.phoneNumber ?? '').replace(/\D/g, '');
  return fold(
    [p.title, p.product, c?.name, c?.firstName, c?.lastName, c?.phoneNumber, phoneDigits, c?.email, c?.clientNumber]
      .filter(Boolean)
      .join(' '),
  );
}

/**
 * Le tableau des projets ouverts. Par parcours, les colonnes sont ses étapes et une carte se glisse
 * d'une étape à l'autre ; tous parcours confondus, ce sont les cinq phases, en lecture — glisser y
 * déplacerait par phase et ferait perdre au projet l'étape précise de son gabarit.
 */
@Component({
  selector: 'projects-board',
  imports: [FormsModule, RouterLink, CdkDropListGroup, CdkDropList, CdkDrag, Button, TasFormField, TasLabel, TasIcon, TasInput, TasSelect, TasSpinner],
  templateUrl: './projects-board.html',
})
export class ProjectsBoard implements OnInit {
  private readonly _api = inject(OpportunitiesApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _search$ = new Subject<string>();

  public readonly canManage = this._permissions.can('lead:opportunity:manage');
  public readonly formatAmount = formatAmount;
  public readonly probabilityPercent = probabilityPercent;

  public readonly projects = signal<OpportunityDto[]>([]);
  public readonly isLoading = signal(false);
  public readonly loadError = signal<string | null>(null);
  public readonly movingId = signal<string | null>(null);

  public readonly track = signal(ALL);
  public readonly search = signal('');
  private readonly _appliedSearch = signal('');

  private readonly _open = computed(() => this.projects().filter((p) => !isClosed(p)));

  /** Les parcours présents parmi les projets ouverts, avec leur nombre de projets. */
  public readonly trackOptions = computed(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const p of this._open()) {
      const key = templateKey(p);
      const entry = counts.get(key) ?? { label: p.templateName ?? 'Parcours standard', count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
    return [
      { value: ALL, label: `Tous les parcours (${this._open().length})` },
      ...[...counts.entries()]
        .sort((a, b) => a[1].label.localeCompare(b[1].label, 'fr'))
        .map(([value, e]) => ({ value, label: `${e.label} (${e.count})` })),
    ];
  });

  public readonly isByTemplate = computed(() => this.track() !== ALL);
  public readonly canDrag = computed(() => this.isByTemplate() && this.canManage());

  private readonly _visible = computed(() => {
    const terms = fold(this._appliedSearch().trim()).split(/\s+/).filter(Boolean);
    const track = this.track();
    // Chaque mot doit se trouver quelque part : « awa 0708 » trouve Awa par son prénom et son numéro.
    return this._open().filter(
      (p) =>
        (track === ALL || templateKey(p) === track) &&
        (terms.length === 0 || terms.every((t) => searchText(p).includes(t.replace(/^\+/, '')))),
    );
  });

  public readonly columns = computed<Column[]>(() => {
    const visible = this._visible();
    const sum = (list: OpportunityDto[]) => list.reduce((t, p) => t + (p.estimatedAmount?.amount ?? 0), 0);

    if (!this.isByTemplate()) {
      return OPEN_STAGES.map((s) => {
        const list = visible.filter((p) => p.stage === s.value);
        return { id: s.value, label: s.label, hint: `${s.probability} %`, projects: list, amount: sum(list) };
      });
    }

    const sample = visible[0] ?? this._open().find((p) => templateKey(p) === this.track());
    const steps = sample ? projectSteps(sample) : [];
    return steps.map((step) => {
      const list = visible.filter((p) => currentStep(p)?.id === step.id);
      return { id: step.id ?? '', label: step.label ?? '', hint: `${step.probability ?? 0} %`, projects: list, amount: sum(list) };
    });
  });

  public readonly columnIds = computed(() => this.columns().map((c) => 'col-' + c.id));
  public readonly totalAmount = computed(() => this._visible().reduce((t, p) => t + (p.estimatedAmount?.amount ?? 0), 0));

  public ngOnInit(): void {
    this._breadcrumb.set([{ label: 'Projets' }]);

    const params = this._route.snapshot.queryParamMap;
    this.track.set(params.get('parcours') || ALL);
    this.search.set(params.get('q') ?? '');
    this._appliedSearch.set(this.search());

    this._search$.pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef)).subscribe((q) => {
      this._appliedSearch.set(q);
      this._persist();
    });

    this.load();
  }

  public load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this._api
      .listOpportunities()
      .pipe(
        catchError(() => {
          this.loadError.set('Les projets n’ont pas pu être chargés.');
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((list) => {
        this.projects.set(list ?? []);
        // Un parcours retenu dans l'adresse qui n'a plus de projet ouvert retombe sur « tous ».
        if (this.track() !== ALL && !this.trackOptions().some((o) => o.value === this.track())) this.track.set(ALL);
      });
  }

  public openNew(): void {
    const ref = this._sideDrawer.open<string | false, void, NewProjectDrawer>(NewProjectDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });
    ref.closed.subscribe((id) => {
      if (id) this.load();
    });
  }

  public onSearch(value: string): void {
    this.search.set(value);
    this._search$.next(value);
  }

  public onTrack(value: string | null): void {
    this.track.set(value || ALL);
    this._persist();
  }

  public ownerLink(p: OpportunityDto): unknown[] | null {
    if (p.customerEntityId) return ['/customers', p.customerEntityId, 'projets'];
    if (p.leadId) return ['/leads', p.leadId, 'projets'];
    return null;
  }

  public onDrop(event: CdkDragDrop<Column, Column, OpportunityDto>): void {
    const project = event.item.data;
    const target = event.container.data;
    if (event.previousContainer === event.container || !this.canDrag() || this.movingId()) return;

    const previous = this.projects();
    const step = projectSteps(project).find((s) => s.id === target.id);
    if (!step) return;

    // Optimiste : la carte change de colonne tout de suite, et revient si le serveur refuse.
    this.projects.update((list) =>
      list.map((p) => (p.id === project.id ? { ...p, currentStepId: step.id, stepId: step.id } : p)),
    );
    this.movingId.set(project.id ?? null);

    this._api
      .moveOpportunityToStep(project.id!, { stepId: step.id!, expectedUpdatedAt: project.updatedAt ?? null })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.projects.set(previous);
          const gate = projectGateCode(error);
          this._snackbar.error(
            'Étape non enregistrée',
            gate
              ? projectGateMessage(gate, step.label ?? null) + ' Ouvrez le projet pour lever ce blocage.'
              : error.status === 409
              ? 'Ce projet a été modifié entre-temps. Rechargez avant de réessayer.'
              : error.status === 403
                ? "Vous n'avez pas le droit de déplacer ce projet."
                : 'Le déplacement a échoué.',
          );
          return EMPTY;
        }),
        finalize(() => this.movingId.set(null)),
      )
      .subscribe(() => {
        this._snackbar.success('Projet déplacé', `« ${project.title} » : ${step.label}.`);
        this.load();
      });
  }

  private _persist(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { parcours: this.track() === ALL ? null : this.track(), q: this._appliedSearch() || null },
      replaceUrl: true,
    });
  }
}

export default ProjectsBoard;
