import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { applyEach, form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { EMPTY, catchError, finalize, firstValueFrom } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { SideDrawerService, TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import {
  IngestionDto,
  IngestionsApiService,
  LeadDto,
  LeadsApiService,
  ReprocessIngestionResult,
} from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import {
  EMPTY_GUID,
  LEAD_LINK_TARGETS,
  MissingLeadFields,
  NAME_TARGETS,
  ParsedPayload,
  guessFieldLinks,
  ingestionReasonLabel,
  ingestionStatusLabel,
  ingestionStatusSeverity,
  isReplayableIngestion,
  missingLeadFields,
  parseIngestionPayload,
} from './ingestion.types';

export interface IngestionDetailDrawerData {
  ingestion: IngestionDto;
  canReplay: boolean;
  /** Source « script embarqué » : l'ID externe y est un GUID tiré au sort, sans intérêt. */
  isScript: boolean;
}

/**
 * `'replay'` : l'utilisateur demande le rejeu, que l'écran appelant exécute.
 * `'reprocessed'` : un lead a été créé depuis le drawer, la liste doit être rechargée.
 */
export type IngestionDetailDrawerResult = 'replay' | 'reprocessed' | undefined;

/** Alias et non interface : `tas-select` attend des objets à signature d'index. */
type KeyOption = { label: string; value: string };

function leadStatusMeta(status: string | null | undefined): { label: string; severity: Severity } {
  switch (status) {
    case 'New':       return { label: 'Nouveau',  severity: 'info' };
    case 'Open':      return { label: 'Contacté', severity: 'warning' };
    case 'Qualified': return { label: 'Qualifié', severity: 'warning' };
    case 'Converted': return { label: 'Converti', severity: 'success' };
    case 'Lost':      return { label: 'Perdu',    severity: 'error' };
    case 'Expired':   return { label: 'Expiré',   severity: 'neutral' };
    default:          return { label: status ?? '—', severity: 'neutral' };
  }
}

/** Une ligne « champ du lead ← clé du payload » ; chaîne vide = pas encore choisi. */
class FieldLinkRow {
  public target!: string;
  public key!: string;

  public static of(target: string, key: string): FieldLinkRow {
    return Object.assign(new FieldLinkRow(), { target, key });
  }
}

class FieldLinksFormModel {
  public links!: FieldLinkRow[];

  public static instantiate(): FieldLinksFormModel {
    return Object.assign(new FieldLinksFormModel(), { links: [] });
  }

  /**
   * Une ligne par champ obligatoire manquant, pré-remplie d'après les noms usuels du
   * formulaire, plus l'e-mail s'il est repérable. L'opérateur complète ou corrige.
   */
  public static suggested(keys: string[], missing: MissingLeadFields | null): FieldLinksFormModel {
    const guess = guessFieldLinks(keys);
    const links: FieldLinkRow[] = [];
    if (missing?.phone) links.push(FieldLinkRow.of('phoneNumber', guess.phoneNumber));
    if (missing?.name) {
      if (guess.firstName || guess.lastName) {
        links.push(FieldLinkRow.of('firstName', guess.firstName));
        links.push(FieldLinkRow.of('lastName', guess.lastName));
      } else {
        links.push(FieldLinkRow.of('fullName', guess.fullName));
      }
    }
    if (guess.email) links.push(FieldLinkRow.of('email', guess.email));
    return Object.assign(new FieldLinksFormModel(), { links });
  }
}

export function openIngestionDetail(
  sideDrawer: SideDrawerService,
  data: IngestionDetailDrawerData,
): DialogRef<IngestionDetailDrawerResult, IngestionDetailDrawer> {
  return sideDrawer.open<IngestionDetailDrawerResult, IngestionDetailDrawerData, IngestionDetailDrawer>(
    IngestionDetailDrawer,
    { width: '560px', height: '100%', panelClass: 'side-drawer-panel', data },
  );
}

@Component({
  selector: 'ingestion-detail-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, Button, TasIcon, TasSpinner, TasTag, TasSelect,
    TasFormField, TasLabel, TasError, FormRoot, FormField,
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <div class="flex items-center gap-2">
          <tas-icon iconName="feather:inbox" style="font-size:18px"></tas-icon>
          <span>Détail de la réception</span>
        </div>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-4">
          <!-- Réception -->
          <div class="rounded-lg border border-slate-200 p-3">
            <div class="flex items-center justify-between gap-2">
              <p class="text-sm font-semibold text-slate-800">
                Reçue le {{ ingestion.ingestedAt | date:'dd/MM/yyyy à HH:mm:ss' }}
              </p>
              <tas-tag [severity]="statusSeverity()">{{ statusLabel() }}</tas-tag>
            </div>
            @if (!data.isScript && ingestion.externalId) {
              <p class="mt-1 text-xs text-slate-500">
                ID externe <span class="font-mono text-slate-700">{{ ingestion.externalId }}</span>
              </p>
            }
            @if (ingestion.rejectionReason && !reprocessed()) {
              <div class="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                <p class="text-xs font-medium text-red-700">Motif</p>
                <p class="text-xs text-red-600 mt-0.5 break-words" [title]="ingestion.rejectionReason">
                  {{ reasonLabel }}
                </p>
              </div>
            }
          </div>

          <!-- Lead créé depuis ce drawer -->
          @if (reprocessed(); as r) {
            <div class="rounded-lg border border-green-200 bg-green-50 px-3 py-2 flex items-start gap-2">
              <tas-icon iconName="feather:check-circle" class="text-green-600 mt-0.5" style="font-size:14px"></tas-icon>
              <p class="text-xs text-green-800">
                @if (r.status === 'Duplicate') {
                  Un lead ouvert existe déjà avec ce numéro : la réception lui a été rattachée comme doublon.
                } @else {
                  Lead créé à partir de cette réception, qui est désormais acceptée.
                }
              </p>
            </div>
          }

          <!-- Lead -->
          <section class="rounded-lg border border-slate-200">
            <p class="px-3 py-2 border-b border-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Lead
            </p>
            <div class="p-3">
              @if (!leadId()) {
                <p class="text-sm text-slate-500">Aucun lead n'a été créé pour cette réception.</p>
              } @else if (!canReadLead()) {
                <p class="text-sm text-slate-500">Vous n'avez pas le droit de consulter les leads.</p>
              } @else if (isLoadingLead()) {
                <div class="flex justify-center py-4"><tas-spinner size="5" class="text-primary"></tas-spinner></div>
              } @else if (leadError()) {
                <p class="text-sm text-slate-600">{{ leadError() }}</p>
              } @else if (lead(); as l) {
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="text-sm font-semibold text-slate-900 truncate">{{ leadName() }}</p>
                    @if (l.companyName) {
                      <p class="text-xs text-slate-500 truncate">{{ l.companyName }}</p>
                    }
                  </div>
                  <tas-tag [severity]="leadStatus().severity">{{ leadStatus().label }}</tas-tag>
                </div>
                <dl class="mt-3 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-xs">
                  @if (l.phoneNumber) {
                    <dt class="text-slate-500">Téléphone</dt><dd class="text-slate-800 tabular-nums">{{ l.phoneNumber }}</dd>
                  }
                  @if (l.email) {
                    <dt class="text-slate-500">E-mail</dt><dd class="text-slate-800 break-all">{{ l.email }}</dd>
                  }
                  @if (l.interestedProduct) {
                    <dt class="text-slate-500">Produit</dt><dd class="text-slate-800">{{ l.interestedProduct }}</dd>
                  }
                  @if (l.campaign) {
                    <dt class="text-slate-500">Campagne</dt><dd class="text-slate-800">{{ l.campaign }}</dd>
                  }
                  @if (l.comment) {
                    <dt class="text-slate-500">Commentaire</dt><dd class="text-slate-800 whitespace-pre-line">{{ l.comment }}</dd>
                  }
                  <dt class="text-slate-500">Créé le</dt><dd class="text-slate-800">{{ l.createdAt | date:'dd/MM/yyyy HH:mm' }}</dd>
                </dl>
                <button tas-outlined-button type="button" class="mt-3" (click)="openLead()">
                  <tas-icon iconName="feather:external-link" style="font-size:12px"></tas-icon>
                  Ouvrir la fiche du lead
                </button>
              }
            </div>
          </section>

          <!-- Compléter une réception échouée -->
          @if (completion(); as missing) {
            <section class="rounded-lg border border-blue-200">
              <div class="px-3 py-2 border-b border-blue-100 bg-blue-50 rounded-t-lg">
                <p class="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  Compléter et créer le lead
                </p>
                <p class="text-xs text-slate-600 mt-0.5">
                  Indiquez quel champ reçu porte chaque information manquante. Le lead est créé
                  à partir des données de cette réception, qui passe alors en « Accepté ».
                </p>
              </div>
              <form [formRoot]="linkForm" class="p-3 flex flex-col gap-2">
                <div class="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2 text-[11px] font-medium text-slate-500">
                  <span>Champ du lead</span><span></span><span>Champ reçu</span><span></span>
                </div>
                @for (row of linkForm.links; track $index; let i = $index) {
                  <div class="grid grid-cols-[1fr_auto_1fr_auto] items-start gap-2">
                    <tas-form-field>
                      <tas-label class="sr-only">Champ du lead</tas-label>
                      <tas-select [options]="targetOptionsFor(i)" placeholder="Choisissez un champ"
                                  [formField]="row.target"></tas-select>
                      @if (row.target().touched() && row.target().invalid()) {
                        <tas-error>{{ row.target().errors()[0].message }}</tas-error>
                      }
                    </tas-form-field>
                    <tas-icon iconName="feather:arrow-left" class="text-slate-300 mt-2.5" style="font-size:14px"></tas-icon>
                    <tas-form-field>
                      <tas-label class="sr-only">Champ reçu</tas-label>
                      <tas-select [options]="keyOptions()" placeholder="Choisissez le champ reçu"
                                  [formField]="row.key"></tas-select>
                      @if (row.key().touched() && row.key().invalid()) {
                        <tas-error>{{ row.key().errors()[0].message }}</tas-error>
                      }
                    </tas-form-field>
                    <button tas-icon-button type="button" class="mt-1" title="Retirer cette correspondance"
                            (click)="removeLink(i)">
                      <tas-icon iconName="feather:x" style="font-size:12px" class="text-slate-400"></tas-icon>
                    </button>
                  </div>
                }
                @if (linkForm.links().errors().length) {
                  <p class="text-xs text-functional-error">{{ linkForm.links().errors()[0].message }}</p>
                }
                <div>
                  <button tas-text-button type="button" class="text-xs"
                          [disabled]="targetOptionsFor(-1).length === 0"
                          (click)="addLink()">
                    <tas-icon iconName="feather:plus" style="font-size:12px"></tas-icon>
                    Ajouter un champ
                  </button>
                </div>
              </form>
              <div class="px-3 pb-3 flex items-center justify-between gap-2">
                <p class="text-[11px] text-slate-400">
                  La correspondance de la source n'est pas modifiée : seules cette réception et son lead sont concernés.
                </p>
                <button tas-raised-button color="primary" type="button" class="shrink-0"
                        [disabled]="linkForm().invalid() || linkForm().submitting()"
                        [isLoading]="linkForm().submitting()"
                        (click)="createLead()">
                  <tas-icon iconName="feather:user-plus" style="font-size:12px"></tas-icon>
                  Créer le lead
                </button>
              </div>
            </section>
          }

          <!-- Données reçues -->
          <section class="rounded-lg border border-slate-200">
            <div class="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {{ data.isScript ? 'Champs du formulaire' : 'Données reçues' }}
              </p>
              @if (payload()) {
                <button tas-text-button type="button" class="text-xs" (click)="showRaw.set(!showRaw())">
                  {{ showRaw() ? 'Vue structurée' : 'JSON brut' }}
                </button>
              }
            </div>
            <div class="p-3">
              @if (!canReadPayload()) {
                <p class="text-sm text-slate-500">Vous n'avez pas le droit de consulter les données reçues.</p>
              } @else if (isLoadingPayload()) {
                <div class="flex justify-center py-4"><tas-spinner size="5" class="text-primary"></tas-spinner></div>
              } @else if (payloadError()) {
                <p class="text-sm text-slate-600">{{ payloadError() }}</p>
              } @else if (payload(); as p) {
                @if (showRaw()) {
                  <pre class="bg-slate-900 text-green-400 text-[10px] p-3 rounded-lg overflow-auto max-h-96 font-mono whitespace-pre-wrap">{{ p.pretty }}</pre>
                } @else if (p.fields.length === 0) {
                  <p class="text-sm text-slate-500">Aucun champ lisible : consultez le JSON brut.</p>
                } @else {
                  <dl class="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 text-xs">
                    @for (f of p.fields; track f.key) {
                      <dt class="text-slate-500 font-mono truncate" [title]="f.key">{{ f.label }}</dt>
                      <dd class="text-slate-800 break-words">
                        @if (f.value) { {{ f.value }} } @else { <span class="text-slate-400">—</span> }
                      </dd>
                    }
                  </dl>
                }
              }
            </div>
          </section>

          <!-- Contexte de soumission (script) -->
          @if (!showRaw() && payload()?.context?.length) {
            <section class="rounded-lg border border-slate-200">
              <p class="px-3 py-2 border-b border-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Contexte de la soumission
              </p>
              <dl class="p-3 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 text-xs">
                @for (c of payload()!.context; track c.key) {
                  <dt class="text-slate-500">{{ c.label }}</dt>
                  <dd class="text-slate-800 break-all">{{ c.value }}</dd>
                }
              </dl>
            </section>
          }
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-2">
          @if (data.canReplay && replayable && !reprocessed()) {
            <button tas-outlined-button type="button" (click)="requestReplay()">
              <tas-icon iconName="feather:rotate-cw" style="font-size:12px"></tas-icon>
              Rejouer
            </button>
          }
          <button tas-raised-button color="primary" type="button" (click)="close()">Fermer</button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class IngestionDetailDrawer implements OnInit {
  public readonly data: IngestionDetailDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<IngestionDetailDrawerResult>);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _ingestionsApi = inject(IngestionsApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);

  public readonly ingestion = this.data.ingestion;
  public readonly reasonLabel = ingestionReasonLabel(this.ingestion.rejectionReason);
  public readonly replayable = isReplayableIngestion(this.ingestion);
  public readonly canReadLead = this._permissions.can('lead:read');
  /** Même droit que celui qui protège GET /ingestions/{id}/payload et /reprocess côté serveur. */
  public readonly canReadPayload = this._permissions.can('lead:source:manage');

  /** Réponse du serveur quand le lead a été créé depuis ce drawer. */
  public reprocessed = signal<ReprocessIngestionResult | null>(null);

  public readonly statusLabel = computed(() =>
    ingestionStatusLabel(this.reprocessed()?.status ?? this.ingestion.status));
  public readonly statusSeverity = computed(() =>
    ingestionStatusSeverity(this.reprocessed()?.status ?? this.ingestion.status));
  public readonly leadId = computed(() => {
    const id = this.reprocessed()?.leadId ?? this.ingestion.leadId;
    return id && id !== EMPTY_GUID ? id : null;
  });

  public lead = signal<LeadDto | null>(null);
  public isLoadingLead = signal(false);
  public leadError = signal<string | null>(null);
  public readonly leadName = computed(() => {
    const l = this.lead();
    if (!l) return '';
    return l.fullName || [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Lead sans nom';
  });
  public readonly leadStatus = computed(() => leadStatusMeta(this.lead()?.status));

  /**
   * Chargé à l'ouverture, réception par réception, et non avec la liste :
   * `GetIngestionPayload` est une commande auditée, chaque lecture des données
   * brutes d'un prospect doit laisser sa trace.
   */
  public payload = signal<ParsedPayload | null>(null);
  public isLoadingPayload = signal(false);
  public payloadError = signal<string | null>(null);
  public showRaw = signal(false);

  /** Champs à compléter, tant que la réception n'a pas été traitée et que ses données sont lisibles. */
  public readonly completion = computed(() => {
    if (this.reprocessed() || !this.canReadPayload() || !this.payload()?.fields.length) return null;
    return missingLeadFields(this.ingestion);
  });

  public readonly keyOptions = computed<KeyOption[]>(() =>
    (this.payload()?.fields ?? []).map((f) => ({
      value: f.key,
      label: f.value ? `${f.key} — « ${f.value.length > 32 ? f.value.slice(0, 32) + '…' : f.value} »` : f.key,
    })),
  );

  public linkModel = signal(FieldLinksFormModel.instantiate());
  public linkForm = form(this.linkModel, (schema) => {
    applyEach(schema.links, (row) => {
      required(row.target, { message: 'Choisissez le champ du lead' });
      required(row.key, { message: 'Choisissez le champ reçu' });
    });
    // Les règles du serveur, vérifiées avant l'envoi : le téléphone s'il manquait, et au moins
    // un des trois champs de nom (règle de `LeadNameResolver`).
    validate(schema.links, (ctx) => {
      const rows = ctx.value();
      const missing = this.completion();
      const has = (target: string) => rows.some((r) => r.target === target && !!r.key);
      if (missing?.phone && !has('phoneNumber')) {
        return { kind: 'required', message: 'Le téléphone est obligatoire : associez-lui un champ reçu.' };
      }
      if (missing?.name && !NAME_TARGETS.some(has)) {
        return { kind: 'required', message: 'Le nom est obligatoire : associez le nom complet, le prénom ou le nom.' };
      }
      return null;
    });
  });

  /** Les champs cibles encore libres pour la ligne `index` (−1 : pour une nouvelle ligne). */
  public targetOptionsFor(index: number): KeyOption[] {
    const used = new Set(
      this.linkModel().links.filter((_, i) => i !== index).map((r) => r.target).filter(Boolean),
    );
    return LEAD_LINK_TARGETS.filter((t) => !used.has(t.value));
  }

  public addLink(): void {
    this.linkForm.links().value.update((rows) => [...rows, FieldLinkRow.of('', '')]);
  }

  public removeLink(index: number): void {
    this.linkForm.links().value.update((rows) => rows.filter((_, i) => i !== index));
  }

  ngOnInit(): void {
    const id = this.leadId();
    if (id && this.canReadLead()) this._loadLead(id);
    if (this.canReadPayload() && this.ingestion.id) this._loadPayload();
  }

  public createLead(): void {
    if (!this.completion()) return;

    submit(this.linkForm, async (field) => {
      const v = field()?.value();
      if (!v) return;

      const links: Record<string, string> = {};
      for (const row of v.links) {
        const target = (row.target ?? '').trim();
        const key = (row.key ?? '').trim();
        if (target && key) links[target] = key;
      }

      const result = await firstValueFrom(
        this._ingestionsApi.reprocessIngestion(this.ingestion.id!, { fieldLinks: links }).pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Création impossible', this._reprocessError(err));
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );
      if (!result) return;

      this.reprocessed.set(result);
      this._snackbar.success(
        result.status === 'Duplicate' ? 'Doublon détecté' : 'Lead créé',
        result.status === 'Duplicate'
          ? 'La réception a été rattachée au lead existant.'
          : 'Le lead a été créé à partir de cette réception.',
      );
      if (result.leadId && this.canReadLead()) this._loadLead(result.leadId);
    });
  }

  public openLead(): void {
    this._dialogRef.close(this._result());
    this._router.navigate(['/leads', this.leadId()]);
  }

  public requestReplay(): void {
    this._dialogRef.close('replay');
  }

  public close(): void {
    this._dialogRef.close(this._result());
  }

  private _result(): IngestionDetailDrawerResult {
    return this.reprocessed() ? 'reprocessed' : undefined;
  }

  /** Les codes du serveur, traduits ; un code inconnu reste affiché tel quel plutôt que masqué. */
  private _reprocessError(err: HttpErrorResponse): string {
    if (err.status === 403) return 'Vous n\'avez pas le droit de créer un lead depuis une réception.';
    if (err.status === 404) return 'Cette réception n\'existe plus.';
    const detail: string = err.error?.detail ?? '';
    if (detail.startsWith('REQUIRED_FIELDS_MISSING:')) {
      return `${ingestionReasonLabel(detail)} Vérifiez les champs choisis : ils sont peut-être vides.`;
    }
    if (detail.startsWith('PAYLOAD_FIELD_NOT_FOUND:')) {
      return `Le champ « ${detail.slice('PAYLOAD_FIELD_NOT_FOUND:'.length)} » n'existe pas dans les données reçues.`;
    }
    switch (detail) {
      case 'ONLY_REJECTED_OR_FAILED_CAN_BE_REPROCESSED':
        return 'Cette réception a déjà été traitée. Rafraîchissez la liste.';
      case 'SOURCE_ARCHIVED':
        return 'La source est archivée : aucun lead ne peut plus y être créé.';
      case 'INVALID_PAYLOAD':
        return 'Les données reçues ne sont pas un objet JSON lisible.';
    }
    const validation = err.error?.errors;
    if (validation && typeof validation === 'object') {
      const first = Object.values(validation as Record<string, string[]>)[0];
      if (first?.length) return first[0];
    }
    return detail || err.error?.title || 'La création du lead a échoué.';
  }

  private _loadLead(id: string): void {
    this.isLoadingLead.set(true);
    this.leadError.set(null);
    this._leadsApi.getLead(id).pipe(
      catchError((err: HttpErrorResponse) => {
        // Un lead fusionné avec un doublon, ou supprimé, répond 404 : ce n'est pas une panne.
        this.leadError.set(
          err.status === 404
            ? 'Ce lead n\'existe plus : il a pu être fusionné ou supprimé.'
            : 'Le lead n\'a pas pu être chargé.',
        );
        return EMPTY;
      }),
      finalize(() => this.isLoadingLead.set(false)),
    ).subscribe((lead) => this.lead.set(lead));
  }

  private _loadPayload(): void {
    this.isLoadingPayload.set(true);
    this._ingestionsApi.getIngestionPayload(this.ingestion.id!).pipe(
      catchError((err: HttpErrorResponse) => {
        this.payloadError.set(
          err.status === 403
            ? 'Vous n\'avez pas le droit de consulter les données reçues.'
            : err.error?.detail ?? 'Les données reçues n\'ont pas pu être chargées.',
        );
        return EMPTY;
      }),
      finalize(() => this.isLoadingPayload.set(false)),
    ).subscribe((p) => {
      const parsed = parseIngestionPayload(p.rawPayloadJson);
      this.payload.set(parsed);
      this.linkModel.set(
        FieldLinksFormModel.suggested(parsed.fields.map((f) => f.key), missingLeadFields(this.ingestion)),
      );
    });
  }
}
