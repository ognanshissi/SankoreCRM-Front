import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { EMPTY, catchError, finalize } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { SideDrawerService, TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { IngestionDto, IngestionsApiService, LeadDto, LeadsApiService } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import {
  ParsedPayload,
  ingestionHasLead,
  ingestionStatusLabel,
  ingestionStatusSeverity,
  isReplayableIngestion,
  parseIngestionPayload,
} from './ingestion.types';

export interface IngestionDetailDrawerData {
  ingestion: IngestionDto;
  canReplay: boolean;
  /** Source « script embarqué » : l'ID externe y est un GUID tiré au sort, sans intérêt. */
  isScript: boolean;
}

/** `'replay'` : l'utilisateur demande le rejeu, que l'écran appelant exécute. */
export type IngestionDetailDrawerResult = 'replay' | undefined;

function leadStatusMeta(status: string | null | undefined): { label: string; severity: Severity } {
  switch (status) {
    case 'New':       return { label: 'Nouveau',  severity: 'info' };
    case 'Contacted': return { label: 'Contacté', severity: 'warning' };
    case 'Qualified': return { label: 'Qualifié', severity: 'warning' };
    case 'Converted': return { label: 'Converti', severity: 'success' };
    case 'Lost':      return { label: 'Perdu',    severity: 'error' };
    case 'Expired':   return { label: 'Expiré',   severity: 'neutral' };
    default:          return { label: status ?? '—', severity: 'neutral' };
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
    DatePipe, Button, TasIcon, TasSpinner, TasTag,
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
              <tas-tag [severity]="statusSeverity">{{ statusLabel }}</tas-tag>
            </div>
            @if (!data.isScript && ingestion.externalId) {
              <p class="mt-1 text-xs text-slate-500">
                ID externe <span class="font-mono text-slate-700">{{ ingestion.externalId }}</span>
              </p>
            }
            @if (ingestion.rejectionReason) {
              <div class="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                <p class="text-xs font-medium text-red-700">Motif</p>
                <p class="text-xs text-red-600 mt-0.5 break-words">{{ ingestion.rejectionReason }}</p>
              </div>
            }
          </div>

          <!-- Lead créé -->
          <section class="rounded-lg border border-slate-200">
            <p class="px-3 py-2 border-b border-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Lead
            </p>
            <div class="p-3">
              @if (!hasLead) {
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
          @if (data.canReplay && replayable) {
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
  private readonly _router = inject(Router);

  public readonly ingestion = this.data.ingestion;
  public readonly statusLabel = ingestionStatusLabel(this.ingestion.status);
  public readonly statusSeverity = ingestionStatusSeverity(this.ingestion.status);
  public readonly hasLead = ingestionHasLead(this.ingestion);
  public readonly replayable = isReplayableIngestion(this.ingestion);
  public readonly canReadLead = this._permissions.can('lead:read');
  /** Même droit que celui qui protège GET /ingestions/{id}/payload côté serveur. */
  public readonly canReadPayload = this._permissions.can('lead:source:manage');

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

  ngOnInit(): void {
    if (this.hasLead && this.canReadLead()) this._loadLead();
    if (this.canReadPayload() && this.ingestion.id) this._loadPayload();
  }

  public openLead(): void {
    this._dialogRef.close();
    this._router.navigate(['/leads', this.ingestion.leadId]);
  }

  public requestReplay(): void {
    this._dialogRef.close('replay');
  }

  public close(): void {
    this._dialogRef.close();
  }

  private _loadLead(): void {
    this.isLoadingLead.set(true);
    this._leadsApi.getLead(this.ingestion.leadId!).pipe(
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
    ).subscribe((p) => this.payload.set(parseIngestionPayload(p.rawPayloadJson)));
  }
}
