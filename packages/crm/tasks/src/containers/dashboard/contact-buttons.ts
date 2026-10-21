import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RequestClickToCallRequestSlotEnum } from '@sankore/crm-api';
import { TasIcon } from '@talisoft/ui/icon';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { CallButton, TelephonyStatusService } from '@sankore/crm/telephony';
import { whatsappUrl } from './my-day-meta';

/**
 * Appeler et écrire au lead, depuis une ligne de « Ma journée ».
 *
 * L'appel passe par la téléphonie du CRM quand l'agent y est relié (l'appel est alors journalisé
 * et rattaché au lead) ; sinon c'est un simple lien `tel:`, que le poste ou le téléphone ouvre.
 * Le bouton WhatsApp n'apparaît que pour un numéro au format international : voir `whatsappUrl`.
 */
@Component({
  selector: 'my-day-contact',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon, CallButton],
  host: { class: 'inline-flex items-center gap-1.5', '(click)': '$event.stopPropagation()' },
  template: `
    @if (canMakeCalls()) {
      <lib-call-button entityType="Lead" [entityId]="leadId()" [slots]="primarySlot" [compact]="true"></lib-call-button>
    } @else if (phone()) {
      <a [href]="'tel:' + phone()" [class]="callClass()" [attr.aria-label]="'Appeler ' + (name() || 'le lead')" title="Appeler">
        <tas-icon iconName="feather:phone" style="font-size:14px"></tas-icon>
      </a>
    }
    @if (showWhatsapp() && whatsapp(); as url) {
      <a [href]="url" target="_blank" rel="noopener"
        class="inline-flex size-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
        [attr.aria-label]="'Écrire sur WhatsApp à ' + (name() || 'le lead')" title="WhatsApp">
        <tas-icon iconName="feather:message-circle" style="font-size:14px"></tas-icon>
      </a>
    }
  `,
})
export class ContactButtons {
  private readonly _telephony = inject(TelephonyStatusService);

  public readonly leadId = input.required<string>();
  public readonly phone = input<string | null | undefined>(null);
  public readonly name = input('');
  /** `solid` : le rond foncé du bandeau des rappels ; `soft` : le rond clair des lignes. */
  public readonly variant = input<'soft' | 'solid'>('soft');
  public readonly showWhatsapp = input(true);

  public readonly canMakeCalls = this._telephony.canMakeCalls;
  /** Un seul emplacement : un bouton simple plutôt qu'un menu « numéro principal / secondaire ». */
  public readonly primarySlot = [RequestClickToCallRequestSlotEnum.Primary] as const;
  public readonly whatsapp = computed(() => whatsappUrl(this.phone()));
  public readonly callClass = computed(() =>
    `inline-flex size-9 items-center justify-center rounded-full ${
      this.variant() === 'solid' ? 'bg-primary text-white hover:opacity-90' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`,
  );
}
