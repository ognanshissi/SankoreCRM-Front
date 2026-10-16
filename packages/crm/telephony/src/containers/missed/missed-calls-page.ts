import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PageEvent } from '@angular/material/paginator';
import { EMPTY, Subject, catchError, mergeMap, switchMap } from 'rxjs';
import {
  MissedCallDto,
  RequestClickToCallRequestSlotEnum,
  TelephonyApiService,
} from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { telephonyEntityTypeLabel } from '../../data-access/telephony-referential';
import {
  DismissMissedCallDrawer,
  DismissMissedCallDrawerData,
  DismissMissedCallDrawerResult,
} from './dismiss-missed-call-drawer';
import {
  CALLBACK_IMPOSSIBLE_HINT,
  CREATE_LEAD_CONFIRMATION,
  MISSED_CONTEXT_FAILED,
  MISSED_CONTEXT_PENDING,
  MISSED_DEFAULT_PAGE_SIZE,
  MISSED_PAGE_SIZE_OPTIONS,
  MISSED_SINCE_OPTIONS,
  MissedContext,
  attemptCountLabel,
  attemptWindowLabel,
  knownSinceDays,
  missedContextOf,
  missedErrorMessage,
  missedSinceIso,
} from './missed-presentation';

/**
 * Nombre de contextes demandés en parallèle.
 *
 * Quatre, et pas « tous » : chaque lecture de contexte est une requête authentifiée qui
 * applique le périmètre côté serveur, et la liste des manqués n'est pas paginée. Ouvrir
 * cinquante requêtes à l'ouverture de l'écran saturerait la file du navigateur et
 * retarderait le reste de l'application pour un gain nul — les lignes apparaissent de
 * toute façon l'une après l'autre.
 */
const CONTEXT_CONCURRENCY = 4;

/**
 * TEL-F-09 — Appels manqués.
 *
 * Quatre points de conception.
 *
 * 1. **Le regroupement appartient au serveur.** Une ligne est une PERSONNE qui a essayé,
 *    pas un appel : les tentatives consécutives séparées de moins de trente minutes sont
 *    déjà réunies, et `callId` est la DERNIÈRE tentative — celle qui porte la lecture la
 *    plus récente de qui appelait. On ne regroupe rien ici.
 * 2. **Ni nom ni numéro dans la liste.** Chaque ligne doit donc lire
 *    `GET calls/{id}/context`. Ces lectures sont faites PAR PAGE AFFICHÉE, quatre à la
 *    fois, et mémorisées : revenir sur une page ne coûte rien, et une liste de soixante
 *    manqués ne déclenche pas soixante requêtes mais les vingt de la page ouverte. Rien
 *    n'est écrit dans le navigateur : la mémoire est un signal, perdu au rechargement.
 * 3. **Le rappel part d'une FICHE, jamais d'un numéro.** `POST calls/click-to-call` prend
 *    `entityType` + `entityId` + le créneau du numéro, et le numéro est lu côté serveur.
 *    Une ligne sans fiche rattachée n'a donc rien à composer : le bouton est absent et la
 *    raison est écrite, au lieu d'un bouton grisé sans explication.
 * 4. **La liste n'est pas paginée par le serveur.** Le tableau est donc déclaré
 *    `serverSide: true` et c'est l'écran qui tranche la page — ce qui est aussi ce qui
 *    rend la lecture des contextes exactement bornée à ce qui est visible.
 */
@Component({
  selector: 'lib-missed-calls-page',
  templateUrl: './missed-calls-page.html',
  imports: [
    DatePipe,
    FormsModule,
    Button,
    TasCard,
    TasFormField,
    TasHint,
    TasIcon,
    TasLabel,
    TasSelect,
    TasTable,
    TimeagoPipe,
  ],
})
export class MissedCallsPage implements OnInit {
  private readonly _telephonyApi = inject(TelephonyApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  public readonly canMakeCalls = this._permissions.can('Telephony.Call.Make');

  public readonly sinceOptions = MISSED_SINCE_OPTIONS;
  public readonly entityTypeLabel = telephonyEntityTypeLabel;
  public readonly attemptLabel = attemptCountLabel;
  public readonly windowLabel = attemptWindowLabel;
  public readonly callbackImpossibleHint = CALLBACK_IMPOSSIBLE_HINT;

  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  public readonly calls = signal<MissedCallDto[]>([]);
  public readonly contexts = signal<ReadonlyMap<string, MissedContext>>(new Map());
  public readonly expandedId = signal<string | null>(null);
  public readonly actionInProgress = signal<string | null>(null);

  /**
   * Ce que le serveur dit de MON poste. Sans lui, le bouton « Rappeler » se proposerait à
   * un agent dont le poste n'est pas rattaché, pour un 422 systématique ; et la story
   * TEL-F-05 existe précisément parce que l'utilisateur ne pouvait pas savoir pourquoi son
   * bouton manquait.
   */
  public readonly telephonyReady = signal(false);
  public readonly telephonyBlockedReason = signal<string | null>(null);

  public readonly filterSince = signal<string>('7');

  /** Le total de la file, tel que le badge de la barre supérieure le demanderait. */
  public readonly openCount = computed(() => this.calls().length);

  /**
   * La page affichée, tranchée ici : le serveur ne pagine pas cette lecture.
   *
   * Le tri est posé explicitement — du plus récent au plus ancien sur la DERNIÈRE
   * tentative — parce que l'ordre de la réponse n'est pas documenté et que, dans une file
   * de rappels, la tentative la plus récente est celle dont l'appelant attend encore.
   */
  public readonly sortedCalls = computed(() =>
    [...this.calls()].sort(
      (left, right) =>
        Date.parse(right.lastAttemptAt ?? '') - Date.parse(left.lastAttemptAt ?? ''),
    ),
  );

  public readonly pageRows = computed(() => {
    const { pageIndex, pageSize } = this.tableConfig().pagination;
    const start = pageIndex * pageSize;
    return this.sortedCalls().slice(start, start + pageSize);
  });

  public tableConfig = signal<TableConfig>({
    property: 'callId',
    pagination: {
      serverSide: true,
      pageIndex: 0,
      pageSize: MISSED_DEFAULT_PAGE_SIZE,
      pageSizeOptions: MISSED_PAGE_SIZE_OPTIONS,
      totalElements: 0,
    },
  });

  private readonly _load$ = new Subject<void>();
  private readonly _context$ = new Subject<string>();

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Téléphonie', link: ['/settings/telephony'] },
      { label: 'Appels manqués' },
    ]);

    this._setupLoader();
    this._setupContextLoader();
    this._restoreFilters();
    this._loadMyStatus();
    this._load();
  }

  // ——— Lecture d'une ligne ———

  public contextOf(callId: string | null | undefined): MissedContext {
    if (!callId) return MISSED_CONTEXT_FAILED;
    return this.contexts().get(callId) ?? MISSED_CONTEXT_PENDING;
  }

  public hasAttachedRecord(call: MissedCallDto): boolean {
    return !!call.entityType && !!call.entityId;
  }

  public canCallBack(call: MissedCallDto): boolean {
    return this.canMakeCalls() && this.telephonyReady() && this.hasAttachedRecord(call);
  }

  // ——— Interactions ———

  public toggleRow(call: MissedCallDto): void {
    const callId = call.callId;
    if (!callId) return;
    this.expandedId.update((current) => (current === callId ? null : callId));
  }

  public callBack(call: MissedCallDto, slot: 'Primary' | 'Secondary'): void {
    const callId = call.callId;
    if (!callId || !this.hasAttachedRecord(call)) return;

    this.actionInProgress.set(callId);
    this._telephonyApi
      .requestTelephonyClickToCall({
        entityType: call.entityType,
        entityId: call.entityId as string,
        // Le générateur sort un enum TypeScript nominal : un littéral de template ne lui
        // est pas assignable, d'où le passage par le membre de l'enum.
        slot:
          slot === 'Secondary'
            ? RequestClickToCallRequestSlotEnum.Secondary
            : RequestClickToCallRequestSlotEnum.Primary,
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Rappel impossible',
            missedErrorMessage(error, "Le rappel n'a pas pu être lancé."),
          );
          this.actionInProgress.set(null);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.actionInProgress.set(null);
        this._snackbar.success(
          'Rappel lancé',
          'Votre poste va sonner, puis le numéro de la fiche sera composé.',
        );
      });
  }

  public openDismiss(call: MissedCallDto): void {
    const callId = call.callId;
    if (!callId) return;

    const ref = this._sideDrawer.open<
      DismissMissedCallDrawerResult | null,
      DismissMissedCallDrawerData,
      DismissMissedCallDrawer
    >(DismissMissedCallDrawer, {
      data: {
        callId,
        attemptCount: call.attemptCount,
        contextLabel: this.contextOf(callId).label,
      } satisfies DismissMissedCallDrawerData,
      panelClass: 'side-drawer-panel',
    });

    ref.closed.subscribe((result) => {
      if (!result) return;
      this._snackbar.success(
        'Appel clôturé',
        "Il sort de la file. Le motif est consigné au journal d'audit.",
      );
      this._load();
    });
  }

  public confirmCreateLead(call: MissedCallDto): void {
    const callId = call.callId;
    if (!callId || !call.canCreateLead) return;

    this._confirm.confirm({
      title: CREATE_LEAD_CONFIRMATION.title,
      message: CREATE_LEAD_CONFIRMATION.message,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: CREATE_LEAD_CONFIRMATION.acceptLabel, theme: 'primary' },
      rejectButtonProps: { label: 'Fermer' },
      accept: () => this._createLead(callId),
    });
  }

  public onSinceChange(value: string | null): void {
    this.filterSince.set(knownSinceDays(value));
    this.expandedId.set(null);
    this._applyFilters();
  }

  public onPageChange(event: PageEvent): void {
    this.expandedId.set(null);
    this.tableConfig.update((config) => ({
      ...config,
      pagination: {
        ...config.pagination,
        pageIndex: event.pageIndex,
        pageSize: event.pageSize,
      },
    }));
    this._persistFilters();
    // La page a changé : ce sont les contextes de CETTE page qui manquent, pas les autres.
    this._requestVisibleContexts();
  }

  public reload(): void {
    this._load();
  }

  // ——— Chargement ———

  private _createLead(callId: string): void {
    this.actionInProgress.set(callId);
    this._telephonyApi
      .createLeadFromTelephonyCall(callId)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Création impossible',
            missedErrorMessage(error, "Le lead n'a pas pu être créé."),
          );
          this.actionInProgress.set(null);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.actionInProgress.set(null);
        if (result.leadId) {
          this._router.navigate(['/leads', result.leadId, 'edit']);
          return;
        }
        this._snackbar.success('Lead créé', "L'appel est rattaché au nouveau lead.");
        this._load();
      });
  }

  private _restoreFilters(): void {
    const params = this._route.snapshot.queryParams;
    this.filterSince.set(knownSinceDays(params['since']));

    const pageSize = Number(params['pageSize']);
    const page = Number(params['page']);
    this.tableConfig.update((config) => ({
      ...config,
      pagination: {
        ...config.pagination,
        // L'URL porte la page comme un humain la compte (1-based) ; le tableau travaille
        // en index 0-based.
        pageIndex: Number.isInteger(page) && page > 0 ? page - 1 : 0,
        pageSize: MISSED_PAGE_SIZE_OPTIONS.includes(pageSize)
          ? pageSize
          : MISSED_DEFAULT_PAGE_SIZE,
      },
    }));
  }

  private _persistFilters(): void {
    const pagination = this.tableConfig().pagination;
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        since: this.filterSince() === '7' ? null : this.filterSince(),
        page: pagination.pageIndex > 0 ? pagination.pageIndex + 1 : null,
        pageSize: pagination.pageSize === MISSED_DEFAULT_PAGE_SIZE ? null : pagination.pageSize,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Point de passage unique : retour en première page, URL, rechargement. */
  private _applyFilters(): void {
    this.tableConfig.update((config) => ({
      ...config,
      pagination: { ...config.pagination, pageIndex: 0 },
    }));
    this._persistFilters();
    this._load();
  }

  private _load(): void {
    this.isLoading.set(true);
    this._load$.next();
  }

  private _setupLoader(): void {
    this._load$
      .pipe(
        // `switchMap` : un changement de fenêtre pendant le chargement annule la requête
        // devenue obsolète, qui sinon pourrait écraser la plus récente.
        switchMap(() =>
          this._telephonyApi.listTelephonyMissedCalls(missedSinceIso(this.filterSince())).pipe(
            catchError((error: HttpErrorResponse) => {
              this.loadError.set(
                missedErrorMessage(error, "La liste des appels manqués n'a pas pu être chargée."),
              );
              this.calls.set([]);
              this.isLoading.set(false);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((calls) => {
        this.loadError.set(null);
        this.calls.set(calls);
        this.tableConfig.update((config) => ({
          ...config,
          pagination: { ...config.pagination, totalElements: calls.length },
        }));
        this.isLoading.set(false);
        // Les contextes d'une liste rechargée sont repartis de zéro : un appel a pu
        // changer de rattachement entre deux lectures.
        this.contexts.set(new Map());
        this._requestVisibleContexts();
      });
  }

  /** Une seule file de lectures de contexte, quatre en vol au plus. */
  private _setupContextLoader(): void {
    this._context$
      .pipe(
        mergeMap(
          (callId) =>
            this._telephonyApi.getTelephonyCallContext(callId).pipe(
              catchError(() => {
                this._putContext(callId, MISSED_CONTEXT_FAILED);
                return EMPTY;
              }),
            ),
          CONTEXT_CONCURRENCY,
        ),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((context) => {
        if (context.callId) this._putContext(context.callId, missedContextOf(context));
      });
  }

  private _requestVisibleContexts(): void {
    const known = this.contexts();
    const pending = new Map(known);
    const toFetch: string[] = [];

    for (const call of this.pageRows()) {
      const callId = call.callId;
      if (!callId || known.has(callId)) continue;
      pending.set(callId, { ...MISSED_CONTEXT_PENDING, state: 'loading' });
      toFetch.push(callId);
    }

    if (toFetch.length === 0) return;

    this.contexts.set(pending);
    for (const callId of toFetch) this._context$.next(callId);
  }

  private _putContext(callId: string, context: MissedContext): void {
    this.contexts.update((current) => {
      const next = new Map(current);
      next.set(callId, context);
      return next;
    });
  }

  private _loadMyStatus(): void {
    this._telephonyApi
      .getMyTelephonyStatus()
      .pipe(
        catchError(() => {
          // Sans cette lecture, l'écran reste utilisable : on ne propose simplement pas de
          // rappel, plutôt que de proposer un bouton qui échouerait.
          this.telephonyBlockedReason.set(
            "L'état de votre poste n'a pas pu être lu : le rappel n'est pas proposé.",
          );
          return EMPTY;
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((status) => {
        this.telephonyReady.set(status.canMakeCalls === true);

        if (status.canMakeCalls) {
          this.telephonyBlockedReason.set(null);
          return;
        }

        // Les quatre états de `linkStatus` ne se réparent pas de la même façon : la phrase
        // le dit, parce que c'est la seule lecture dont l'agent lui-même dispose.
        if (status.telephonyEnabled === false) {
          this.telephonyBlockedReason.set(
            "La téléphonie n'est pas activée pour votre établissement : le rappel depuis cet écran n'est pas disponible.",
          );
        } else if (status.linkStatus === 'NotLinked') {
          this.telephonyBlockedReason.set(
            "Votre poste n'est rattaché à aucun compte du fournisseur : demandez le rattachement dans « Rattachement des postes ».",
          );
        } else if (status.linkStatus === 'Disabled') {
          this.telephonyBlockedReason.set(
            'Votre rattachement de poste a été désactivé par un administrateur, avec un motif consigné.',
          );
        } else {
          this.telephonyBlockedReason.set(
            "Vous n'avez pas le droit de passer des appels depuis le CRM.",
          );
        }
      });
  }
}

export default MissedCallsPage;
