import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';
import { Severity, TasTag } from '@talisoft/ui/tag';

/** Statut d'un onglet de personne, tel que l'écran le lit (BNF-F-06 / BNF-F-07). */
export type PersonQuestionnaireState = 'locked' | 'todo' | 'done' | 'pending';

export interface PersonQuestionnaireTab {
  /** Clé stable de la personne dans l'écran (identifiant de sujet ou clé de repli). */
  key: string;
  /** Nom de la personne. */
  label: string;
  /** « Principal », « Conjoint », « Enfant 1 »… */
  roleLabel: string;
  state: PersonQuestionnaireState;
}

const STATE_META: Record<PersonQuestionnaireState, { label: string; severity: Severity; icon: string }> = {
  locked:  { label: 'Consentement requis', severity: 'error',   icon: 'feather:lock' },
  todo:    { label: 'À compléter',         severity: 'warning', icon: 'feather:edit-3' },
  done:    { label: 'Complété',            severity: 'success', icon: 'feather:check-circle' },
  pending: { label: 'Attribution en cours', severity: 'neutral', icon: 'feather:clock' },
};

/**
 * Barre d'onglets « une personne du foyer = un questionnaire » (BNF-F-06).
 *
 * C'est une navigation, pas une collection d'entités : elle reste du HTML
 * ordinaire là où la récapitulation des questionnaires dus, elle, passe par
 * `tas-table`. Le statut est doublé d'un libellé texte à côté du badge, pour ne
 * pas faire porter l'information par la seule couleur.
 */
@Component({
  selector: 'person-questionnaire-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon, TasTag],
  template: `
    <div
      role="tablist"
      aria-label="Personnes du foyer"
      class="flex items-stretch gap-2 overflow-x-auto pb-1"
    >
      @for (tab of tabs(); track tab.key) {
        <button
          type="button"
          role="tab"
          [id]="'person-tab-' + tab.key"
          [attr.aria-selected]="tab.key === selectedKey()"
          [attr.aria-controls]="'person-panel-' + tab.key"
          [tabindex]="tab.key === selectedKey() ? 0 : -1"
          class="shrink-0 min-w-[9.5rem] text-left rounded-lg border px-3 py-2 transition-colors
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          [class]="
            tab.key === selectedKey()
              ? 'border-primary bg-primary/10'
              : 'border-slate-200 bg-white hover:bg-slate-50'
          "
          (click)="selected.emit(tab.key)"
        >
          <span class="flex items-center gap-1.5">
            <tas-icon [iconName]="meta(tab).icon" class="text-slate-400" style="font-size:13px"></tas-icon>
            <span class="text-xs font-medium uppercase tracking-wide text-slate-500">
              {{ tab.roleLabel }}
            </span>
          </span>
          <span class="block text-sm font-medium text-slate-800 truncate mt-0.5">{{ tab.label }}</span>
          <span class="mt-1.5 block">
            <tas-tag [severity]="meta(tab).severity">{{ meta(tab).label }}</tas-tag>
          </span>
        </button>
      }
    </div>
  `,
})
export class PersonQuestionnaireTabs {
  public readonly tabs = input.required<PersonQuestionnaireTab[]>();
  public readonly selectedKey = input<string | null>(null);

  public readonly selected = output<string>();

  public meta(tab: PersonQuestionnaireTab): { label: string; severity: Severity; icon: string } {
    return STATE_META[tab.state];
  }
}
