import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { LeadDto, LeadsApiService, ProductSuggestionDto, ProjectSuggestionDto } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { CreateOpportunityDrawer, CreateOpportunityDrawerData } from './opportunities/create-opportunity-drawer';

const BASIS_LABELS: Record<string, string> = {
  Code: 'reconnu par son code',
  Name: 'reconnu par son nom',
  SimilarName: 'nom proche',
  Description: 'd’après sa description',
};

const dismissKey = (leadId: string) => `lead-project-suggestion-dismissed:${leadId}`;

/**
 * « Créer un projet pour ce produit ? » (demande du propriétaire, 2026-10-31) : quand le produit
 * souhaité du lead ressemble à un produit du catalogue — son code, son nom même mal écrit, ou les
 * mots de sa description — la fiche le propose, et la création s'ouvre avec ce produit. Le serveur
 * ne propose rien pour un lead clos, ni pour un produit qu'un projet ouvert porte déjà.
 *
 * « Ignorer » ne vaut que pour ce lead et ce produit, dans ce navigateur : c'est une aide, pas une
 * décision à partager.
 */
@Component({
  selector: 'lead-project-suggestion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, TasIcon],
  template: `
    @if (shown(); as s) {
      @let p = chosen()!;
      <section class="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-primary/15 bg-primary/5 px-5 py-3" aria-label="Proposition de projet">
        <span class="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
          <tas-icon iconName="feather:briefcase" style="font-size:15px"></tas-icon>
        </span>
        <div class="min-w-0 flex-1 basis-72">
          <p class="text-sm text-slate-800">
            Le prospect a demandé « {{ s.interestedProduct }} » : c’est le produit
            <span class="font-semibold">{{ p.name }}</span>
            <span class="text-slate-500"> ({{ p.code }}, {{ basisLabel(p) }})</span>.
          </p>
          @if (others().length) {
            <p class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              Ou plutôt :
              @for (o of others(); track o.code) {
                <button type="button" class="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-700 hover:border-primary"
                        (click)="choose(o)">{{ o.name }}</button>
              }
            </p>
          }
        </div>
        <div class="flex shrink-0 items-center gap-2">
          @if (canCreate()) {
            <button tas-raised-button color="primary" type="button" (click)="create(p)">Créer le projet</button>
          }
          <button tas-text-button color="primary" type="button" (click)="dismiss()">Ignorer</button>
        </div>
      </section>
    }
  `,
})
export class ProjectSuggestionBanner {
  private readonly _api = inject(LeadsApiService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _router = inject(Router);

  public readonly lead = input.required<LeadDto>();

  public readonly canCreate = inject(PermissionsService).can('lead:opportunity:manage');
  public readonly suggestion = signal<ProjectSuggestionDto | null>(null);
  private readonly _chosenCode = signal<string | null>(null);
  private readonly _dismissed = signal<string[]>([]);

  public readonly products = computed(() =>
    (this.suggestion()?.products ?? []).filter((p) => !this._dismissed().includes(p.code ?? '')),
  );
  public readonly chosen = computed(() => {
    const all = this.products();
    return all.find((p) => p.code === this._chosenCode()) ?? all[0] ?? null;
  });
  public readonly others = computed(() => this.products().filter((p) => p.code !== this.chosen()?.code));
  public readonly shown = computed(() => (this.chosen() ? this.suggestion() : null));

  constructor() {
    // Relu quand la fiche relit le lead : un produit souhaité modifié change la proposition.
    effect(() => {
      const lead = this.lead();
      if (lead.id) this._load(lead.id);
    });
  }

  public basisLabel(p: ProductSuggestionDto): string {
    return BASIS_LABELS[p.basis ?? ''] ?? 'produit proche';
  }

  public choose(p: ProductSuggestionDto): void {
    this._chosenCode.set(p.code ?? null);
  }

  public create(p: ProductSuggestionDto): void {
    const lead = this.lead();
    const ref = this._sideDrawer.open<string | false, CreateOpportunityDrawerData, CreateOpportunityDrawer>(
      CreateOpportunityDrawer,
      { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data: { lead, product: p.name ?? undefined } },
    );
    ref.closed.subscribe((id) => {
      if (id) void this._router.navigate(['/leads/projets', id]);
    });
  }

  public dismiss(): void {
    const lead = this.lead();
    const code = this.chosen()?.code;
    if (!lead.id || !code) return;
    const next = [...this._dismissed(), code];
    this._dismissed.set(next);
    try {
      localStorage.setItem(dismissKey(lead.id), JSON.stringify(next));
    } catch {
      // Stockage indisponible (navigation privée) : l'oubli vaut pour cette visite seulement.
    }
  }

  private _load(leadId: string): void {
    let dismissed: string[] = [];
    try {
      dismissed = JSON.parse(localStorage.getItem(dismissKey(leadId)) ?? '[]');
    } catch {
      dismissed = [];
    }
    this._dismissed.set(Array.isArray(dismissed) ? dismissed : []);
    this._chosenCode.set(null);
    this._api.getLeadProjectSuggestion(leadId).pipe(catchError(() => EMPTY)).subscribe((s) => this.suggestion.set(s ?? null));
  }
}
