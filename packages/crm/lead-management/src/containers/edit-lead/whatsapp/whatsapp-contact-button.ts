import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { WhatsAppApiService, WhatsAppPanelDto } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { formatDay } from '../lead-view.models';
import {
  SendWhatsAppTemplateDrawer,
  SendWhatsAppTemplateDrawerData,
  SendWhatsAppTemplateDrawerResult,
} from './send-whatsapp-template-drawer';
import { CONSENT_CHANNEL_LABELS, CONSENT_STATE, whatsAppBlockerLabel } from './whatsapp-labels';

/** Le badge seul, pour l'en-tête du fil et la carte « Joindre ». */
@Component({
  selector: 'lead-whatsapp-consent-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let state = consent[consentState()] ?? consent['Unknown'];
    <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
          [class]="state.tone" [attr.title]="detail()">
      WhatsApp : {{ state.label }}
    </span>
  `,
})
export class WhatsAppConsentBadge {
  public readonly consentState = input<string>('Unknown');
  public readonly consentAt = input<string | null | undefined>(null);
  public readonly consentChannel = input<string | null | undefined>(null);

  public readonly consent = CONSENT_STATE;

  public readonly detail = computed(() => {
    const at = this.consentAt();
    if (!at) return 'Aucun consentement WhatsApp n’a été recueilli.';
    const source = CONSENT_CHANNEL_LABELS[this.consentChannel() ?? ''] ?? this.consentChannel() ?? '';
    const verb = this.consentState() === 'Revoked' ? 'Retiré' : 'Recueilli';
    return `${verb} le ${formatDay(at, true)}${source ? ` · ${source}` : ''}`;
  });
}

/**
 * Le badge de consentement WhatsApp et le bouton « Contacter via WhatsApp » de la carte « Joindre »
 * (WA-FE-03, WA-FE-04).
 *
 * Désactivé avec la raison au survol — consentement, numéro, canal, délai de 24 h — et non masqué :
 * un agent qui ne voit pas le bouton ne sait pas qu'il manque un consentement. Les raisons viennent
 * du serveur, qui applique les mêmes règles à l'envoi.
 */
@Component({
  selector: 'lead-whatsapp-contact',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon, WhatsAppConsentBadge],
  template: `
    @if (canSend()) {
      @if (panel(); as p) {
        <div class="mt-2 flex items-center gap-2 rounded-xl bg-slate-50 p-3">
          <div class="min-w-0 flex-1">
            <p class="text-xs text-slate-500">WhatsApp</p>
            <lead-whatsapp-consent-badge [consentState]="p.consentState ?? 'Unknown'" [consentAt]="p.consentAt"
                                         [consentChannel]="p.consentChannel"></lead-whatsapp-consent-badge>
          </div>
          <button type="button"
                  class="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors"
                  [class]="p.canSend ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-200/70 text-slate-400 cursor-not-allowed'"
                  [disabled]="!p.canSend"
                  [attr.title]="p.canSend ? 'Envoyer un template WhatsApp' : blockersText()"
                  [attr.aria-label]="p.canSend ? 'Contacter via WhatsApp' : 'Contacter via WhatsApp — indisponible : ' + blockersText()"
                  (click)="open()">
            <tas-icon iconName="feather:send" style="font-size:13px"></tas-icon>
            Contacter
          </button>
        </div>
        @if (!p.canSend && blockersText()) {
          <p class="mt-1 px-1 text-xs text-slate-500">{{ blockersText() }}</p>
        }
      }
    }
  `,
})
export class WhatsAppContactButton {
  private readonly _api = inject(WhatsAppApiService);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _router = inject(Router);
  private readonly _permissions = inject(PermissionsService);

  public readonly leadId = input.required<string>();
  public readonly leadName = input('ce prospect');

  public readonly canSend = this._permissions.can('WhatsApp.Send');
  public readonly panel = signal<WhatsAppPanelDto | null>(null);

  public readonly blockersText = computed(() =>
    (this.panel()?.blockers ?? []).map(whatsAppBlockerLabel).join(' '),
  );

  constructor() {
    effect(() => {
      const id = this.leadId();
      if (!this.canSend()) return;
      untracked(() => this.reload(id));
    });
  }

  public reload(id = this.leadId()): void {
    this._api.getLeadWhatsApp(id).pipe(catchError(() => EMPTY)).subscribe((p) => this.panel.set(p));
  }

  public open(): void {
    const data: SendWhatsAppTemplateDrawerData = {
      leadId: this.leadId(),
      leadName: this.leadName(),
      maskedPhone: this.panel()?.maskedPhone ?? null,
    };
    const ref = this._drawer.open<SendWhatsAppTemplateDrawerResult, SendWhatsAppTemplateDrawerData, SendWhatsAppTemplateDrawer>(
      SendWhatsAppTemplateDrawer,
      { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data },
    );
    ref.closed.subscribe((result) => {
      if (!result) return;
      this.reload();
      this._router.navigate(['/leads', this.leadId(), 'suivi', 'whatsapp']);
    });
  }
}

