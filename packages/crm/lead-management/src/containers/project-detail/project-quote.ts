import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal, viewChild } from '@angular/core';
import { form, FormField, FormRoot, maxLength, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { CompanyInfoApiService, OpportunitiesApiService, OpportunityDto, ProjectQuoteDto, ProjectQuoteIssueDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasHint, TasLabel, TasSuffix } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { QuoteLinesEditor } from '../../components/quote-lines/quote-lines-editor';
import { quoteContext } from '../../components/quote-lines/quote-context';
import {
  draftFromDto,
  draftToRequest,
  emptyLine,
  formatMoney,
  numberText,
  percentText,
  QuoteDraft,
  quoteErrorMessage,
} from '../../components/quote-lines/quote-lines.models';

class IssueFormModel {
  public validityDays!: string;
  public paymentTerms!: string;
}

class RefuseFormModel {
  public reason!: string;
  public static instantiate(): RefuseFormModel {
    const m = new RefuseFormModel();
    m.reason = '';
    return m;
  }
}

/**
 * « Produits et prix » du projet (devis en lignes, lot 4) : les lignes, les totaux, et la
 * validation d'une remise au-delà du plafond. Absente d'un projet de crédit, d'épargne ou
 * d'assurance, dont l'écran reste celui d'avant (un produit, un montant).
 *
 * Le tableau des lignes est le résumé de l'éditeur, pas une liste paginée : l'exception
 * `tas-table` du plan (docs/devis-en-lignes.md, lot 4) couvre la lecture comme l'édition.
 */
@Component({
  selector: 'project-quote',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRoot, FormField, Button, TasCard, TasFormField, TasLabel, TasError, TasHint, TasSuffix, TasIcon, TasInput, TasSpinner, QuoteLinesEditor],
  template: `
    @if (quote(); as q) {
      @if (q.quotable || q.lines?.length) {
        <tas-card class="block" id="quote">
          <div class="flex flex-col gap-4 p-5">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 class="text-base font-semibold text-slate-900">Produits et prix</h2>
                <p class="text-xs text-slate-500">Prix hors taxes. Le montant du projet est le total HT.</p>
              </div>
              @if (canManage() && !editing() && q.quotable) {
                <div class="flex flex-wrap gap-2">
                  <button tas-outlined-button color="primary" type="button" (click)="startEdit()">
                    <tas-icon [iconName]="q.lines?.length ? 'feather:edit-2' : 'feather:plus'" style="font-size:14px"></tas-icon>
                    {{ q.lines?.length ? 'Modifier les lignes' : 'Chiffrer le projet' }}
                  </button>
                  @if (q.canBeIssued && !issuing()) {
                    <button tas-raised-button color="primary" type="button" (click)="startIssue()">
                      <tas-icon iconName="feather:file-text" style="font-size:14px"></tas-icon>
                      {{ q.issues?.length ? 'Nouvelle version du devis' : 'Générer le devis' }}
                    </button>
                  }
                </div>
              }
            </div>

            @if (editing()) {
              <quote-lines-editor [(draft)]="draft" [catalogue]="ctx.catalogue()" [rules]="ctx.rules()"></quote-lines-editor>
              <div class="flex gap-2">
                <button tas-raised-button color="primary" type="button" (click)="save()"
                        [disabled]="saving() || (editor()?.formSchema()?.invalid() ?? true)" [isLoading]="saving()">Enregistrer les lignes</button>
                <button tas-text-button color="primary" type="button" [disabled]="saving()" (click)="editing.set(false)">Annuler</button>
              </div>
            } @else if (!q.lines?.length) {
              <p class="text-sm text-slate-500">Aucun produit chiffré. Le montant du projet reste celui saisi à la main.</p>
            } @else {
              <div class="overflow-x-auto">
                <table class="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr class="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th scope="col" class="py-2 pr-3 font-medium">Désignation</th>
                      <th scope="col" class="py-2 pr-3 text-right font-medium">Quantité</th>
                      <th scope="col" class="py-2 pr-3 text-right font-medium">Prix unitaire HT</th>
                      <th scope="col" class="py-2 pr-3 text-right font-medium">Remise</th>
                      <th scope="col" class="py-2 pr-3 text-right font-medium">TVA</th>
                      <th scope="col" class="py-2 text-right font-medium">Total HT</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (l of q.lines; track l.id) {
                      <tr>
                        <td class="py-2 pr-3 text-slate-900">{{ l.label }}</td>
                        <td class="py-2 pr-3 text-right tabular-nums">{{ qty(l.quantity) }}@if (l.unit) {&nbsp;{{ l.unit }}}</td>
                        <td class="py-2 pr-3 text-right tabular-nums">{{ money(l.unitPrice) }}</td>
                        <td class="py-2 pr-3 text-right tabular-nums">{{ l.discountKind === 'Percent' ? pct(l.discountValue) + ' %' : l.discountKind === 'Amount' ? money(l.discountAmount) : '—' }}</td>
                        <td class="py-2 pr-3 text-right tabular-nums">{{ pct(l.vatRate) }}&nbsp;%</td>
                        <td class="py-2 text-right font-medium tabular-nums">{{ money(l.netExclTax) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <dl class="ml-auto grid w-full max-w-sm grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
                @if (q.globalDiscountAmount) {
                  <dt class="text-slate-600">Sous-total HT</dt><dd class="text-right">{{ money(q.subtotalExclTax) }}</dd>
                  <dt class="text-slate-600">Remise globale</dt><dd class="text-right">− {{ money(q.globalDiscountAmount) }}</dd>
                }
                <dt class="font-semibold text-slate-900">Total HT</dt><dd class="text-right font-semibold text-slate-900">{{ money(q.totalExclTax) }}</dd>
                @for (b of q.vatByRate ?? []; track b.rate) {
                  <dt class="text-slate-600">TVA {{ pct(b.rate) }}&nbsp;%</dt><dd class="text-right">{{ money(b.vat) }}</dd>
                }
                <dt class="border-t border-slate-200 pt-1 font-bold text-slate-900">Total TTC</dt>
                <dd class="border-t border-slate-200 pt-1 text-right font-bold text-slate-900">{{ money(q.totalInclTax) }}</dd>
              </dl>

              @switch (q.approvalStatus) {
                @case ('Pending') {
                  <div class="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
                    <p class="flex items-start gap-2">
                      <tas-icon iconName="feather:clock" class="mt-0.5 shrink-0 text-amber-600" style="font-size:14px"></tas-icon>
                      <span>
                        <span class="font-semibold">À valider</span> : remise de {{ pct(q.effectiveDiscountPercent) }}&nbsp;% par rapport au catalogue,
                        au-delà du plafond de {{ pct(q.discountCeilingPercent ?? 0) }}&nbsp;%. Le devis ne pourra être édité qu’après la décision d’un responsable.
                      </span>
                    </p>
                    @if (q.canDecide) {
                      @if (refusing()) {
                        <form [formRoot]="refuseForm" class="flex flex-wrap items-end gap-2" (submit)="$event.preventDefault()">
                          <tas-form-field class="min-w-64 flex-1">
                            <tas-label>Pourquoi refuser ? <span class="text-functional-error">*</span></tas-label>
                            <input tasInput type="text" placeholder="Ex. Marge insuffisante" [formField]="refuseForm.reason" />
                            @if (refuseForm.reason().touched() && refuseForm.reason().invalid()) {
                              <tas-error>{{ refuseForm.reason().errors()[0].message }}</tas-error>
                            }
                          </tas-form-field>
                          <button tas-raised-button color="warn" type="button" (click)="confirmRefuse()"
                                  [disabled]="refuseForm().invalid() || refuseForm().submitting()" [isLoading]="refuseForm().submitting()">Refuser la remise</button>
                          <button tas-text-button type="button" (click)="refusing.set(false)">Annuler</button>
                        </form>
                      } @else {
                        <div class="flex gap-2">
                          <button tas-raised-button color="primary" type="button" [disabled]="deciding()" [isLoading]="deciding()" (click)="approve()">Accepter la remise</button>
                          <button tas-outlined-button color="warn" type="button" [disabled]="deciding()" (click)="refusing.set(true)">Refuser</button>
                        </div>
                      }
                    }
                  </div>
                }
                @case ('Approved') {
                  <p class="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
                    <tas-icon iconName="feather:check-circle" class="mt-0.5 shrink-0 text-green-600" style="font-size:14px"></tas-icon>
                    <span>Remise de {{ pct(q.effectiveDiscountPercent) }}&nbsp;% acceptée par {{ q.decidedByName ?? 'un responsable' }}@if (q.decisionComment) { : « {{ q.decisionComment }} »}.</span>
                  </p>
                }
                @case ('Rejected') {
                  <p class="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    <tas-icon iconName="feather:x-circle" class="mt-0.5 shrink-0 text-red-600" style="font-size:14px"></tas-icon>
                    <span>Remise refusée par {{ q.decidedByName ?? 'un responsable' }} : « {{ q.decisionComment }} ». Modifiez les lignes pour la soumettre à nouveau.</span>
                  </p>
                }
              }

              @if (issuing()) {
                <form [formRoot]="issueForm" class="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4" (submit)="$event.preventDefault()">
                  <p class="text-sm font-semibold text-slate-800">
                    {{ q.number ? 'Nouvelle version de ' + q.number : 'Devis à générer' }}
                  </p>
                  <div class="grid grid-cols-1 gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
                    <tas-form-field>
                      <tas-label>Validité</tas-label>
                      <input tasInput type="text" inputmode="numeric" [formField]="issueForm.validityDays" />
                      <button tasSuffix type="button" tabindex="-1" aria-hidden="true" class="cursor-default whitespace-nowrap pr-3 text-sm text-slate-500">jours</button>
                      @if (issueForm.validityDays().touched() && issueForm.validityDays().invalid()) {
                        <tas-error>{{ issueForm.validityDays().errors()[0].message }}</tas-error>
                      }
                    </tas-form-field>
                    <tas-form-field>
                      <tas-label>Conditions de paiement</tas-label>
                      <input tasInput type="text" placeholder="Ex. 50 % à la commande, solde à la livraison" [formField]="issueForm.paymentTerms" />
                      @if (issueForm.paymentTerms().touched() && issueForm.paymentTerms().invalid()) {
                        <tas-error>{{ issueForm.paymentTerms().errors()[0].message }}</tas-error>
                      } @else {
                        <tas-hint>Proposées par les réglages de l’institution ; vide, rien n’est imprimé.</tas-hint>
                      }
                    </tas-form-field>
                  </div>
                  <div class="flex gap-2">
                    <button tas-raised-button color="primary" type="button" (click)="issue()"
                            [disabled]="issueForm().invalid() || issueForm().submitting()" [isLoading]="issueForm().submitting()">Générer le PDF</button>
                    <button tas-text-button type="button" [disabled]="issueForm().submitting()" (click)="issuing.set(false)">Annuler</button>
                  </div>
                </form>
              }

              @if (q.issues?.length) {
                <div class="flex flex-col gap-2">
                  <h3 class="text-sm font-semibold text-slate-800">Devis émis</h3>
                  @if (q.changedSinceIssue) {
                    <p class="text-xs text-amber-800">Les lignes ont changé depuis le dernier devis : générez une nouvelle version avant de l’envoyer.</p>
                  }
                  <ul class="divide-y divide-slate-100 rounded-xl border border-slate-200" role="list">
                    @for (i of q.issues; track i.id) {
                      <li class="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                        <tas-icon iconName="feather:file-text" class="text-slate-400" style="font-size:16px"></tas-icon>
                        <div class="min-w-48 flex-1">
                          <p class="font-medium text-slate-900">{{ i.label }}</p>
                          <p class="text-xs text-slate-500">
                            {{ day(i.issuedAt) }}@if (i.issuedByName) { · {{ i.issuedByName }} } · {{ money(i.totalInclTax) }} TTC · valable jusqu’au {{ day(i.validUntil) }}
                            @if (i.lastSentAt) { · <span class="text-green-700">envoyé {{ i.lastSentChannel === 'WhatsApp' ? 'par WhatsApp' : 'par e-mail' }} le {{ day(i.lastSentAt) }}</span> }
                          </p>
                        </div>
                        <div class="flex items-center gap-1">
                          <button tas-button iconButton type="button" title="Télécharger" aria-label="Télécharger" (click)="download(i)">
                            <tas-icon iconName="feather:download" style="font-size:14px" class="text-slate-500"></tas-icon>
                          </button>
                          @if (canMail()) {
                            <button tas-button iconButton type="button" title="Envoyer par e-mail" aria-label="Envoyer par e-mail" (click)="sendByMail.emit(i.attachmentId!)">
                              <tas-icon iconName="feather:mail" style="font-size:14px" class="text-slate-500"></tas-icon>
                            </button>
                          }
                          @if (canWhatsApp()) {
                            <button tas-button iconButton type="button" title="Envoyer par WhatsApp" aria-label="Envoyer par WhatsApp" (click)="sendByWhatsApp.emit(i.attachmentId!)">
                              <tas-icon iconName="feather:message-circle" style="font-size:14px" class="text-slate-500"></tas-icon>
                            </button>
                          }
                        </div>
                      </li>
                    }
                  </ul>
                </div>
              }
            }
          </div>
        </tas-card>
      }
    } @else if (loading()) {
      <div class="flex justify-center py-6"><tas-spinner size="6" class="text-primary"></tas-spinner></div>
    }
  `,
})
export class ProjectQuote implements OnInit {
  private readonly _api = inject(OpportunitiesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _company = inject(CompanyInfoApiService);
  public readonly ctx = quoteContext();
  public readonly issuing = signal(false);

  public readonly project = input.required<OpportunityDto>();
  public readonly canManage = input(false);
  public readonly canMail = input(false);
  public readonly canWhatsApp = input(false);
  /** Envoyer un devis émis : la page ouvre son tiroir, la pièce déjà cochée. */
  public readonly sendByMail = output<string>();
  public readonly sendByWhatsApp = output<string>();
  /** Les lignes ont été enregistrées ou décidées : le projet (montant, produit, historique) a changé. */
  public readonly changed = output<void>();
  /** Le projet a des lignes : son montant et son produit ne se tapent plus à la main. */
  public readonly linesDriven = output<boolean>();

  public readonly editor = viewChild(QuoteLinesEditor);
  public readonly quote = signal<ProjectQuoteDto | null>(null);
  public readonly loading = signal(true);
  public readonly editing = signal(false);
  public readonly saving = signal(false);
  public readonly deciding = signal(false);
  public readonly refusing = signal(false);
  public draft = signal<QuoteDraft>(draftFromDto(null));

  public readonly currency = computed(() => this.quote()?.currency ?? this.ctx.rules().currency);

  public issueModel = signal<IssueFormModel>({ validityDays: '30', paymentTerms: '' });
  public issueForm = form(this.issueModel, (schema) => {
    validate(schema.validityDays, (ctx) => {
      const v = ctx.value().trim();
      return /^\d+$/.test(v) && +v >= 1 && +v <= 365 ? null : { kind: 'days', message: 'Entre 1 et 365 jours' };
    });
    maxLength(schema.paymentTerms, 500, { message: '500 caractères au plus' });
  });

  public refuseModel = signal(RefuseFormModel.instantiate());
  public refuseForm = form(this.refuseModel, (schema) => {
    required(schema.reason, { message: 'Le motif est obligatoire' });
  });

  ngOnInit(): void {
    this.reload();
  }

  public reload(): void {
    this.loading.set(true);
    this._api.getProjectQuote(this.project().id!).pipe(catchError(() => {
      this.loading.set(false);
      return EMPTY;
    })).subscribe((q) => this._set(q));
  }

  public startEdit(): void {
    const draft = draftFromDto(this.quote());
    // « Chiffrer le projet » ouvre sur une première ligne à remplir.
    this.draft.set(draft.lines.length ? draft : { ...draft, lines: [emptyLine()] });
    this.editing.set(true);
  }

  public async save(): Promise<void> {
    const q = this.quote();
    this.saving.set(true);
    const saved = await firstValueFrom(
      this._api.setProjectQuote(this.project().id!, draftToRequest(this.draft(), q?.updatedAt)).pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error('Lignes non enregistrées', quoteErrorMessage(err.error?.error ?? err.error?.detail));
          return EMPTY;
        }),
      ),
      { defaultValue: null },
    );
    this.saving.set(false);
    if (!saved) return;
    this._set(saved);
    this.editing.set(false);
    this._snackbar.success(
      'Lignes enregistrées',
      saved.approvalStatus === 'Pending'
        ? 'La remise dépasse le plafond : un responsable a été prévenu.'
        : `Total HT : ${this.money(saved.totalExclTax)}.`,
    );
    this.changed.emit();
  }

  /** Le formulaire de génération, prérempli par les réglages de l'institution. */
  public startIssue(): void {
    this._company.getQuoteSettings().pipe(catchError(() => EMPTY)).subscribe((s) =>
      this.issueModel.set({ validityDays: String(s.validityDays ?? 30), paymentTerms: s.paymentTerms ?? '' }));
    this.issuing.set(true);
  }

  public issue(): void {
    submit(this.issueForm, async (field) => {
      const v = field().value();
      const issued = await firstValueFrom(
        this._api.issueProjectQuote(this.project().id!, { validityDays: Number(v.validityDays.trim()), paymentTerms: v.paymentTerms.trim() }).pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Devis non généré', issueErrorMessage(err.error?.error));
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );
      if (!issued) return;
      this._set(issued);
      this.issuing.set(false);
      this._snackbar.success('Devis généré', `${issued.issues?.[0]?.label ?? 'Le devis'} est rangé dans les pièces du projet.`);
      this.changed.emit();
    });
  }

  public download(i: ProjectQuoteIssueDto): void {
    this._api
      .downloadProjectAttachment(this.project().id!, i.attachmentId!)
      .pipe(
        map((body) => body as unknown as Blob),
        catchError(() => {
          this._snackbar.error('Téléchargement impossible', 'Le devis n’a pas pu être lu.');
          return EMPTY;
        }),
      )
      .subscribe((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = i.fileName ?? `Devis ${i.label}.pdf`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
  }

  public day(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  }

  public async approve(): Promise<void> {
    this.deciding.set(true);
    const done = await this._decide(true, null);
    this.deciding.set(false);
    if (done) this._snackbar.success('Remise acceptée', 'Le devis peut être édité.');
  }

  public confirmRefuse(): void {
    submit(this.refuseForm, async (field) => {
      const done = await this._decide(false, field().value().reason.trim());
      if (!done) return;
      this.refusing.set(false);
      this.refuseModel.set(RefuseFormModel.instantiate());
      this._snackbar.success('Remise refusée', 'L’agent a été prévenu.');
    });
  }

  private async _decide(approve: boolean, comment: string | null): Promise<boolean> {
    const decided = await firstValueFrom(
      this._api.decideProjectQuote(this.project().id!, { approve, comment }).pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error('Décision non enregistrée', quoteErrorMessage(err.error?.error));
          return EMPTY;
        }),
      ),
      { defaultValue: null },
    );
    if (!decided) return false;
    this._set(decided);
    this.changed.emit();
    return true;
  }

  private _set(q: ProjectQuoteDto): void {
    this.quote.set(q);
    this.loading.set(false);
    this.linesDriven.emit((q.lines?.length ?? 0) > 0);
  }

  public money(v: number | null | undefined): string {
    return formatMoney(v ?? 0, this.currency());
  }

  public pct(v: number | null | undefined): string {
    return percentText(v ?? 0);
  }

  public qty(v: number | null | undefined): string {
    return numberText(v ?? 0);
  }
}

function issueErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'QUOTE_EMPTY': return 'Ajoutez au moins une ligne avant de générer le devis.';
    case 'QUOTE_DISCOUNT_NOT_APPROVED': return 'La remise doit être acceptée par un responsable avant de générer le devis.';
    case 'PROJECT_ATTACHMENTS_UNAVAILABLE': return 'Le stockage des pièces n’est pas configuré : le devis ne peut pas être rangé.';
    case 'OPPORTUNITY_ALREADY_CLOSED': return 'Ce projet est perdu.';
    default: return 'Le devis n’a pas pu être généré.';
  }
}
