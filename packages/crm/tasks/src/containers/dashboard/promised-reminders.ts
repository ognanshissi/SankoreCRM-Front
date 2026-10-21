import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { LeadDto } from '@sankore/crm-api';
import { TasIcon } from '@talisoft/ui/icon';
import { AgendaEntry } from './agenda-meta';
import { ContactButtons } from './contact-buttons';
import { promisedLabel } from './my-day-meta';

/**
 * « N rappels promis sont passés » : les rappels en retard, en tête de « À faire ». Un rappel est
 * une promesse faite au prospect (« je vous rappelle lundi à 14 h »), pas une tâche — d'où un
 * bandeau à part, et la mention qu'ils ne gonflent pas le compteur « En retard ». Un aperçu court,
 * en cartes et non en `tas-table`, comme le reste de l'écran (choix du propriétaire).
 */
@Component({
  selector: 'my-day-promised-reminders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon, ContactButtons],
  template: `
    @if (reminders().length > 0) {
      <section class="rounded-2xl border border-orange-200 bg-orange-50/60 p-4" aria-labelledby="promised-title">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="promised-title" class="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <tas-icon iconName="feather:bell" class="text-orange-600" style="font-size:15px"></tas-icon>
            <span class="tabular-nums">{{ reminders().length }}</span>
            {{ reminders().length > 1 ? 'rappels promis sont passés' : 'rappel promis est passé' }}
          </h2>
          <p class="text-xs text-slate-600">Ils ne comptent pas dans « En retard » : ce sont des rappels, pas des tâches</p>
        </div>

        <ul class="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          @for (r of reminders(); track r.key) {
            <li>
              <div class="flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 cursor-pointer hover:shadow-sm"
                role="link" tabindex="0" [attr.aria-label]="'Ouvrir les rappels de ' + r.leadName"
                (click)="open(r)" (keydown.enter)="open(r)">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold text-slate-900">{{ r.leadName }}</p>
                  <p class="truncate text-xs text-red-700" [title]="r.title">{{ promised(r.at, now()) }}</p>
                </div>
                <my-day-contact [leadId]="r.leadId!" [phone]="phoneOf(r)" [name]="r.leadName" variant="solid" [showWhatsapp]="false"></my-day-contact>
              </div>
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class PromisedReminders {
  private readonly _router = inject(Router);

  public readonly entries = input<AgendaEntry[]>([]);
  public readonly leads = input<Map<string, LeadDto>>(new Map());
  public readonly now = input(Date.now());

  public readonly reminders = computed(() => this.entries().filter((e) => e.kind === 'reminder' && e.isOverdue));
  public readonly promised = promisedLabel;

  public phoneOf(entry: AgendaEntry): string | null {
    return (entry.leadId && this.leads().get(entry.leadId)?.phoneNumber) || null;
  }

  public open(entry: AgendaEntry): void {
    this._router.navigate(['/leads', entry.leadId, 'suivi', 'rappels']);
  }
}
