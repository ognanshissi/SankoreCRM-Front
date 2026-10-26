import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EMPTY, catchError, finalize } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { BASE_PATH, ClientDocumentDto, ClientDocumentsApiService } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { ClientDetailStore } from '../../models/client-detail.store';
import {
  DOCUMENT_DIRECTION_OPTIONS,
  DOCUMENT_SOURCE_OPTIONS,
  documentDetailLabel,
  documentDirectionLabel,
  documentKindLabel,
  documentSourceLabel,
  documentStatus,
} from './client-documents.labels';
import { RemoveClientDocumentDrawer, RemoveClientDocumentDrawerData } from './remove-client-document-drawer';
import { UploadClientDocumentDrawer, UploadClientDocumentDrawerData } from './upload-client-document-drawer';

/**
 * Une ligne du tableau. Alias d'objet et non interface : `tas-table` contraint ses données à
 * `TableEntity`, dont la signature d'index n'est reçue implicitement que par un alias.
 */
export type DocumentRow = {
  id: string;
  document: ClientDocumentDto;
  kindLabel: string;
  detail: string;
  fileName: string | null;
  isDelivered: boolean;
  directionLabel: string;
  sourceLabel: string;
  originLabel: string;
  originLink: unknown[] | null;
  dateLabel: string;
  statusLabel: string | null;
  statusSeverity: Severity;
  canOpen: boolean;
  canRemove: boolean;
};

const PAGE_SIZE = 25;

/**
 * Onglet « Documents » de la fiche client (décision du propriétaire, 2026-10-26) : tout ce que le
 * client a donné et reçu, quelle que soit la source — pièces KYC, documents d'assurance, pièces
 * jointes de projets et de tâches, médias WhatsApp, documents déposés sur la fiche, e-mails et SMS.
 *
 * Une ligne dont l'utilisateur n'a pas le droit d'ouvrir la source reste affichée, sans son nom de
 * fichier ni son bouton « Ouvrir » : le serveur les retient. L'ouverture passe par la route de la
 * source, qui garde son droit, son périmètre et son journal d'accès.
 */
@Component({
  selector: 'client-documents',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './documents.html',
  imports: [FormsModule, RouterLink, TasCard, TasTable, TasTag, TasIcon, TasSelect, TasFormField, TasLabel, Button],
})
export class ClientDocumentsPage {
  private readonly _api = inject(ClientDocumentsApiService);
  private readonly _http = inject(HttpClient);
  private readonly _basePath = inject(BASE_PATH);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _permissions = inject(PermissionsService);
  protected readonly store = inject(ClientDetailStore);

  private readonly _canUpdate = this._permissions.can('customers:update');
  public readonly canUpload = computed(() => this._canUpdate() && !this.store.isReadOnly());

  public readonly directionOptions = DOCUMENT_DIRECTION_OPTIONS;
  public readonly sourceOptions = DOCUMENT_SOURCE_OPTIONS;

  public readonly direction = signal('');
  public readonly source = signal('');

  public readonly documents = signal<ClientDocumentDto[]>([]);
  public readonly unavailableSources = signal<string[]>([]);
  public readonly isLoading = signal(true);
  public readonly loadFailed = signal(false);
  public readonly openingKey = signal<string | null>(null);

  public readonly clientId = computed(() => this.store.clientId() ?? '');

  public readonly rows = computed<DocumentRow[]>(() => {
    const direction = this.direction();
    const source = this.source();
    return this.documents()
      .filter((d) => (!direction || d.direction === direction) && (!source || d.source === source))
      .map((d) => this._toRow(d));
  });

  public readonly hasFilters = computed(() => !!this.direction() || !!this.source());

  public readonly tableConfig = computed<TableConfig>(() => ({
    property: 'entity',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: PAGE_SIZE,
      pageSizeOptions: [PAGE_SIZE, 50, 100],
      totalElements: this.rows().length,
    },
  }));

  constructor() {
    effect(() => {
      const clientId = this.clientId();
      if (clientId) untracked(() => this.reload());
    });
  }

  public reload(): void {
    const clientId = this.clientId();
    if (!clientId) return;
    this.isLoading.set(true);
    this.loadFailed.set(false);
    this._api
      .listClientDocuments(clientId)
      .pipe(
        catchError(() => {
          this.loadFailed.set(true);
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((result) => {
        this.documents.set(result.items ?? []);
        this.unavailableSources.set(result.unavailableSources ?? []);
      });
  }

  public resetFilters(): void {
    this.direction.set('');
    this.source.set('');
  }

  public upload(): void {
    this._sideDrawer
      .open<boolean, UploadClientDocumentDrawerData, UploadClientDocumentDrawer>(UploadClientDocumentDrawer, {
        data: { clientId: this.clientId() },
      })
      .closed.subscribe((done) => {
        if (done) this.reload();
      });
  }

  public remove(row: DocumentRow): void {
    const documentId = row.document.key?.split(':')[1];
    if (!documentId) return;
    this._sideDrawer
      .open<boolean, RemoveClientDocumentDrawerData, RemoveClientDocumentDrawer>(RemoveClientDocumentDrawer, {
        data: { clientId: this.clientId(), documentId, title: row.detail || row.kindLabel },
      })
      .closed.subscribe((done) => {
        if (done) this.reload();
      });
  }

  /**
   * Par la route de la source, que le serveur a donnée : le client généré ne connaît pas une route
   * choisie à l'exécution, et c'est bien un `Blob` qui revient.
   */
  public open(row: DocumentRow): void {
    const path = row.document.contentPath;
    if (!path) return;
    this.openingKey.set(row.id);
    this._http
      .get(`${this._basePath}/api/v1/${path}`, { responseType: 'blob' })
      .pipe(
        catchError(() => {
          this._snackbar.error('Ouverture impossible', "Le document n'a pas pu être lu.");
          return EMPTY;
        }),
        finalize(() => this.openingKey.set(null)),
      )
      .subscribe((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        // Une capture KYC n'a pas de nom de fichier : sans extension, le fichier téléchargé ne
        // s'ouvrait pas d'un double-clic — constaté en recette.
        link.download = row.fileName ?? `${row.kindLabel}${extensionOf(row.document.contentType)}`;
        link.click();
        URL.revokeObjectURL(url);
      });
  }

  public unavailableLabel(): string {
    const names: Record<string, string> = {
      Kyc: 'du KYC',
      Insurance: "de l'assurance",
      Leads: 'des projets, tâches et WhatsApp',
      Messages: 'des messages envoyés',
    };
    return this.unavailableSources().map((s) => names[s] ?? s).join(', ');
  }

  private _toRow(d: ClientDocumentDto): DocumentRow {
    const status = documentStatus(d.status);
    const detail = documentDetailLabel(d.source, d.detail);
    return {
      id: d.key ?? '',
      document: d,
      kindLabel: documentKindLabel(d.kind),
      detail,
      fileName: d.fileName ?? null,
      isDelivered: d.direction === 'Delivered',
      directionLabel: documentDirectionLabel(d.direction),
      sourceLabel: documentSourceLabel(d.source),
      originLabel: d.originLabel?.trim() || documentSourceLabel(d.source),
      originLink: this._originLink(d),
      dateLabel: this._formatDate(d.at),
      statusLabel: status?.label ?? null,
      statusSeverity: status?.severity ?? 'neutral',
      canOpen: d.canOpen === true,
      canRemove: d.canRemove === true,
    };
  }

  /** Où le document est né, pour y revenir. Rien pour ce qui vit sur la fiche elle-même. */
  private _originLink(d: ClientDocumentDto): unknown[] | null {
    const id = d.originId;
    const clientId = this.clientId();
    if (!id) return null;
    switch (d.originType) {
      case 'KycFile':
        return ['/kyc', id];
      case 'Holding':
        return ['/customers', clientId, 'contrats', `holding:${id}`];
      case 'Policy':
        return ['/customers', clientId, 'contrats', `policy:${id}`];
      case 'Claim':
        return ['/customers', clientId, 'sinistres'];
      case 'Project':
        return ['/leads/projets', id];
      case 'Task':
        return ['/tasks', id];
      case 'Lead':
        return ['/leads', id, 'whatsapp'];
      case 'Conversation':
        return ['/leads/whatsapp'];
      default:
        return null;
    }
  }

  private _formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
}

const EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/heic': '.heic',
  'image/webp': '.webp',
  'text/plain': '.txt',
  'text/csv': '.csv',
};

function extensionOf(contentType: string | null | undefined): string {
  return (contentType && EXTENSIONS[contentType.split(';')[0].trim()]) || '';
}

export default ClientDocumentsPage;
