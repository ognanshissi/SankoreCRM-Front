import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, debounceTime, EMPTY, firstValueFrom, of, Subject, switchMap } from 'rxjs';
import {
  LeadsApiService,
  WhatsAppApiService,
  WhatsAppConversationDetailDto,
  WhatsAppMessageDto,
} from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTitle } from '@talisoft/ui/title';
import { ClientWhatsAppDrawer, ClientWhatsAppDrawerData, PermissionsService } from '@sankore/crm/common';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { CONVERSATION_STATUS, whatsAppActionError } from '../edit-lead/whatsapp/whatsapp-labels';

export interface WhatsAppConversationDrawerData {
  conversationId: string;
}

class AttachFormModel {
  public leadId!: string;

  public static instantiate(): AttachFormModel {
    return Object.assign(new AttachFormModel(), { leadId: '' });
  }
}

const PAGE = 30;

/**
 * Une conversation qui n'est sur aucune fiche lead — un client, un numéro inconnu (WA-BE-19) —
 * ouverte depuis l'inbox. Le fil se lit ici, en lecture seule (les actions vivent sur la fiche,
 * où s'applique la règle de propriété du lead) ; « Rattacher à un lead » la classe sur une fiche,
 * qui s'ouvre ensuite.
 *
 * Le fil est en bulles, hors tas-table, comme celui de la fiche : un fil se lit de bas en haut et
 * se charge vers le passé par curseur (exception validée par le propriétaire).
 */
@Component({
  selector: 'whatsapp-conversation-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './whatsapp-conversation-drawer.html',
  imports: [
    DatePipe,
    FormsModule,
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasFormField,
    TasLabel,
    TasHint,
    TasError,
    TasInput,
    TasSelect,
    TasIcon,
    TasSpinner,
    Button,
  ],
})
export class WhatsAppConversationDrawer implements OnInit {
  private readonly _api = inject(WhatsAppApiService);
  private readonly _leads = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);
  private readonly _permissions = inject(PermissionsService);
  private readonly _ref = inject(DialogRef<boolean>);
  private readonly _destroyRef = inject(DestroyRef);
  public readonly data = inject<WhatsAppConversationDrawerData>(DIALOG_DATA);

  /** Une réclamation recueillie par le bot est sur la fiche du client, pas dans ce fil (2026-10-26). */
  public readonly canReadComplaints = this._permissions.can('customers:complaints:read');
  /** Une conversation de client se répond depuis le panneau « client » (réclamations, lot 3). */
  public readonly canWriteClient = this._permissions.can('WhatsApp.Send');
  private readonly _sideDrawer = inject(SideDrawerService);

  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  public readonly detail = signal<WhatsAppConversationDetailDto | null>(null);
  /** Du plus ancien au plus récent, pour l'affichage. */
  public readonly messages = signal<WhatsAppMessageDto[]>([]);
  public readonly nextBefore = signal<string | null>(null);
  public readonly isLoadingOlder = signal(false);
  public readonly images = signal<Record<string, string>>({});

  public readonly attaching = signal(false);
  public readonly leadSearch = signal('');
  public readonly leadOptions = signal<{ label: string; value: string }[]>([]);
  private readonly _search$ = new Subject<string>();

  public model = signal(AttachFormModel.instantiate());
  public formSchema = form(this.model, (schema) => {
    required(schema.leadId, { message: 'Choisissez la fiche lead' });
  });

  public readonly statusOf = (status: string | null | undefined) =>
    CONVERSATION_STATUS[status ?? ''] ?? { label: status ?? '', tone: 'bg-slate-100 text-slate-700', icon: 'feather:message-circle' };

  public ngOnInit(): void {
    this._destroyRef.onDestroy(() => Object.values(this.images()).forEach((url) => URL.revokeObjectURL(url)));

    // Recherche de lead : signaux + debounce, comme les barres de recherche du projet.
    this._search$
      .pipe(
        debounceTime(300),
        switchMap((text) =>
          text.trim().length < 2
            ? of(null)
            : this._leads.listLeads(1, 10, undefined, undefined, undefined, undefined, undefined, text.trim()).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((page) =>
        this.leadOptions.set(
          (page?.items ?? [])
            .filter((l) => l.id)
            .map((l) => ({ label: `${l.fullName ?? '—'}${l.phoneNumber ? ' · ' + l.phoneNumber : ''}`, value: l.id! })),
        ),
      );

    this._api.getWhatsAppConversation(this.data.conversationId).pipe(
      catchError(() => {
        this.loadError.set('Cette conversation n’est pas disponible, ou elle est hors de votre périmètre.');
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((detail) => {
      this.detail.set(detail);
      this._loadMessages(false);
    });
  }

  public onLeadSearch(value: string): void {
    this.leadSearch.set(value ?? '');
    this._search$.next(value ?? '');
  }

  public loadOlder(): void {
    this._loadMessages(true);
  }

  public isImage(m: WhatsAppMessageDto): boolean {
    return !!m.hasMedia && (m.kind === 'Image' || m.kind === 'Sticker');
  }

  public download(m: WhatsAppMessageDto): void {
    this._api.getWhatsAppConversationMedia(this.data.conversationId, m.id!).pipe(
      catchError(() => {
        this._snackbar.error('Pièce jointe', 'Elle n’a pas pu être récupérée.');
        return EMPTY;
      }),
    ).subscribe((blob) => {
      const url = URL.createObjectURL(blob as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = m.mediaFileName || 'piece-jointe';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });
  }

  /**
   * Répondre à un client : avant, une conversation de client était en lecture seule ici. Le
   * panneau « client » porte les règles (fenêtre, prise en main, STOP, périmètre du client).
   */
  public answerClient(): void {
    const detail = this.detail();
    if (!detail?.clientId) return;
    this._sideDrawer
      .open<boolean, ClientWhatsAppDrawerData, ClientWhatsAppDrawer>(ClientWhatsAppDrawer, {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: { clientId: detail.clientId, clientName: detail.name ?? 'Client' },
      })
      .closed.subscribe((sent) => {
        if (sent) this._ref.close(true);
      });
  }

  public openComplaints(): void {
    const clientId = this.detail()?.clientId;
    if (!clientId) return;
    this._ref.close(false);
    this._router.navigate(['/customers', clientId, 'reclamations']);
  }

  public openLead(): void {
    const route = this.detail()?.route;
    if (!route) return;
    this._ref.close(false);
    this._router.navigateByUrl(route);
  }

  public startAttach(): void {
    this.attaching.set(true);
  }

  public attach(): void {
    submit(this.formSchema, async (field) => {
      const leadId = field().value().leadId;

      // Le serveur répond 204 sans corps : le succès ne se lit pas sur la valeur, d'où le drapeau.
      let failed = false;

      await firstValueFrom(
        this._api.attachWhatsAppConversation(this.data.conversationId, { leadId }).pipe(
          catchError((err: HttpErrorResponse) => {
            failed = true;
            this._snackbar.error('Rattachement impossible', whatsAppActionError(err));
            return of(null);
          }),
        ),
        { defaultValue: null },
      );

      if (failed) return;

      this._snackbar.success('Conversation rattachée', 'Elle s’ouvre désormais sur la fiche du lead.');
      this._ref.close(true);
      this._router.navigate(['/leads', leadId, 'suivi', 'whatsapp']);
    });
  }

  public close(): void {
    this._ref.close(false);
  }

  private _loadMessages(older: boolean): void {
    if (older) this.isLoadingOlder.set(true);

    this._api.listWhatsAppConversationMessages(
      this.data.conversationId,
      older ? this.nextBefore() ?? undefined : undefined,
      PAGE,
    ).pipe(
      catchError(() => {
        this.isLoading.set(false);
        this.isLoadingOlder.set(false);
        return EMPTY;
      }),
    ).subscribe((page) => {
      const items = [...(page.items ?? [])].reverse();
      this.messages.update((current) => (older ? [...items, ...current] : items));
      this.nextBefore.set(page.nextBefore ?? null);
      this.isLoading.set(false);
      this.isLoadingOlder.set(false);
      items.filter((m) => this.isImage(m)).forEach((m) => this._loadImage(m));
    });
  }

  private _loadImage(m: WhatsAppMessageDto): void {
    this._api.getWhatsAppConversationMedia(this.data.conversationId, m.id!).pipe(catchError(() => EMPTY)).subscribe((blob) => {
      this.images.update((all) => ({ ...all, [m.id!]: URL.createObjectURL(blob as Blob) }));
    });
  }
}
