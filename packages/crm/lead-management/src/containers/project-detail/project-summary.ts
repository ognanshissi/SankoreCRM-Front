import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { form, FormField, FormRoot, maxLength, required, submit } from '@angular/forms/signals';
import { ClientDetailDto, LeadDto, OpportunityDto, UpdateOpportunityRequest } from '@sankore/crm-api';
import { projectAmountLabel } from '@sankore/crm/common';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { formatAmount, formatDay } from '../edit-lead/lead-view.models';
import {
  closeDateLabel,
  closeDateWarning,
  isClosed,
  monthsFromNow,
  probabilityPercent,
  stepSuggestion,
  weightedAmount,
} from '../edit-lead/opportunities/opportunity.model';

class NextStepFormModel {
  public text!: string;
  public dueOn!: string;

  public static from(p: OpportunityDto | null): NextStepFormModel {
    const m = new NextStepFormModel();
    m.text = p?.nextStep ?? '';
    m.dueOn = p?.nextStepDueOn ?? '';
    return m;
  }
}

class CloseDateFormModel {
  public date!: string;

  public static from(p: OpportunityDto | null): CloseDateFormModel {
    const m = new CloseDateFormModel();
    m.date = p?.expectedCloseDate ? p.expectedCloseDate.slice(0, 10) : '';
    return m;
  }
}

/** Une écriture de la page : vrai quand le serveur l'a acceptée et que le projet a été relu. */
export type ProjectUpdate = (patch: UpdateOpportunityRequest, success: string) => Promise<boolean>;

/**
 * La colonne de droite de la page projet (propriétaire, 2026-10-27) : pour qui, combien, quand,
 * la prochaine action, sur quel produit et quel parcours — ce qu'on veut voir sans faire défiler.
 * La clôture prévue et la prochaine action s'y modifient sur place ; le reste passe par
 * « Modifier le projet ».
 */
@Component({
  selector: 'project-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, FormRoot, FormField, Anchor, Button, TasCard, TasDatePicker, TasFormField, TasLabel, TasError, TasIcon, TasInput,
  ],
  template: `
    @let p = project();
    <tas-card class="block">
      <div class="flex flex-col divide-y divide-slate-100">
        <!-- Issue d'un projet clos -->
        @if (closed()) {
          <div class="flex flex-col gap-3 p-4">
            <p class="flex items-center gap-2 text-sm font-semibold" [class]="p.stage === 'ClosedWon' ? 'text-green-700' : 'text-red-700'">
              <tas-icon [iconName]="p.stage === 'ClosedWon' ? 'feather:check-circle' : 'feather:x-circle'" style="font-size:16px"></tas-icon>
              {{ p.stage === 'ClosedWon' ? 'Gagné' : 'Perdu' }} le {{ formatDay(p.closedAt ?? p.updatedAt, true) }}
            </p>
            @if (p.closeReason) {
              <p class="text-sm text-slate-700">Motif : {{ p.closeReason }}</p>
            }
            @if (holdingId() && clientId()) {
              <a tas-outlined-button color="primary" [routerLink]="['/customers', clientId(), 'contrats', 'holding:' + holdingId()]">Voir le contrat</a>
            } @else if (p.stage === 'ClosedWon' && clientId()) {
              <a tas-text-button color="primary" [routerLink]="['/customers', clientId(), 'contrats']">Contrats du client</a>
            }
            @if (canOpenHolding()) {
              <button tas-outlined-button color="primary" type="button" [disabled]="busy()" [isLoading]="busy()" (click)="openHolding.emit()">
                Ouvrir le contrat
              </button>
            }
          </div>
        }

        <!-- Pour qui -->
        <div class="p-4">
          <p class="text-xs text-slate-500">{{ clientId() ? 'Client' : 'Prospect' }}</p>
          @if (personLink(); as link) {
            <a [routerLink]="link" class="mt-0.5 block font-semibold text-slate-900 hover:text-primary">{{ personName() }}</a>
          } @else {
            <p class="mt-0.5 font-semibold text-slate-900">{{ personName() }}</p>
          }
          <div class="mt-1 flex flex-col gap-0.5 text-sm text-slate-600">
            @if (client()?.clientNumber) { <span class="tabular-nums">{{ client()!.clientNumber }}</span> }
            @if (lead()?.phoneNumber) { <span class="tabular-nums">{{ lead()!.phoneNumber }}</span> }
            @if (lead()?.email) { <span class="truncate">{{ lead()!.email }}</span> }
          </div>
          @if (clientId() && lead()) {
            <a [routerLink]="['/customers', clientId()]" class="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
              Fiche client <tas-icon iconName="feather:arrow-right" style="font-size:12px"></tas-icon>
            </a>
          }
        </div>

        <!-- Combien -->
        <div class="p-4">
          <p class="text-xs text-slate-500">{{ amountLabel() }}</p>
          @if (p.estimatedAmount?.amount) {
            <p class="mt-0.5 text-2xl font-bold text-slate-900 tabular-nums">{{ formatAmount(p.estimatedAmount!.amount, p.estimatedAmount!.currency) }}</p>
            @if (!closed() && tracksForecast()) {
              <p class="mt-1 text-sm text-slate-600">
                soit <span class="font-semibold text-primary tabular-nums">{{ formatAmount(weighted(), p.estimatedAmount!.currency) }}</span> pondérés
              </p>
            }
          } @else {
            <p class="mt-0.5 font-semibold text-red-700">À préciser</p>
          }
          @if (!closed() && tracksForecast()) {
            <div class="mt-3">
              <p class="flex items-baseline justify-between text-xs text-slate-500">
                Probabilité de signature
                <span class="font-semibold text-slate-800 tabular-nums">{{ probability() }} %</span>
              </p>
              <div class="mt-1 h-1.5 rounded-full bg-slate-100" role="meter" aria-label="Probabilité de signature" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="probability()">
                <div class="h-1.5 rounded-full bg-primary" [style.width.%]="probability()"></div>
              </div>
              <p class="mt-1 text-[11px] text-slate-400">Fixée par l'étape en cours.</p>
            </div>
          }
        </div>

        <!-- Quand -->
        @if (!closed() && tracksForecast()) {
          <div id="exit-date" class="p-4">
            <p class="text-xs text-slate-500">{{ criticalCloseDate() ? 'Date limite de clôture' : 'Clôture prévue' }}</p>
            @if (editor() === 'closeDate') {
              <form [formRoot]="closeDateForm" class="mt-1 flex flex-col gap-2">
                <tas-date-picker mode="date" labelScreenOnly [formField]="closeDateForm.date">Date de clôture prévue</tas-date-picker>
                <div class="flex items-center gap-2">
                  <button tas-raised-button color="primary" type="button" [disabled]="closeDateForm().invalid() || closeDateForm().submitting()" (click)="saveCloseDate()">Enregistrer</button>
                  <button tas-text-button type="button" (click)="editor.set(null)">Annuler</button>
                </div>
              </form>
            } @else {
              @if (p.expectedCloseDate) {
                <p class="mt-0.5 font-semibold" [class]="closeWarning() ? 'text-red-700' : 'text-slate-900'">{{ closeDateLabel(p.expectedCloseDate) }}</p>
              } @else {
                <p class="mt-0.5 font-semibold text-red-700">{{ criticalCloseDate() ? 'À fixer : obligatoire pour ce produit' : 'Non définie' }}</p>
              }
              @if (closeWarning(); as warning) {
                <p class="mt-1 text-xs text-red-700">{{ warning }}</p>
              }
              @if (canManage()) {
                <div class="mt-2 flex flex-wrap items-center gap-1.5">
                  <button type="button" class="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" [disabled]="busy()" (click)="setCloseInMonths(1)">Dans 1 mois</button>
                  <button type="button" class="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" [disabled]="busy()" (click)="setCloseInMonths(3)">Dans 3 mois</button>
                  <button type="button" class="rounded-full px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/5" (click)="editCloseDate()">Autre date</button>
                </div>
              }
            }
          </div>
        }

        <!-- Prochaine action : « prochaine étape » prêtait à confusion avec les étapes du parcours -->
        @if (!closed()) {
          <div class="p-4">
            <p class="text-xs text-slate-500">Prochaine action</p>
            @if (editor() === 'nextStep') {
              <form [formRoot]="nextStepForm" class="mt-1 flex flex-col gap-2">
                <tas-form-field>
                  <tas-label class="sr-only">Action à mener</tas-label>
                  <input tasInput type="text" placeholder="Ex. Planifier la visite du chantier" [formField]="nextStepForm.text" />
                  @if (nextStepForm.text().touched() && nextStepForm.text().invalid()) {
                    <tas-error>{{ nextStepForm.text().errors()[0].message }}</tas-error>
                  }
                </tas-form-field>
                <tas-date-picker mode="date" labelScreenOnly [formField]="nextStepForm.dueOn">Échéance</tas-date-picker>
                <div class="flex items-center gap-2">
                  <button tas-raised-button color="primary" type="button" [disabled]="nextStepForm().invalid() || nextStepForm().submitting()" (click)="saveNextStep()">Enregistrer</button>
                  <button tas-text-button type="button" (click)="editor.set(null)">Annuler</button>
                </div>
              </form>
            } @else if (p.nextStep) {
              <p class="mt-0.5 font-semibold text-slate-900">{{ p.nextStep }}</p>
              @if (p.nextStepDueOn) {
                <p class="mt-0.5 text-xs text-slate-500">pour le {{ formatDay(p.nextStepDueOn, true) }}</p>
              }
              @if (canManage()) {
                <div class="mt-2 flex items-center gap-1.5">
                  <button type="button" class="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/15" [disabled]="busy()" (click)="clearNextStep()">Fait</button>
                  <button type="button" class="rounded-full px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100" (click)="editNextStep()">Modifier</button>
                </div>
              }
            } @else {
              <p class="mt-0.5 font-semibold text-red-700">Non définie</p>
              @if (canManage()) {
                <div class="mt-2 flex flex-wrap items-center gap-1.5">
                  @if (suggestion(); as s) {
                    <button type="button" class="rounded-full bg-primary/10 px-2.5 py-1 text-left text-xs font-semibold text-primary hover:bg-primary/15" [disabled]="busy()" (click)="useSuggestion(s)">{{ s }}</button>
                  }
                  <button type="button" class="rounded-full px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100" (click)="editNextStep()">Autre</button>
                </div>
              }
            }
          </div>
        }

        <!-- Sur quoi -->
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-4 text-sm">
          <dt class="text-slate-500">Produit</dt>
          <dd class="text-right">
            @if (p.product) { <span class="font-medium text-slate-800">{{ p.product }}</span> }
            @else { <span class="font-semibold text-red-700">À préciser</span> }
          </dd>
          <dt class="text-slate-500">Parcours</dt>
          <dd class="text-right text-slate-800">
            {{ p.templateName ?? 'Parcours standard' }}
            @if (p.templateVersion) { <span class="text-slate-400">· v{{ p.templateVersion }}</span> }
          </dd>
          @if (ownerName(); as owner) {
            <dt class="text-slate-500">Suivi par</dt>
            <dd class="text-right text-slate-800">{{ owner }}</dd>
          }
          <dt class="text-slate-500">Créé le</dt>
          <dd class="text-right text-slate-800 tabular-nums">{{ formatDay(p.createdAt, true) }}</dd>
          <dt class="text-slate-500">Mis à jour le</dt>
          <dd class="text-right text-slate-800 tabular-nums">{{ formatDay(p.updatedAt, true) }}</dd>
        </dl>
      </div>
    </tas-card>
  `,
})
export class ProjectSummary {
  public readonly project = input.required<OpportunityDto>();
  public readonly lead = input<LeadDto | null>(null);
  public readonly client = input<ClientDetailDto | null>(null);
  public readonly clientId = input<string | null>(null);
  public readonly ownerName = input<string | null>(null);
  public readonly canManage = input(false);
  public readonly busy = input(false);
  public readonly holdingId = input<string | null>(null);
  public readonly canOpenHolding = input(false);
  public readonly update = input.required<ProjectUpdate>();

  public readonly openHolding = output<void>();

  public readonly formatAmount = formatAmount;
  public readonly formatDay = formatDay;
  public readonly closeDateLabel = closeDateLabel;

  public readonly editor = signal<'closeDate' | 'nextStep' | null>(null);

  public readonly closed = computed(() => isClosed(this.project()));
  public readonly tracksForecast = computed(() => this.project().tracksForecast !== false);
  /** « Montant du crédit », « Prime annuelle »… selon le gabarit. */
  public readonly amountLabel = computed(() => projectAmountLabel(this.project().amountKind));
  /** La clôture est une échéance (crédit de campagne) : « Date limite », et dépassée = urgence. */
  public readonly criticalCloseDate = computed(() => !!this.project().criticalCloseDate);
  public readonly probability = computed(() => probabilityPercent(this.project()));
  public readonly weighted = computed(() => weightedAmount(this.project()));
  public readonly closeWarning = computed(() => closeDateWarning(this.project()));
  public readonly suggestion = computed(() => stepSuggestion(this.project()));

  public readonly personName = computed(
    () =>
      this.lead()?.fullName?.trim() ||
      [this.lead()?.firstName, this.lead()?.lastName].filter(Boolean).join(' ') ||
      this.client()?.displayName?.trim() ||
      '—',
  );
  public readonly personLink = computed<unknown[] | null>(() => {
    const lead = this.lead();
    if (lead?.id) return ['/leads', lead.id];
    const clientId = this.clientId();
    return clientId ? ['/customers', clientId] : null;
  });

  public nextStepModel = signal(NextStepFormModel.from(null));
  public nextStepForm = form(this.nextStepModel, (schema) => {
    required(schema.text, { message: "Décrivez l'action à mener" });
    maxLength(schema.text, 200, { message: "L'action ne peut pas dépasser 200 caractères" });
  });

  public closeDateModel = signal(CloseDateFormModel.from(null));
  public closeDateForm = form(this.closeDateModel, (schema) => {
    required(schema.date, { message: 'Choisissez une date' });
  });

  public setCloseInMonths(months: number): void {
    void this.update()({ expectedCloseDate: monthsFromNow(months) }, 'Clôture prévue mise à jour');
  }

  /** Public : la page l'ouvre depuis un refus « date de clôture obligatoire ». */
  public editCloseDate(): void {
    this.closeDateModel.set(CloseDateFormModel.from(this.project()));
    this.closeDateForm().reset();
    this.editor.set('closeDate');
  }

  public saveCloseDate(): void {
    submit(this.closeDateForm, async (field) => {
      const done = await this.update()({ expectedCloseDate: `${field().value().date}T12:00:00Z` }, 'Clôture prévue mise à jour');
      if (done) this.editor.set(null);
    });
  }

  public useSuggestion(text: string): void {
    void this.update()({ nextStep: text }, 'Prochaine action définie');
  }

  public editNextStep(): void {
    this.nextStepModel.set(NextStepFormModel.from(this.project()));
    this.nextStepForm().reset();
    this.editor.set('nextStep');
  }

  public saveNextStep(): void {
    submit(this.nextStepForm, async (field) => {
      const v = field().value();
      const done = await this.update()({ nextStep: v.text.trim(), nextStepDueOn: v.dueOn || null }, 'Prochaine action définie');
      if (done) this.editor.set(null);
    });
  }

  public clearNextStep(): void {
    void this.update()({ nextStep: '' }, 'Prochaine action faite');
  }
}
