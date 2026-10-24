import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { form, FormField, FormRoot, maxLength, submit, validate } from '@angular/forms/signals';
import { catchError, debounceTime, distinctUntilChanged, EMPTY, firstValueFrom, map, Observable, of, Subject, switchMap, tap } from 'rxjs';
import {
  ClientsApiService,
  FormFieldReferenceTargetEnum,
  LeadsApiService,
  OpportunitiesApiService,
} from '@sankore/crm-api';
import { currencyUnit, EntityFormReferences, projectCreationRules, projectSaveErrorMessage, TenantProvider } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTitle } from '@talisoft/ui/title';

type Target = 'lead' | 'client';

interface Candidate {
  id: string;
  label: string;
  detail: string;
  /** Le conseiller ou l'agent du lead : le projet le suit par défaut. */
  ownerId: string | null;
  /** Code du produit souhaité par le lead, quand il en a un. */
  productCode: string | null;
  amount: number | null;
}

/** Les leads qui ne prennent plus de projet : un lead converti a les siens sur la fiche client. */
const CLOSED_LEAD_STATUSES = new Set(['Converted', 'Lost', 'Disqualified', 'Archived']);

class NewProjectFormModel {
  public target!: Target;
  public subjectId!: string;
  public subjectLabel!: string;
  public title!: string;
  public description!: string;
  public product!: string;
  /** En texte, comme l'input le rend : converti à l'envoi. */
  public amount!: string;
  public expectedCloseDate!: string;

  public static instantiate(): NewProjectFormModel {
    const m = new NewProjectFormModel();
    m.target = 'lead';
    m.subjectId = '';
    m.subjectLabel = '';
    m.title = '';
    m.description = '';
    m.product = '';
    m.amount = '';
    m.expectedCloseDate = '';
    return m;
  }
}

function parseAmount(text: string): number | null {
  const cleaned = text.replace(/\s/g, '').replace(',', '.');
  return cleaned ? Number(cleaned) : null;
}

/**
 * Nouveau projet depuis le tableau des projets : sur un lead (le projet le suivra sur sa fiche
 * client à la conversion) ou directement sur un client existant. Le client exige un produit — le
 * serveur détecte un projet semblable déjà ouvert sur le même produit et demande confirmation.
 */
@Component({
  selector: 'new-project-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './new-project-drawer.html',
  imports: [
    FormsModule, FormRoot, FormField,
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle, Button,
    TasFormField, TasLabel, TasError, TasHint, TasInput, TasSelect, TasIcon, TasSpinner,
  ],
})
export class NewProjectDrawer {
  private readonly _dialogRef = inject(DialogRef<string | false>);
  private readonly _leadsApi = inject(LeadsApiService);
  /** La monnaie de l'institution : celle des totaux et des nouveaux montants. */
  public readonly currency = inject(TenantProvider).currency;
  public readonly currencyUnit = currencyUnit;
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _opportunitiesApi = inject(OpportunitiesApiService);
  private readonly _references = inject(EntityFormReferences);
  private readonly _snackbar = inject(SnackbarService);

  public readonly targetOptions: { value: Target; label: string }[] = [
    { value: 'lead', label: 'Un lead' },
    { value: 'client', label: 'Un client' },
  ];

  private readonly _products = toSignal(this._references.options(FormFieldReferenceTargetEnum.Product), { initialValue: [] });

  public model = signal(NewProjectFormModel.instantiate());
  /** Le gabarit du produit choisi : nom du montant, date critique. */
  public readonly rules = projectCreationRules(() => this.model().product);
  public formSchema = form(this.model, (schema) => {
    validate(schema.expectedCloseDate, (ctx) =>
      this.rules.criticalCloseDate() && this.rules.tracksForecast() && !ctx.value()
        ? { kind: 'required', message: 'Obligatoire pour ce produit' }
        : null,
    );
    validate(schema.subjectId, (ctx) => (ctx.value() ? null : { kind: 'required', message: 'Choisissez dans les résultats' }));
    validate(schema.title, (ctx) => (ctx.value().trim() ? null : { kind: 'required', message: 'Le titre est obligatoire' }));
    maxLength(schema.title, 200, { message: '200 caractères au plus' });
    maxLength(schema.description, 2000, { message: '2 000 caractères au plus' });
    // Le serveur l'exige pour un client : un projet sur une fiche existante porte sur un produit.
    validate(schema.product, (ctx) =>
      ctx.valueOf(schema.target) === 'client' && !ctx.value() ? { kind: 'required', message: 'Choisissez le produit' } : null,
    );
    validate(schema.amount, (ctx) => {
      const amount = parseAmount(ctx.value());
      return amount !== null && (Number.isNaN(amount) || amount <= 0)
        ? { kind: 'amount', message: 'Saisissez un montant positif, en chiffres' }
        : null;
    });
  });

  public readonly target = computed(() => this.model().target);
  public readonly productOptions = computed(() => [
    ...(this.target() === 'lead' ? [{ value: '', label: 'À préciser' }] : []),
    ...this._products().map((p) => ({ value: p.label, label: p.label })),
  ]);

  // ——— Recherche du lead ou du client ———

  public readonly searchTerm = signal('');
  public readonly results = signal<Candidate[]>([]);
  public readonly isSearching = signal(false);
  public readonly hasSearched = signal(false);
  private _owner: string | null = null;
  private readonly _search$ = new Subject<string>();

  /** Le nombre de projets semblables déjà ouverts que le serveur a signalés, ou null. */
  public readonly duplicateCount = signal<number | null>(null);

  constructor() {
    this._search$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap((term) => {
          this.isSearching.set(term.trim().length >= 2);
          if (term.trim().length < 2) {
            this.results.set([]);
            this.hasSearched.set(false);
          }
        }),
        switchMap((term) => (term.trim().length < 2 ? of(null) : this._searchCandidates(term.trim()))),
        takeUntilDestroyed(),
      )
      .subscribe((candidates) => {
        this.isSearching.set(false);
        if (!candidates) return;
        this.hasSearched.set(true);
        this.results.set(candidates);
      });
  }

  private _searchCandidates(term: string): Observable<Candidate[] | null> {
    if (this.target() === 'lead') {
      return this._leadsApi.listLeads(1, 8, undefined, undefined, undefined, undefined, undefined, term).pipe(
        map((page) =>
          (page.items ?? [])
            .filter((l) => l.id && !CLOSED_LEAD_STATUSES.has(l.status ?? ''))
            .map((l) => ({
              id: l.id!,
              label: l.fullName?.trim() || [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Lead sans nom',
              detail: [l.phoneNumber, l.interestedProduct && l.interestedProduct !== 'Unknown' ? l.interestedProduct : null]
                .filter(Boolean)
                .join(' · '),
              ownerId: l.currentAssignedId ?? l.ownerId ?? null,
              productCode: l.interestedProduct && l.interestedProduct !== 'Unknown' ? l.interestedProduct : null,
              amount: l.desiredAmount?.amount ?? null,
            })),
        ),
        catchError(() => {
          this._snackbar.error('Erreur', 'La recherche de leads a échoué.');
          return of(null);
        }),
      );
    }

    return this._clientsApi
      .searchClients(undefined, undefined, undefined, term, undefined, undefined, undefined, undefined, undefined, 1, 8)
      .pipe(
        map((page) =>
          (page.items ?? [])
            // Une fiche archivée ou fusionnée ne prend plus de projet.
            .filter((c) => c.id && c.status !== 'Archived' && c.status !== 'Merged')
            .map((c) => ({
              id: c.id!,
              label: c.displayName?.trim() || 'Client',
              detail: [c.clientNumber, c.agencyName].filter(Boolean).join(' · '),
              ownerId: c.advisorUserId ?? null,
              productCode: null,
              amount: null,
            })),
        ),
        catchError(() => {
          this._snackbar.error('Erreur', 'La recherche de clients a échoué.');
          return of(null);
        }),
      );
  }

  public setTarget(target: Target): void {
    if (this.target() === target) return;
    this.formSchema.target().value.set(target);
    this.clearSubject();
    this.searchTerm.set('');
    this.results.set([]);
    this.hasSearched.set(false);
    // « À préciser » n'existe pas pour un client.
    if (target === 'client' && !this.model().product) this.formSchema.product().value.set('');
  }

  public onSearchTermChange(term: string): void {
    this.searchTerm.set(term);
    this._search$.next(term);
  }

  public select(candidate: Candidate): void {
    this.formSchema.subjectId().value.set(candidate.id);
    this.formSchema.subjectLabel().value.set(candidate.label);
    this._owner = candidate.ownerId;
    this.results.set([]);
    this.duplicateCount.set(null);

    // Ce que le lead a déjà dit, repris tant que l'agent n'a rien saisi. Le lead porte le CODE du
    // produit ; le projet, son libellé.
    const product = this._products().find((p) => p.value === candidate.productCode)?.label;
    if (product && !this.model().product) this.formSchema.product().value.set(product);
    if (candidate.amount && !this.model().amount) this.formSchema.amount().value.set(String(candidate.amount));
    if (!this.model().title.trim()) {
      this.formSchema.title().value.set(product ? `${product} — ${candidate.label}` : `Projet — ${candidate.label}`);
    }
  }

  public clearSubject(): void {
    this.formSchema.subjectId().value.set('');
    this.formSchema.subjectLabel().value.set('');
    this._owner = null;
    this.duplicateCount.set(null);
  }

  // ——— Création ———

  public handleSubmit(force = false): void {
    submit(this.formSchema, async (field) => {
      const v = field().value();
      const amount = parseAmount(v.amount);
      const common = {
        title: v.title.trim(),
        description: v.description.trim() || null,
        estimatedAmount: amount,
        estimatedCurrency: amount !== null ? this.currency() : null,
        expectedCloseDate: v.expectedCloseDate && this.rules.tracksForecast() ? `${v.expectedCloseDate}T12:00:00Z` : null,
        ownerId: this._owner,
      };

      const call: Observable<string | null> =
        v.target === 'lead'
          ? this._opportunitiesApi
              .createOpportunity({ ...common, leadId: v.subjectId, product: v.product || null })
              .pipe(map((id) => id || null))
          : this._opportunitiesApi
              .createOpportunityForCustomer({ ...common, customerEntityId: v.subjectId, product: v.product, force })
              .pipe(
                map((result) => {
                  // Le doublon arrive en 200, sans projet créé : on demande confirmation.
                  if (result.duplicateDetected && !result.opportunityId) {
                    this.duplicateCount.set(result.existingOpportunityIds?.length ?? 0);
                    return null;
                  }
                  return result.opportunityId ?? null;
                }),
              );

      const id = await firstValueFrom(
        call.pipe(
          catchError((error: HttpErrorResponse) => {
            const message =
              error.status === 403
                ? "Vous n'avez pas le droit de créer ce projet."
                : projectSaveErrorMessage(error, 'Impossible de créer le projet.');
            this._snackbar.error('Projet non créé', message);
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );

      if (!id) return;
      this._snackbar.success(
        'Projet créé',
        v.target === 'lead' ? `« ${common.title} » est ajouté au lead.` : `« ${common.title} » est ajouté à la fiche du client.`,
      );
      this._dialogRef.close(id);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}

export default NewProjectDrawer;
