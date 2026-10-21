import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { applyEach, form, FormField, FormRoot, maxLength, required, submit, validate } from '@angular/forms/signals';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { WhatsAppApiService, WhatsAppComposeTemplateDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTitle } from '@talisoft/ui/title';
import { whatsAppSendError } from './whatsapp-labels';

export interface SendWhatsAppTemplateDrawerData {
  leadId: string;
  leadName: string;
  maskedPhone: string | null;
}

/** Ce que le drawer rend à la fiche : la conversation où le message a été mis en file. */
export interface SendWhatsAppTemplateDrawerResult {
  conversationId: string;
  messageId: string;
}

const FIELD_LABELS: Record<string, string> = {
  LeadFirstName: 'Prénom du lead',
  LeadLastName: 'Nom du lead',
  LeadFullName: 'Nom complet du lead',
  InterestedProduct: 'Produit demandé',
  AgentFirstName: 'Votre prénom',
  AgentFullName: 'Votre nom complet',
};

const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilitaire',
  AUTHENTICATION: 'Authentification',
};

class VariableRow {
  public index!: number;
  public field!: string;
  public value!: string;

  public static of(index: number, field: string | null | undefined, value: string | null | undefined): VariableRow {
    return Object.assign(new VariableRow(), { index, field: field ?? '', value: value ?? '' });
  }
}

class SendTemplateFormModel {
  public templateId!: string;
  public variables!: VariableRow[];

  public static instantiate(): SendTemplateFormModel {
    return Object.assign(new SendTemplateFormModel(), { templateId: '', variables: [] });
  }
}

/** Un morceau du corps rendu : du texte, ou une variable (remplie ou non). */
interface PreviewPart {
  text: string;
  variable: boolean;
  missing: boolean;
}

/**
 * « Contacter via WhatsApp » (WA-FE-04) : choisir un template approuvé pour le produit du lead, en
 * relire les variables pré-remplies, voir le rendu, confirmer.
 *
 * Rien ne part d'ici : le serveur met le message en file et répond aussitôt ; son statut (envoyé,
 * livré, lu, échec) arrive ensuite sur le fil de la conversation.
 */
@Component({
  selector: 'send-whatsapp-template-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasIcon,
    TasInput,
    TasFormField,
    TasLabel,
    TasHint,
    TasError,
    TasSpinner,
    Button,
  ],
  template: `
    <tas-side-drawer width="640px">
      <tas-drawer-title>
        <tas-title>Contacter {{ data.leadName }} via WhatsApp</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (isLoading()) {
          <div class="flex justify-center py-16"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
        } @else if (templates().length === 0) {
          <div class="rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center">
            <p class="text-sm font-medium text-slate-700">Aucun template approuvé pour ce lead</p>
            <p class="mt-1 text-sm text-slate-500">
              Seuls les templates approuvés par Meta et prévus pour son produit sont proposés. Demandez à
              l’administrateur de synchroniser ou de paramétrer les templates WhatsApp.
            </p>
          </div>
        } @else {
          <form [formRoot]="formSchema" class="flex flex-col gap-5">
            <fieldset class="flex flex-col gap-2">
              <legend class="mb-2 text-sm font-semibold text-slate-800">Template</legend>
              @for (t of templates(); track t.id) {
                <button type="button" role="radio"
                        class="flex items-start gap-3 rounded-xl border bg-white px-4 py-3 text-left"
                        [class]="model().templateId === t.id ? 'border-2 border-primary' : 'border-slate-200 hover:border-slate-300'"
                        [attr.aria-checked]="model().templateId === t.id"
                        (click)="choose(t)">
                  <span class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2"
                        [class]="model().templateId === t.id ? 'border-primary' : 'border-slate-300'">
                    @if (model().templateId === t.id) { <span class="size-2 rounded-full bg-primary"></span> }
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block text-sm font-semibold text-slate-900">{{ t.name }}</span>
                    <span class="block truncate text-xs text-slate-500">
                      {{ category(t.category) }} · {{ t.language }} · {{ t.bodyText }}
                    </span>
                  </span>
                </button>
              }
            </fieldset>

            @if (selected(); as t) {
              @if (formSchema.variables().value().length > 0) {
                <fieldset class="flex flex-col gap-3">
                  <legend class="mb-1 text-sm font-semibold text-slate-800">Variables</legend>
                  @for (row of formSchema.variables; track $index; let i = $index) {
                    <tas-form-field>
                      <tas-label>{{ variableLabel(model().variables[i]) }}</tas-label>
                      <input tasInput type="text" [formField]="row.value" />
                      @if (model().variables[i].field) {
                        <tas-hint>Pré-rempli depuis la fiche ; vous pouvez le corriger.</tas-hint>
                      }
                      @if (row.value().touched() && row.value().invalid()) {
                        <tas-error>{{ row.value().errors()[0].message }}</tas-error>
                      }
                    </tas-form-field>
                  }
                </fieldset>
              }

              <section aria-label="Aperçu du message" class="rounded-2xl bg-[#e5ddd5] p-4">
                <div class="ml-auto max-w-[85%] rounded-xl rounded-tr-sm bg-[#dcf8c6] px-3 py-2 text-sm text-slate-900 shadow-sm">
                  @if (t.headerText) { <p class="mb-1 font-semibold">{{ t.headerText }}</p> }
                  <p class="whitespace-pre-line">
                    @for (part of preview(); track $index) {
                      @if (part.variable) {
                        <mark class="rounded px-0.5" [class]="part.missing ? 'bg-amber-200 text-amber-900' : 'bg-emerald-200/70 text-slate-900'">{{ part.text }}</mark>
                      } @else {
                        <span>{{ part.text }}</span>
                      }
                    }
                  </p>
                  @if (t.footerText) { <p class="mt-1 text-xs text-slate-500">{{ t.footerText }}</p> }
                </div>
                @if ((t.buttons ?? []).length > 0) {
                  <div class="ml-auto mt-1 flex max-w-[85%] flex-col gap-1">
                    @for (b of t.buttons; track $index) {
                      <span class="rounded-lg bg-white px-3 py-1.5 text-center text-sm font-medium text-sky-700 shadow-sm">{{ b }}</span>
                    }
                  </div>
                }
              </section>
            }
          </form>
        }
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-3">
          @if (data.maskedPhone) {
            <p class="mr-auto text-xs text-slate-500">Envoyé au {{ data.maskedPhone }}</p>
          }
          <button tas-outlined-button type="button" (click)="close()">Annuler</button>
          <button tas-raised-button color="primary" type="button"
                  [disabled]="!selected() || formSchema().invalid() || formSchema().submitting()"
                  [isLoading]="formSchema().submitting()"
                  (click)="confirmAndSend()">
            <tas-icon iconName="feather:send" style="font-size:14px"></tas-icon>
            Envoyer
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class SendWhatsAppTemplateDrawer {
  private readonly _api = inject(WhatsAppApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _dialogRef = inject<DialogRef<SendWhatsAppTemplateDrawerResult>>(DialogRef);
  public readonly data = inject<SendWhatsAppTemplateDrawerData>(DIALOG_DATA);

  public readonly isLoading = signal(true);
  public readonly templates = signal<WhatsAppComposeTemplateDto[]>([]);

  public model = signal(SendTemplateFormModel.instantiate());
  public formSchema = form(this.model, (schema) => {
    required(schema.templateId, { message: 'Choisissez un template' });
    applyEach(schema.variables, (row) => {
      required(row.value, { message: 'Renseignez cette variable' });
      maxLength(row.value, 1024, { message: '1 024 caractères au maximum' });
      // Meta refuse un saut de ligne ou une tabulation dans une variable.
      validate(row.value, (ctx) =>
        /[\n\t]/.test(ctx.value()) ? { kind: 'single-line', message: 'Une seule ligne, sans tabulation' } : null,
      );
    });
  });

  public readonly selected = computed(() => this.templates().find((t) => t.id === this.model().templateId) ?? null);

  /** Le corps du template, les `{{n}}` remplacés par les valeurs saisies — ou laissés visibles s'ils manquent. */
  public readonly preview = computed<PreviewPart[]>(() => {
    const template = this.selected();
    if (!template) return [];
    const values = this.model().variables;
    const parts: PreviewPart[] = [];
    const body = template.bodyText ?? '';
    const pattern = /\{\{\s*(\d{1,2})\s*\}\}/g;
    let last = 0;
    for (let match = pattern.exec(body); match; match = pattern.exec(body)) {
      if (match.index > last) parts.push({ text: body.slice(last, match.index), variable: false, missing: false });
      const value = values.find((v) => v.index === Number(match![1]))?.value.trim();
      parts.push({ text: value || match[0], variable: true, missing: !value });
      last = match.index + match[0].length;
    }
    if (last < body.length) parts.push({ text: body.slice(last), variable: false, missing: false });
    return parts;
  });

  constructor() {
    this._api.composeLeadWhatsApp(this.data.leadId).pipe(
      catchError((error: HttpErrorResponse) => {
        this.isLoading.set(false);
        this._snackbar.error('WhatsApp', whatsAppSendError(error));
        return EMPTY;
      }),
    ).subscribe((templates) => {
      this.templates.set(templates ?? []);
      this.isLoading.set(false);
      if (templates?.length === 1) this.choose(templates[0]);
    });
  }

  public choose(template: WhatsAppComposeTemplateDto): void {
    this.formSchema().reset(Object.assign(new SendTemplateFormModel(), {
      templateId: template.id ?? '',
      variables: (template.variables ?? []).map((v) => VariableRow.of(v.index ?? 0, v.field, v.value)),
    }));
  }

  public variableLabel(row: VariableRow): string {
    return row.field ? `{{${row.index}}} · ${FIELD_LABELS[row.field] ?? row.field}` : `Variable {{${row.index}}}`;
  }

  public category(code: string | null | undefined): string {
    return CATEGORY_LABELS[(code ?? '').toUpperCase()] ?? code ?? '';
  }

  public confirmAndSend(): void {
    const template = this.selected();
    if (!template) return;
    this._confirm.confirm({
      title: 'Envoyer ce message WhatsApp ?',
      message: `Le template « ${template.name} » sera envoyé à ${this.data.leadName}. Un nouveau template ne pourra pas lui être envoyé avant 24 h s’il ne répond pas.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Envoyer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._send(),
    });
  }

  public close(): void {
    this._dialogRef.close();
  }

  private _send(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const result = await firstValueFrom(
        this._api.sendLeadWhatsAppTemplate(this.data.leadId, {
          templateId: value.templateId,
          variables: value.variables.map((v) => v.value.trim()),
        }).pipe(
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error('Envoi impossible', whatsAppSendError(error));
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );
      if (!result?.conversationId || !result.messageId) return;
      this._snackbar.success('Message en cours d’envoi', `Le template part vers ${this.data.leadName}.`);
      this._dialogRef.close({ conversationId: result.conversationId, messageId: result.messageId });
    });
  }
}
