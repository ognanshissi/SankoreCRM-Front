import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormField, FormRoot, form, required, submit } from '@angular/forms/signals';
import { EMPTY, Observable, Subject, catchError, debounceTime, firstValueFrom, map, of, switchMap } from 'rxjs';
import { ClientsApiService, LeadsApiService, TelephonyApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTitle } from '@talisoft/ui/title';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TelephonyEntityType,
  telephonyEntityTypeLabel,
} from '../../data-access/telephony-referential';
import {
  JOURNAL_ENTITY_TYPE_OPTIONS,
  LINK_CORRECTION_NOTICE,
  LINK_REASON_HINT,
  journalErrorMessage,
} from './journal-presentation';

export interface LinkCallDrawerData {
  callId: string;
  /** Rattachement actuel, s'il y en a un : le texte change quand on CORRIGE au lieu de poser. */
  currentEntityType: string | null | undefined;
  currentEntityId: string | null | undefined;
}

export interface LinkCallDrawerResult {
  callId: string;
  entityType: TelephonyEntityType;
  entityId: string;
  displayName: string;
}

/** Une fiche candidate, quelle que soit sa famille : la liste se rend de la même façon. */
interface TargetCandidate {
  entityId: string;
  displayName: string;
  secondaryLine: string;
}

class LinkCallFormModel {
  public entityType!: string;
  public entityId!: string;
  public reason!: string;

  public static instantiate(entityType: string): LinkCallFormModel {
    const model = new LinkCallFormModel();
    model.entityType = entityType;
    model.entityId = '';
    model.reason = '';
    return model;
  }
}

/**
 * Rattachement d'un appel à une fiche (TEL-F-08, action « Rattacher »).
 *
 * Deux choses viennent du contrat et ne sont pas des choix d'ergonomie.
 *
 * 1. **La fiche se CHERCHE, elle ne se saisit pas.** `POST calls/{id}/link` veut un
 *    `entityId` en `format: uuid` et refuse tout le reste ; et surtout, la fiche doit être
 *    une fiche que l'utilisateur peut travailler (périmètre d'agence pour un client, règle
 *    assigné-ou-superviseur pour un lead). Une recherche rend ce périmètre visible avant
 *    l'envoi, là qu'un champ d'identifiant collé ne produirait qu'un 403 après coup.
 * 2. **Le motif est obligatoire et part au journal d'audit.** Il n'est pas stocké sur
 *    l'appel : un rattachement manuel écrase le rattachement automatique et n'est plus
 *    corrigé par les balayages du serveur, donc celui qui relira la fiche dans six mois a
 *    besoin de la phrase qui explique pourquoi.
 */
@Component({
  selector: 'lib-link-call-drawer',
  templateUrl: './link-call-drawer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    FormsModule,
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    Button,
    TasFormField,
    TasLabel,
    TasHint,
    TasError,
    TasInput,
    TasSelect,
    TasSpinner,
    TasIcon,
  ],
})
export class LinkCallDrawer {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _telephonyApi = inject(TelephonyApiService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly data = inject<LinkCallDrawerData>(DIALOG_DATA);

  public readonly entityTypeOptions = JOURNAL_ENTITY_TYPE_OPTIONS;
  public readonly reasonHint = LINK_REASON_HINT;
  public readonly correctionNotice = LINK_CORRECTION_NOTICE;
  public readonly entityTypeLabel = telephonyEntityTypeLabel;

  public readonly isCorrection = !!this.data.currentEntityId;

  public readonly searchTerm = signal('');
  public readonly isSearching = signal(false);
  public readonly hasSearched = signal(false);
  public readonly candidates = signal<TargetCandidate[]>([]);
  public readonly selected = signal<TargetCandidate | null>(null);

  public model = signal(LinkCallFormModel.instantiate('Lead'));

  public formSchema = form(this.model, (schema) => {
    required(schema.entityType, { message: 'Choisissez le type de fiche' });
    required(schema.entityId, { message: 'Sélectionnez une fiche dans la liste' });
    required(schema.reason, {
      message: "Le motif est obligatoire : il est conservé au journal d'audit",
    });
  });

  public readonly searchHint = computed(() =>
    this.model().entityType === 'Customer'
      ? 'Nom du client. Seuls les clients de votre périmètre sont proposés.'
      : "Nom du lead. Seuls les leads que vous pouvez travailler sont proposés.",
  );

  private readonly _search$ = new Subject<void>();

  constructor() {
    // `switchMap` plutôt que `subscribe` imbriqué : sans lui, la réponse d'une frappe
    // abandonnée peut arriver après celle de la frappe courante et réécrire la liste.
    this._search$
      .pipe(
        debounceTime(300),
        switchMap(() => this._searchRequest()),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((candidates) => {
        this.candidates.set(candidates);
        this.hasSearched.set(true);
        this.isSearching.set(false);
      });
  }

  public onEntityTypeChange(value: string | null): void {
    const entityType = value === 'Customer' ? 'Customer' : 'Lead';

    // La fiche retenue appartenait à l'autre famille : la garder enverrait un `entityId`
    // de lead avec `entityType: 'Customer'`, que le serveur refuserait en nommant la
    // fiche introuvable.
    this.selected.set(null);
    this.candidates.set([]);
    this.hasSearched.set(false);

    this.model.update((previous) => {
      const next = LinkCallFormModel.instantiate(entityType);
      next.reason = previous.reason;
      return next;
    });

    if (this.searchTerm().trim().length >= 2) {
      this.isSearching.set(true);
      this._search$.next();
    }
  }

  public onSearchChange(value: string | null): void {
    this.searchTerm.set(value ?? '');
    if ((value ?? '').trim().length >= 2) this.isSearching.set(true);
    this._search$.next();
  }

  public candidateRowClass(candidate: TargetCandidate): string {
    const isSelected = candidate.entityId === this.selected()?.entityId;
    return `cursor-pointer hover:bg-slate-50${isSelected ? ' bg-slate-50' : ''}`;
  }

  public selectCandidate(candidate: TargetCandidate): void {
    this.selected.set(candidate);
    this.model.update((previous) => {
      const next = LinkCallFormModel.instantiate(previous.entityType);
      next.entityId = candidate.entityId;
      next.reason = previous.reason;
      return next;
    });
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const linked = await firstValueFrom(
        this._telephonyApi
          .linkTelephonyCall(this.data.callId, {
            entityType: value.entityType,
            entityId: value.entityId,
            reason: value.reason.trim(),
          })
          .pipe(
            // 204 sans corps : `map` donne au succès une valeur lisible. Un `EMPTY` sur
            // l'erreur ferait rejeter `firstValueFrom` et la soumission remonterait une
            // exception au lieu d'un refus affiché.
            map(() => true),
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error(
                'Rattachement refusé',
                journalErrorMessage(error, "Le rattachement n'a pas abouti."),
              );
              return of(false);
            }),
          ),
      );

      if (!linked) return;

      this._dialogRef.close({
        callId: this.data.callId,
        entityType: value.entityType as TelephonyEntityType,
        entityId: value.entityId,
        displayName: this.selected()?.displayName ?? '',
      } satisfies LinkCallDrawerResult);
    });
  }

  public close(): void {
    this._dialogRef.close();
  }

  private _searchRequest(): Observable<TargetCandidate[]> {
    const term = this.searchTerm().trim();

    if (term.length < 2) {
      this.candidates.set([]);
      this.hasSearched.set(false);
      this.isSearching.set(false);
      return EMPTY;
    }

    if (this.model().entityType === 'Customer') {
      return this._clientsApi
        .searchClients(
          undefined,
          // Jamais par numéro : aucune lecture téléphonique ne renvoie le numéro de
          // l'appelant, donc le front n'en détient pas pour chercher avec.
          undefined,
          undefined,
          term,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          1,
          25,
        )
        .pipe(
          map((result) =>
            (result.items ?? []).map((client) => ({
              entityId: client.id ?? '',
              displayName: client.displayName || '—',
              secondaryLine: [client.clientNumber, client.agencyName]
                .filter((part) => !!part)
                .join(' · '),
            })),
          ),
          catchError(() => {
            this._snackbar.error('Erreur', 'La recherche de clients a échoué.');
            this.isSearching.set(false);
            return EMPTY;
          }),
        );
    }

    return this._leadsApi
      .listLeads(1, 25, undefined, undefined, undefined, undefined, undefined, term)
      .pipe(
        map((result) =>
          (result.items ?? []).map((lead) => ({
            entityId: lead.id ?? '',
            displayName: lead.fullName || lead.companyName || '—',
            secondaryLine: [lead.status, lead.source].filter((part) => !!part).join(' · '),
          })),
        ),
        catchError(() => {
          this._snackbar.error('Erreur', 'La recherche de leads a échoué.');
          this.isSearching.set(false);
          return EMPTY;
        }),
      );
  }
}
