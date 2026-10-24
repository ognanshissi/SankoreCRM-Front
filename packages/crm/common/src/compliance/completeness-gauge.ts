import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { CompletenessGap, LeadCompletenessDto } from '@sankore/crm-api';
import { completenessGapLabel, completenessGapTitle } from './compliance-labels';

/** Un manquant, enrichi de son libellé et de la section où le corriger. */
export interface CompletenessGapView {
  code: string;
  label: string;
  detail: string | null;
  actionHint: string | null;
  blocking: boolean;
}

/** Les manquants d'une même personne, regroupés pour l'affichage. */
export interface CompletenessSubjectGroup {
  subjectLabel: string;
  gaps: CompletenessGapView[];
  blockingCount: number;
}

/**
 * Section de la fiche lead vers laquelle renvoyer un manquant. Le front ne décide
 * rien du métier : il range un code dans l'onglet où l'agent peut agir, sinon
 * « chaque manque renvoie à l'action » (BNF-F-02, BNF-F-08) reste une liste morte.
 */
export type CompletenessSection =
  | 'identite'
  | 'foyer'
  | 'conformite'
  | 'questionnaires'
  | 'consentement'
  | 'client';

export function completenessGapSection(code: string | null | undefined): CompletenessSection {
  const value = code ?? '';
  if (value.startsWith('FATCA') || value.startsWith('PEP')) return 'conformite';
  // Un consentement exigé par la ligne de produit se recueille dans l'onglet Consentements ; le
  // consentement santé, lui, se donne par personne avec son questionnaire.
  if (value === 'CONSENT_MISSING') return 'consentement';
  if (value.startsWith('QUESTIONNAIRE') || value === 'MISSING_QUESTIONNAIRE' || value.includes('CONSENT')) return 'questionnaires';
  if (value.startsWith('CUSTOMER_')) return 'client';
  if (value.startsWith('SPOUSE') || value.startsWith('CHILD') || value.startsWith('HOUSEHOLD')) return 'foyer';
  if (value.startsWith('KYC')) return 'client';
  return 'identite';
}

function toView(gap: CompletenessGap): CompletenessGapView {
  return {
    code: gap.code ?? '',
    // Le champ ou le consentement nommé quand le détail est un code connu, plutôt que le code brut.
    label: completenessGapTitle(gap) !== (gap.detail ?? '') ? completenessGapTitle(gap) : completenessGapLabel(gap.code),
    detail: completenessGapTitle(gap) !== (gap.detail ?? '') ? null : gap.detail ?? null,
    actionHint: gap.actionHint ?? null,
    blocking: gap.blocking ?? false,
  };
}

/**
 * Jauge de complétude et liste des éléments manquants, regroupés par personne et
 * cliquables. Posée en tête de la fiche lead (BNF-F-02) et reprise dans le
 * contrôle avant conversion (BNF-F-08) : un seul composant, parce que les deux
 * écrans doivent dire la même chose du même dossier.
 *
 * Le pourcentage et `canConvert` viennent de l'API ; le front ne les recalcule
 * jamais — le calcul de complétude est hors périmètre frontend.
 */
@Component({
  selector: 'completeness-gauge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasCard, TasIcon, TasTag],
  template: `
    <tas-card class="block">
      <div class="p-4">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0">
            <p class="text-xs font-semibold text-slate-400">Complétude du dossier</p>
            <p class="text-sm text-slate-600 mt-1">
              {{ satisfied() }} élément{{ satisfied() > 1 ? 's' : '' }} sur {{ applicable() }} renseigné{{ satisfied() > 1 ? 's' : '' }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-2xl font-semibold text-slate-900 tabular-nums">{{ percentage() }}%</span>
            @if (canConvert()) {
              <tas-tag severity="success">Dossier complet</tas-tag>
            } @else if (blockingCount() > 0) {
              <tas-tag severity="warning">{{ blockingCount() }} point{{ blockingCount() > 1 ? 's' : '' }} bloquant{{ blockingCount() > 1 ? 's' : '' }}</tas-tag>
            }
          </div>
        </div>

        <div
          class="mt-3 h-2 w-full rounded-full bg-slate-100 overflow-hidden"
          role="progressbar"
          [attr.aria-valuenow]="percentage()"
          aria-valuemin="0"
          aria-valuemax="100"
          [attr.aria-label]="'Complétude du dossier : ' + percentage() + ' pour cent'"
        >
          <div
            class="h-full rounded-full transition-[width] duration-300"
            [class.bg-functional-success]="canConvert()"
            [class.bg-primary]="!canConvert()"
            [style.width.%]="percentage()"
          ></div>
        </div>

        @if (groups().length === 0) {
          <p class="mt-4 flex items-center gap-2 text-sm text-slate-600">
            <tas-icon iconName="feather:check-circle" class="text-functional-success" style="font-size:14px"></tas-icon>
            Aucun élément manquant.
          </p>
        } @else {
          <div class="mt-4 flex flex-col gap-3">
            @for (group of groups(); track group.subjectLabel) {
              <div class="rounded-lg border border-slate-200">
                <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100">
                  <p class="text-sm font-medium text-slate-800">{{ group.subjectLabel }}</p>
                  @if (group.blockingCount > 0) {
                    <tas-tag severity="warning">{{ group.blockingCount }} bloquant{{ group.blockingCount > 1 ? 's' : '' }}</tas-tag>
                  }
                </div>
                <ul class="divide-y divide-slate-100">
                  @for (gap of group.gaps; track gap.code + gap.detail) {
                    <li>
                      <button
                        type="button"
                        class="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-slate-50 focus:outline-none focus:bg-slate-50"
                        (click)="gapSelected.emit(gap)"
                      >
                        <tas-icon
                          [iconName]="gap.blocking ? 'feather:alert-circle' : 'feather:info'"
                          [class.text-functional-error]="gap.blocking"
                          [class.text-slate-400]="!gap.blocking"
                          class="mt-0.5 shrink-0"
                          style="font-size:13px"
                        ></tas-icon>
                        <span class="min-w-0">
                          <span class="block text-sm text-slate-800">{{ gap.label }}</span>
                          @if (gap.detail) {
                            <span class="block text-xs text-slate-500">{{ gap.detail }}</span>
                          }
                          @if (gap.actionHint) {
                            <span class="block text-xs text-primary">{{ gap.actionHint }}</span>
                          }
                        </span>
                      </button>
                    </li>
                  }
                </ul>
              </div>
            }
          </div>
        }
      </div>
    </tas-card>
  `,
})
export class CompletenessGauge {
  public readonly completeness = input<LeadCompletenessDto | null>(null);

  /** Émis au clic sur un manquant : le parent navigue vers la bonne section. */
  public readonly gapSelected = output<CompletenessGapView>();

  public readonly percentage = computed(() =>
    Math.max(0, Math.min(100, Math.round(this.completeness()?.percentage ?? 0))),
  );
  public readonly satisfied = computed(() => this.completeness()?.satisfied ?? 0);
  public readonly applicable = computed(() => this.completeness()?.applicable ?? 0);
  public readonly canConvert = computed(() => this.completeness()?.canConvert === true);

  public readonly groups = computed<CompletenessSubjectGroup[]>(() => {
    const gaps = this.completeness()?.gaps ?? [];
    const bySubject = new Map<string, CompletenessGapView[]>();
    for (const gap of gaps) {
      const subject = gap.subjectLabel?.trim() || 'Dossier';
      const list = bySubject.get(subject) ?? [];
      list.push(toView(gap));
      bySubject.set(subject, list);
    }
    return [...bySubject.entries()].map(([subjectLabel, list]) => ({
      subjectLabel,
      gaps: list,
      blockingCount: list.filter((g) => g.blocking).length,
    }));
  });

  public readonly blockingCount = computed(() =>
    this.groups().reduce((total, group) => total + group.blockingCount, 0),
  );
}
