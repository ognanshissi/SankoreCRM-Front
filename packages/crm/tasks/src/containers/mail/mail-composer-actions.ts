import { ChangeDetectionStrategy, Component, computed, input, model, output, signal } from '@angular/core';
import { form, FormField, required, submit, validate } from '@angular/forms/signals';
import { MailTemplateDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasIcon } from '@talisoft/ui/icon';
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import { scheduleChoices, scheduleLabel } from './mail-labels';

/** Les émojis les plus courants d'un échange professionnel — une grille, pas une bibliothèque. */
const EMOJIS = [
  '😀', '😃', '😊', '🙂', '😉', '😍', '🤩', '😎', '🤔', '😅', '😂', '🙏', '👍', '👎', '👏', '🙌',
  '👌', '✌️', '🤝', '💪', '👋', '🎉', '🎊', '🥳', '❤️', '💙', '💚', '⭐', '✨', '🔥', '✅', '❌',
  '⚠️', '❗', '❓', '💡', '📌', '📎', '📄', '📅', '⏰', '📞', '📧', '💬', '🏦', '💰', '💳', '📈',
  '🏠', '🚗', '🎁', '☕', '🌍', '☀️', '🌧️', '😢', '😮', '😴', '🤗', '😇', '🙈', '👀', '🚀', '💯',
];

class ScheduleFormModel {
  public when = '';
}

/**
 * La barre d'actions sous un e-mail en cours, à la manière de Gmail : « Envoyer » et son menu
 * « Programmer l'envoi », puis « Aa » (la barre de mise en forme), pièce jointe, lien, émoji,
 * signature, modèle — et la corbeille pour abandonner le brouillon.
 */
@Component({
  selector: 'mail-composer-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, Button, TasDatePicker, TasIcon, Menu, MenuItem, TasMenuTrigger],
  host: { class: 'block' },
  template: `
    @if (scheduling()) {
      <div class="mb-2 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5" role="group" aria-label="Programmer l’envoi">
        <tas-date-picker class="min-w-56 flex-1" mode="datetime" [min]="today" [formField]="scheduleForm.when">Envoyer le</tas-date-picker>
        <div class="flex gap-1">
          <button tas-text-button type="button" (click)="scheduling.set(false)">Annuler</button>
          <button tas-raised-button color="primary" type="button" [disabled]="scheduleForm().invalid() || !canSend()" (click)="scheduleAt()">
            <tas-icon iconName="feather:clock" iconClass="!size-3.5" class="me-1.5"></tas-icon>Programmer
          </button>
        </div>
        @if (scheduleForm.when().touched() && scheduleForm.when().invalid()) {
          <p class="w-full text-xs text-functional-error">{{ scheduleForm.when().errors()[0].message }}</p>
        }
      </div>
    }

    <div class="flex flex-wrap items-center gap-0.5">
      <!-- Envoyer | ▾ : le bouton coupé de Gmail -->
      <div class="me-1.5 inline-flex overflow-hidden rounded-full" [class.opacity-50]="!canSend()">
        <button type="button" class="inline-flex items-center gap-1.5 bg-primary py-2 pe-3 ps-4 text-sm font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed"
                [disabled]="!canSend() || sending()" (click)="send.emit(null)">
          @if (sending()) {
            <span class="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true"></span>
          } @else {
            <tas-icon iconName="feather:send" iconClass="!size-3.5"></tas-icon>
          }
          Envoyer
        </button>
        <button type="button" class="border-s border-white/30 bg-primary px-2 text-white hover:bg-primary/90 disabled:cursor-not-allowed"
                aria-label="Options d’envoi" title="Programmer l’envoi" [disabled]="!canSend() || sending()" TasMenuTrigger [panel]="sendMenu" (click)="refreshChoices()">
          <tas-icon iconName="feather:chevron-down" iconClass="!size-3.5"></tas-icon>
        </button>
      </div>
      <ng-template #sendMenu>
        <tas-menu>
          <p class="px-5 pb-1 pt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Programmer l’envoi</p>
          @for (c of choices(); track c.label) {
            <tas-menu-item>
              <button type="button" class="flex w-full items-baseline justify-between gap-4 text-left" (click)="send.emit(c.at)">
                <span>{{ c.label }}</span>
                <span class="text-xs tabular-nums text-slate-500">{{ scheduleLabel(c.at) }}</span>
              </button>
            </tas-menu-item>
          }
          <tas-menu-item>
            <button type="button" class="flex w-full items-center gap-2 text-left" (click)="openSchedule()">
              <tas-icon iconName="feather:calendar" iconClass="!size-3.5" class="text-slate-500"></tas-icon>
              Choisir la date et l’heure
            </button>
          </tas-menu-item>
        </tas-menu>
      </ng-template>

      <button type="button" [class]="iconClass(toolbar())" title="Mise en forme" aria-label="Mise en forme" [attr.aria-pressed]="toolbar()" (click)="toolbar.update((v) => !v)">
        <span class="text-[15px] font-semibold leading-none">Aa</span>
      </button>

      <label [class]="iconClass(false) + ' cursor-pointer'" title="Joindre des fichiers">
        <tas-icon iconName="feather:paperclip" iconClass="!size-4"></tas-icon>
        <span class="sr-only">Joindre des fichiers</span>
        <input type="file" multiple class="sr-only" (change)="pickFiles($any($event.target))" />
      </label>

      <button type="button" [class]="iconClass(false)" title="Insérer un lien" aria-label="Insérer un lien" (click)="link.emit()">
        <tas-icon iconName="feather:link" iconClass="!size-4"></tas-icon>
      </button>

      <button type="button" [class]="iconClass(false)" title="Insérer un émoji" aria-label="Insérer un émoji" TasMenuTrigger [panel]="emojiMenu">
        <tas-icon iconName="feather:smile" iconClass="!size-4"></tas-icon>
      </button>
      <ng-template #emojiMenu>
        <tas-menu class="!grid !min-w-0 grid-cols-8 gap-0.5 !p-2">
          @for (e of emojis; track e) {
            <tas-menu-item class="!grid size-8 place-items-center rounded-md !p-0 text-lg" (click)="emoji.emit(e)" [attr.aria-label]="e">{{ e }}</tas-menu-item>
          }
        </tas-menu>
      </ng-template>

      <button type="button" [class]="iconClass(false)" title="Signature" aria-label="Signature" TasMenuTrigger [panel]="signatureMenu">
        <tas-icon iconName="feather:pen-tool" iconClass="!size-4"></tas-icon>
      </button>
      <ng-template #signatureMenu>
        <tas-menu>
          <tas-menu-item [disabled]="!hasSignature()">
            <button type="button" class="w-full text-left disabled:text-slate-400" [disabled]="!hasSignature()" (click)="signature.emit()">
              {{ hasSignature() ? 'Insérer ma signature' : 'Aucune signature pour cette boîte' }}
            </button>
          </tas-menu-item>
          <tas-menu-item>
            <button type="button" class="w-full text-left" (click)="editSignature.emit()">
              {{ hasSignature() ? 'Modifier ma signature' : 'Créer ma signature' }}
            </button>
          </tas-menu-item>
        </tas-menu>
      </ng-template>

      @if (templates().length > 0) {
        <button type="button" [class]="iconClass(false)" title="Partir d’un modèle" aria-label="Partir d’un modèle" TasMenuTrigger [panel]="templateMenu">
          <tas-icon iconName="feather:file-text" iconClass="!size-4"></tas-icon>
        </button>
        <ng-template #templateMenu>
          <tas-menu>
            <p class="px-5 pb-1 pt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Partir d’un modèle</p>
            @for (t of templates(); track t.id) {
              <tas-menu-item>
                <button type="button" class="w-full text-left" (click)="template.emit(t)">{{ t.name }}</button>
              </tas-menu-item>
            }
          </tas-menu>
        </ng-template>
      }

      <span class="flex-1"></span>

      <button type="button" [class]="iconClass(false)" [title]="discardLabel()" [attr.aria-label]="discardLabel()" (click)="discard.emit()">
        <tas-icon iconName="feather:trash-2" iconClass="!size-4"></tas-icon>
      </button>
    </div>
  `,
})
export class MailComposerActions {
  public readonly canSend = input(true);
  public readonly sending = input(false);
  public readonly templates = input<MailTemplateDto[]>([]);
  public readonly hasSignature = input(false);
  public readonly discardLabel = input('Supprimer le brouillon');
  /** La barre de mise en forme de l'éditeur, affichée ou non. */
  public readonly toolbar = model(false);

  /** `null` : maintenant ; une date : programmé. */
  public readonly send = output<Date | null>();
  public readonly files = output<File[]>();
  public readonly link = output<void>();
  public readonly emoji = output<string>();
  public readonly signature = output<void>();
  public readonly editSignature = output<void>();
  public readonly template = output<MailTemplateDto>();
  public readonly discard = output<void>();

  public readonly emojis = EMOJIS;
  public readonly scheduleLabel = scheduleLabel;
  public readonly today = new Date().toLocaleDateString('sv-SE');

  public readonly scheduling = signal(false);
  /** Recalculé à l'ouverture du menu : « demain » dépend de l'heure. */
  private readonly _tick = signal(0);
  public readonly choices = computed(() => {
    this._tick();
    return scheduleChoices();
  });

  public readonly scheduleModel = signal(new ScheduleFormModel());
  public readonly scheduleForm = form(this.scheduleModel, (schema) => {
    required(schema.when, { message: 'Choisissez la date et l’heure' });
    validate(schema.when, (ctx) => {
      const at = new Date(ctx.value());
      if (!ctx.value() || isNaN(at.getTime())) return null;
      if (at.getTime() < Date.now() + 60_000) return { kind: 'min', message: 'Choisissez un moment dans le futur' };
      if (at.getTime() > Date.now() + 365 * 86_400_000) return { kind: 'max', message: 'Un an au plus' };
      return null;
    });
  });

  public refreshChoices(): void {
    this._tick.update((n) => n + 1);
  }

  public iconClass(active: boolean): string {
    return `inline-grid size-9 place-items-center rounded-full transition-colors ${
      active ? 'bg-primary/15 text-primary' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    }`;
  }

  public pickFiles(field: HTMLInputElement): void {
    const picked = Array.from(field.files ?? []);
    field.value = '';
    if (picked.length > 0) this.files.emit(picked);
  }

  public openSchedule(): void {
    this._tick.update((n) => n + 1);
    const tomorrow = scheduleChoices()[0].at;
    const local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    this.scheduleModel.set(Object.assign(new ScheduleFormModel(), { when: local }));
    this.scheduling.set(true);
  }

  public scheduleAt(): void {
    submit(this.scheduleForm, async () => {
      // « 2026-10-30T08:00 » est une heure locale : le navigateur la lit comme telle.
      this.send.emit(new Date(this.scheduleModel().when));
      this.scheduling.set(false);
    });
  }
}
