import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { applyEach, form, FormField, FormRoot, maxLength, required, submit, validate } from '@angular/forms/signals';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { catchError, EMPTY, firstValueFrom, Observable } from 'rxjs';
import { ProjectWhatsAppDto, ProjectWhatsAppFileDto, WhatsAppApiService, WhatsAppComposeTemplateDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTitle } from '@talisoft/ui/title';
import { whatsAppFailureLabel } from '../edit-lead/whatsapp/whatsapp-labels';

export interface ProjectWhatsAppDrawerData {
  projectId: string;
  /** Nul quand la fiche de la personne n'est pas lisible par l'agent (client hors périmètre). */
  personName: string | null;
  /** Les pièces cochées d'emblée : celle d'où l'agent a demandé l'envoi. */
  selected?: string[];
}

/** Ce que le tiroir rend à la page : vrai quand au moins un message est parti ou en file. */
export type ProjectWhatsAppDrawerResult = boolean;

/** Les raisons qu'un envoi ne peut pas partir, et les refus du serveur, en français. */
const LABELS: Record<string, string> = {
  PROJECT_WHATSAPP_NO_RECIPIENT: 'Ce projet n’a ni lead ni client à qui écrire.',
  PROJECT_WHATSAPP_FILES_INVALID: 'Choisissez de 1 à 5 pièces.',
  PROJECT_ATTACHMENT_NOT_FOUND: 'Une pièce n’existe plus dans le projet.',
  PROJECT_ATTACHMENTS_UNAVAILABLE: 'Les pièces du projet ne peuvent pas être lues pour le moment.',
  OPPORTUNITY_NOT_FOUND: 'Ce projet n’existe plus ou ne vous est pas accessible.',
  LEAD_NOT_YOURS: 'Ce lead n’est pas dans votre portefeuille.',
  LEAD_NOT_FOUND: 'Lead introuvable.',
  CLIENT_NOT_FOUND: 'Ce client n’est pas dans votre périmètre.',
  CLIENT_PROCESSING_RESTRICTED: 'La personne a demandé l’effacement de ses données : nous ne la contactons plus à notre initiative.',
  WHATSAPP_CONVERSATION_NOT_FOUND: 'La personne ne vous a encore jamais écrit : envoyez le document dans un modèle.',
  WHATSAPP_NOT_HOLDER: 'Prenez la conversation en main pour y envoyer un document.',
  WHATSAPP_CONVERSATION_HELD_BY_ANOTHER: 'Un autre agent a la main sur la conversation : un superviseur doit d’abord la réassigner.',
  WHATSAPP_WINDOW_CLOSED: 'La personne n’a pas écrit depuis plus de 24 h : envoyez le document dans un modèle.',
  WHATSAPP_CONSENT_MISSING: 'Le consentement WhatsApp du lead n’est pas renseigné.',
  WHATSAPP_CONSENT_REVOKED: 'Le lead a retiré son consentement WhatsApp.',
  WHATSAPP_CLIENT_OPTED_OUT: 'Le client a répondu STOP : il ne veut plus de messages WhatsApp.',
  WHATSAPP_NUMBER_IN_ANOTHER_RECORD: 'Ce numéro a déjà sa conversation sur un autre dossier.',
  WHATSAPP_PHONE_INVALID: 'Le numéro ne peut pas s’écrire au format international (indicatif manquant ?).',
  WHATSAPP_CHANNEL_INACTIVE: 'Aucun numéro WhatsApp actif pour cette agence.',
  WHATSAPP_TEMPLATE_COOLDOWN: 'Un modèle a déjà été envoyé il y a moins de 24 h, sans réponse.',
  WHATSAPP_LEAD_CLOSED: 'Ce lead est clôturé.',
  WHATSAPP_MEDIA_TYPE_NOT_ALLOWED: 'WhatsApp n’accepte que les PDF et les images JPEG ou PNG : envoyez ce fichier par e-mail.',
  WHATSAPP_MEDIA_INVALID: 'Ce fichier est trop lourd ou n’est pas ce que son type annonce.',
  WHATSAPP_TEMPLATE_NEEDS_FILE: 'Ce modèle attend un fichier.',
  WHATSAPP_TEMPLATE_HAS_NO_FILE_HEADER: 'Ce modèle ne porte pas de fichier.',
  WHATSAPP_MEDIA_STORE_UNAVAILABLE: 'Le stockage des fichiers WhatsApp n’est pas configuré : rien n’est parti.',
  WHATSAPP_TEMPLATE_NOT_FOUND: 'Ce modèle n’existe plus pour ce numéro.',
  WHATSAPP_TEMPLATE_NOT_APPROVED: 'Ce modèle n’est pas approuvé par Meta.',
  WHATSAPP_TEMPLATE_NOT_FOR_PRODUCT: 'Ce modèle n’est pas prévu pour le produit de ce lead.',
  WHATSAPP_VARIABLES_INVALID: 'Chaque variable doit être renseignée, sur une seule ligne.',
};

function label(code: string | null | undefined): string {
  return (code && LABELS[code]) || code || 'L’envoi n’a pas pu être demandé.';
}

function errorOf(error: HttpErrorResponse): string {
  const code = error.error?.detail ?? error.error?.error;
  if (error.status === 403) return 'Vous n’avez pas le droit d’envoyer de message WhatsApp.';
  return label(code);
}

class CaptionFormModel {
  public caption!: string;

  public static instantiate(): CaptionFormModel {
    return Object.assign(new CaptionFormModel(), { caption: '' });
  }
}

class VariableRow {
  public index!: number;
  public value!: string;
}

class TemplateFormModel {
  public templateId!: string;
  public variables!: VariableRow[];

  public static instantiate(): TemplateFormModel {
    return Object.assign(new TemplateFormModel(), { templateId: '', variables: [] });
  }
}

/**
 * « Envoyer par WhatsApp » depuis un projet (envoi des documents, lot 5) : au lead du projet,
 * sinon à son client, sous les règles de son onglet WhatsApp. Deux façons, selon où en est la
 * conversation — dans la fenêtre de 24 h, les pièces partent telles quelles, une par message ;
 * hors fenêtre, une seule pièce part dans un modèle approuvé dont l'en-tête porte un fichier.
 */
@Component({
  selector: 'project-whatsapp-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormRoot, FormField, TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle, TasIcon, TasInput,
    TasFormField, TasLabel, TasHint, TasError, TasSpinner, Button,
  ],
  template: `
    <tas-side-drawer width="640px">
      <tas-drawer-title>
        <tas-title>{{ data.personName ? 'Envoyer à ' + data.personName + ' par WhatsApp' : 'Envoyer par WhatsApp' }}</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (isLoading()) {
          <div class="flex justify-center py-16"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
        } @else if (loadError()) {
          <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{{ loadError() }}</p>
        } @else if (state(); as s) {
          <div class="flex flex-col gap-5">
            <p class="text-sm text-slate-600">
              {{ s.recipient === 'Client' ? 'Au client du projet' : 'Au lead du projet' }}
              @if (s.windowOpen && s.windowExpiresAt) {
                · conversation ouverte jusqu’à {{ time(s.windowExpiresAt) }}
              } @else if (s.conversationId) {
                · hors de la fenêtre de 24 h
              }
            </p>

            <div role="tablist" class="flex gap-1 rounded-xl bg-slate-100 p-1">
              <button type="button" role="tab" class="flex-1 rounded-lg px-3 py-1.5 text-sm font-medium"
                      [class]="mode() === 'free' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'"
                      [attr.aria-selected]="mode() === 'free'" (click)="mode.set('free')">Dans la conversation</button>
              <button type="button" role="tab" class="flex-1 rounded-lg px-3 py-1.5 text-sm font-medium"
                      [class]="mode() === 'template' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'"
                      [attr.aria-selected]="mode() === 'template'" (click)="mode.set('template')">Avec un modèle</button>
            </div>

            @if (mode() === 'free') {
              @if (freeBlocker(); as code) {
                <div class="flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p class="min-w-56 flex-1">{{ label(code) }}</p>
                  @if (canTakeOver()) {
                    <button tas-outlined-button color="primary" type="button" [disabled]="busy()" [isLoading]="busy()" (click)="takeOver()">
                      Prendre la conversation en main
                    </button>
                  }
                </div>
              } @else {
                <fieldset class="flex flex-col gap-2">
                  <legend class="mb-2 text-sm font-semibold text-slate-800">Pièces à envoyer</legend>
                  @for (f of files(); track f.attachmentId) {
                    <label class="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                           [class]="f.sendable ? 'text-slate-700' : 'bg-slate-50 text-slate-400'">
                      <input type="checkbox" class="h-4 w-4 accent-primary" [disabled]="!f.sendable"
                             [checked]="picked().has(f.attachmentId!)" (change)="toggle(f.attachmentId!, $any($event.target).checked)" />
                      <tas-icon iconName="feather:file" iconClass="!size-3"></tas-icon>
                      <span class="min-w-0 flex-1 truncate">{{ f.fileName }}</span>
                      @if (!f.sendable) { <span class="shrink-0 text-xs">{{ f.reason === 'WHATSAPP_MEDIA_INVALID' ? 'trop lourd' : 'par e-mail seulement' }}</span> }
                      @else { <span class="shrink-0 text-xs text-slate-400 tabular-nums">{{ size(f.sizeBytes) }}</span> }
                    </label>
                  } @empty {
                    <p class="text-sm text-slate-500">Ce projet n’a pas encore de pièce. Déposez le devis dans son dossier.</p>
                  }
                  @if (picked().size > 5) { <p class="text-xs text-functional-error" role="alert">5 pièces au plus à la fois.</p> }
                </fieldset>

                <form [formRoot]="captionForm">
                  <tas-form-field>
                    <tas-label>Message d’accompagnement</tas-label>
                    <textarea tasInput rows="3" placeholder="Ex. Voici le devis de votre projet." [formField]="captionForm.caption"></textarea>
                    <tas-hint>Il accompagne la première pièce.</tas-hint>
                    @if (captionForm.caption().touched() && captionForm.caption().invalid()) {
                      <tas-error>{{ captionForm.caption().errors()[0].message }}</tas-error>
                    }
                  </tas-form-field>
                </form>
              }
            } @else {
              @if (templateBlocker(); as code) {
                <p class="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{{ label(code) }}</p>
              } @else if (templates().length === 0) {
                <div class="rounded-2xl border border-dashed border-slate-300 px-5 py-8 text-center">
                  <p class="text-sm font-medium text-slate-700">Aucun modèle avec un document</p>
                  <p class="mt-1 text-sm text-slate-500">
                    Un modèle dont l’en-tête porte un document doit être créé et approuvé par Meta, puis synchronisé
                    dans Paramétrage › WhatsApp.
                  </p>
                </div>
              } @else {
                <form [formRoot]="templateForm" class="flex flex-col gap-5">
                  <fieldset class="flex flex-col gap-2">
                    <legend class="mb-2 text-sm font-semibold text-slate-800">Modèle</legend>
                    @for (t of templates(); track t.id) {
                      <button type="button" role="radio"
                              class="flex items-start gap-3 rounded-xl border bg-white px-4 py-3 text-left"
                              [class]="templateModel().templateId === t.id ? 'border-2 border-primary' : 'border-slate-200 hover:border-slate-300'"
                              [attr.aria-checked]="templateModel().templateId === t.id" (click)="choose(t)">
                        <span class="min-w-0 flex-1">
                          <span class="block text-sm font-semibold text-slate-900">{{ t.name }}</span>
                          <span class="block truncate text-xs text-slate-500">
                            {{ t.headerFormat === 'IMAGE' ? 'Avec une image' : 'Avec un document PDF' }} · {{ t.bodyText }}
                          </span>
                        </span>
                      </button>
                    }
                  </fieldset>

                  @if (selectedTemplate(); as t) {
                    <fieldset class="flex flex-col gap-2">
                      <legend class="mb-2 text-sm font-semibold text-slate-800">Pièce dans l’en-tête</legend>
                      @for (f of filesFor(t); track f.attachmentId) {
                        <button type="button" role="radio"
                                class="flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm text-slate-700"
                                [class]="attachmentId() === f.attachmentId ? 'border-2 border-primary' : 'border-slate-200'"
                                [attr.aria-checked]="attachmentId() === f.attachmentId" (click)="attachmentId.set(f.attachmentId!)">
                          <tas-icon iconName="feather:file" iconClass="!size-3" class="text-slate-400"></tas-icon>
                          <span class="min-w-0 flex-1 truncate">{{ f.fileName }}</span>
                          <span class="shrink-0 text-xs text-slate-400 tabular-nums">{{ size(f.sizeBytes) }}</span>
                        </button>
                      } @empty {
                        <p class="text-sm text-slate-500">
                          Aucune pièce du projet ne convient : ce modèle attend {{ t.headerFormat === 'IMAGE' ? 'une image JPEG ou PNG' : 'un PDF' }}.
                        </p>
                      }
                    </fieldset>

                    @if (templateForm.variables().value().length > 0) {
                      <fieldset class="flex flex-col gap-3">
                        <legend class="mb-1 text-sm font-semibold text-slate-800">Variables</legend>
                        @for (row of templateForm.variables; track $index; let i = $index) {
                          <tas-form-field>
                            <tas-label>{{ variableLabel(templateModel().variables[i].index) }}</tas-label>
                            <input tasInput type="text" [formField]="row.value" />
                            @if (row.value().touched() && row.value().invalid()) {
                              <tas-error>{{ row.value().errors()[0].message }}</tas-error>
                            }
                          </tas-form-field>
                        }
                      </fieldset>
                    }
                  }
                </form>
              }
            }

            @if (submitError()) {
              <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{{ submitError() }}</p>
            }
          </div>
        }
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-3">
          <button tas-outlined-button type="button" (click)="close()">Annuler</button>
          <button tas-raised-button color="primary" type="button" [disabled]="!canSend() || busy()" [isLoading]="busy()" (click)="send()">
            <tas-icon iconName="feather:send" style="font-size:14px"></tas-icon>
            Envoyer
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ProjectWhatsAppDrawer {
  private readonly _api = inject(WhatsAppApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _dialogRef = inject<DialogRef<ProjectWhatsAppDrawerResult>>(DialogRef);
  public readonly data = inject<ProjectWhatsAppDrawerData>(DIALOG_DATA);

  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  public readonly busy = signal(false);
  public readonly submitError = signal<string | null>(null);
  public readonly state = signal<ProjectWhatsAppDto | null>(null);
  public readonly mode = signal<'free' | 'template'>('free');
  public readonly picked = signal<Set<string>>(new Set(this.data.selected ?? []));
  public readonly attachmentId = signal<string | null>(null);

  public readonly files = computed(() => this.state()?.files ?? []);
  public readonly templates = computed(() => this.state()?.templates ?? []);
  // Le serveur donne « prendre la main » avant « fenêtre fermée » (ordre des règles de l'onglet
  // WhatsApp). Hors fenêtre, prendre la main ne permettrait toujours pas d'envoyer : la recette a
  // montré un tiroir qui proposait la prise en main d'une conversation muette depuis une semaine.
  public readonly freeBlocker = computed(() => {
    const s = this.state();
    const code = s?.blockers?.[0] ?? null;
    return code === 'WHATSAPP_NOT_HOLDER' && s?.conversationId && !s.windowOpen ? 'WHATSAPP_WINDOW_CLOSED' : code;
  });
  public readonly templateBlocker = computed(() => this.state()?.templateBlockers?.[0] ?? null);

  /** Prendre la main : seulement sur une conversation de la personne que personne d'autre ne tient. */
  public readonly canTakeOver = computed(() => {
    const s = this.state();
    return !!s?.conversationId && this.freeBlocker() === 'WHATSAPP_NOT_HOLDER' && s.conversationStatus !== 'Closed';
  });

  public captionModel = signal(CaptionFormModel.instantiate());
  public captionForm = form(this.captionModel, (schema) => {
    maxLength(schema.caption, 1024, { message: '1 024 caractères au maximum' });
  });

  public templateModel = signal(TemplateFormModel.instantiate());
  public templateForm = form(this.templateModel, (schema) => {
    required(schema.templateId, { message: 'Choisissez un modèle' });
    applyEach(schema.variables, (row) => {
      required(row.value, { message: 'Renseignez cette variable' });
      maxLength(row.value, 1024, { message: '1 024 caractères au maximum' });
      // Meta refuse un saut de ligne ou une tabulation dans une variable.
      validate(row.value, (ctx) =>
        /[\n\t]/.test(ctx.value()) ? { kind: 'single-line', message: 'Une seule ligne, sans tabulation' } : null,
      );
    });
  });

  public readonly selectedTemplate = computed(
    () => this.templates().find((t) => t.id === this.templateModel().templateId) ?? null,
  );

  public readonly canSend = computed(() => {
    if (!this.state()) return false;
    if (this.mode() === 'free') {
      const n = this.picked().size;
      return !this.freeBlocker() && n >= 1 && n <= 5 && !this.captionForm().invalid();
    }
    return !this.templateBlocker() && !!this.selectedTemplate() && !!this.attachmentId() && !this.templateForm().invalid();
  });

  constructor() {
    this._load();
  }

  public label(code: string): string {
    return label(code);
  }

  public variableLabel(index: number): string {
    return `Variable {{${index}}}`;
  }

  /** Les pièces que l'en-tête du modèle accepte : un PDF pour un document, une image pour une image. */
  public filesFor(template: WhatsAppComposeTemplateDto): ProjectWhatsAppFileDto[] {
    const accepts = (type: string | null | undefined) =>
      template.headerFormat === 'IMAGE' ? type === 'image/jpeg' || type === 'image/png' : type === 'application/pdf';
    return this.files().filter((f) => f.sendable && accepts(f.contentType));
  }

  public choose(template: WhatsAppComposeTemplateDto): void {
    this.templateForm().reset(Object.assign(new TemplateFormModel(), {
      templateId: template.id ?? '',
      variables: (template.variables ?? []).map((v) => Object.assign(new VariableRow(), { index: v.index ?? 0, value: v.value ?? '' })),
    }));
    // La pièce déjà choisie reste si l'en-tête du nouveau modèle l'accepte ; sinon la première qui convient.
    const fits = this.filesFor(template);
    if (!fits.some((f) => f.attachmentId === this.attachmentId())) {
      const preferred = fits.find((f) => this.picked().has(f.attachmentId!)) ?? fits[0];
      this.attachmentId.set(preferred?.attachmentId ?? null);
    }
  }

  public toggle(id: string, checked: boolean): void {
    this.picked.update((set) => {
      const next = new Set(set);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  public takeOver(): void {
    const s = this.state();
    if (!s?.recipientId || !s.conversationId) return;
    const call: Observable<unknown> = s.recipient === 'Client'
      ? this._api.takeOverClientWhatsApp(s.recipientId)
      : this._api.takeOverLeadWhatsApp(s.recipientId, s.conversationId);
    this.busy.set(true);
    call.pipe(
      catchError((error: HttpErrorResponse) => {
        this.busy.set(false);
        this._snackbar.error('WhatsApp', errorOf(error));
        return EMPTY;
      }),
    ).subscribe(() => {
      this.busy.set(false);
      this._load();
    });
  }

  public send(): void {
    this.submitError.set(null);
    if (this.mode() === 'free') this._sendFree();
    else this._sendTemplate();
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  public size(bytes: number | null | undefined): string {
    const n = bytes ?? 0;
    if (n < 1024) return `${n} o`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
    return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
  }

  public time(iso: string): string {
    return new Date(iso).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }

  private _load(): void {
    this.isLoading.set(!this.state());
    this._api.getProjectWhatsApp(this.data.projectId).pipe(
      catchError((error: HttpErrorResponse) => {
        this.isLoading.set(false);
        this.loadError.set(errorOf(error));
        return EMPTY;
      }),
    ).subscribe((state) => {
      const first = !this.state();
      this.state.set(state);
      this.isLoading.set(false);
      // D'emblée, la voie qui peut servir : la conversation si elle est ouverte et tenue, sinon un modèle.
      if (first && this.freeBlocker() && this.freeBlocker() !== 'WHATSAPP_NOT_HOLDER') this.mode.set('template');
      const templates = state.templates ?? [];
      if (first && templates.length === 1) this.choose(templates[0]);
    });
  }

  private _sendFree(): void {
    submit(this.captionForm, async (field) => {
      this.busy.set(true);
      const sent = await firstValueFrom(
        this._api.sendProjectWhatsAppDocuments(this.data.projectId, {
          attachmentIds: [...this.picked()],
          caption: field().value().caption.trim() || null,
        }).pipe(
          catchError((error: HttpErrorResponse) => {
            this.submitError.set(errorOf(error));
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );
      this.busy.set(false);
      if (!sent) return;

      const failed = sent.filter((r) => r.status !== 'Sent');
      if (failed.length === 0) {
        this._snackbar.success('Envoyé', sent.length > 1 ? `${sent.length} pièces envoyées sur WhatsApp.` : 'La pièce est partie sur WhatsApp.');
        this._dialogRef.close(true);
      } else {
        // Le fournisseur en a refusé : la page le dit plutôt que de fermer sur un succès.
        // Refus du fournisseur (ou du mode test) : le vocabulaire des bulles du fil, pas celui des blocages.
        const reason = whatsAppFailureLabel(failed[0].errorCode);
        this.submitError.set(failed.length > 1 ? `${failed.length} pièces refusées par WhatsApp. ${reason}` : `Pièce refusée par WhatsApp. ${reason}`);
        if (failed.length < sent.length) this._snackbar.info('Envoi partiel', 'Les autres pièces sont parties.');
      }
    });
  }

  private _sendTemplate(): void {
    const attachmentId = this.attachmentId();
    if (!attachmentId) return;
    submit(this.templateForm, async (field) => {
      this.busy.set(true);
      const value = field().value();
      const result = await firstValueFrom(
        this._api.sendProjectWhatsAppTemplate(this.data.projectId, {
          templateId: value.templateId,
          attachmentId,
          variables: value.variables.map((v) => v.value.trim()),
        }).pipe(
          catchError((error: HttpErrorResponse) => {
            this.submitError.set(errorOf(error));
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );
      this.busy.set(false);
      if (!result?.messageId) return;
      this._snackbar.success('Message en cours d’envoi', this.data.personName ? `Le modèle et sa pièce partent vers ${this.data.personName}.` : 'Le modèle et sa pièce partent.');
      this._dialogRef.close(true);
    });
  }
}
