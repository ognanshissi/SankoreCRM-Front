import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { WhatsAppApiService, WhatsAppBotOverviewDto, WhatsAppBotProfileRowDto } from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSwitch } from '@talisoft/ui/switch';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { botErrorMessage } from './whatsapp-bot-referential';
import { ComplaintSettingsCard } from './complaint-settings-card';

/**
 * Le chatbot WhatsApp (WA-FE-11) : l'interrupteur de l'institution, le modèle du déploiement,
 * puis un profil par produit — et le profil général, qui répond aux prospects dont le produit
 * n'est pas encore connu (un numéro inconnu qui écrit devient un lead sans produit).
 *
 * Trois interrupteurs doivent être ouverts pour qu'un client parle au bot : le modèle (déploiement),
 * l'institution (ici) et le profil du produit. L'écran les montre ensemble pour qu'aucun ne soit
 * oublié en silence.
 */
@Component({
  selector: 'whatsapp-bot-page',
  templateUrl: './whatsapp-bot-page.html',
  imports: [DatePipe, RouterLink, Anchor, Button, TasCard, TasIcon, TasSwitch, TasTable, TasTag, ComplaintSettingsCard],
})
export class WhatsAppBotPage implements OnInit {
  private readonly _api = inject(WhatsAppApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);

  public isLoading = signal(true);
  public loadError = signal<string | null>(null);
  public overview = signal<WhatsAppBotOverviewDto | null>(null);
  public isToggling = signal(false);

  public readonly profiles = computed(() => this.overview()?.profiles ?? []);
  public readonly enabledCount = computed(() => this.profiles().filter((p) => p.isEnabled).length);

  public tableConfig = signal<TableConfig>({
    property: 'name',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 20, pageSizeOptions: [20, 50], totalElements: 0 },
  });

  ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'WhatsApp Business', link: ['/settings/whatsapp'] },
      { label: 'Chatbot' },
    ]);
    this.reload();
  }

  public reload(): void {
    this.isLoading.set(true);
    this.loadError.set(null);

    this._api
      .getWhatsAppBotOverview()
      .pipe(
        catchError((err: unknown) => {
          this.loadError.set(botErrorMessage(err, 'Le paramétrage du chatbot n’a pas pu être chargé.'));
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((overview) => {
        this.overview.set(overview);
        this.isLoading.set(false);
      });
  }

  public setTenantEnabled(enabled: boolean): void {
    this.isToggling.set(true);

    this._api
      .setWhatsAppBotEnabled({ enabled })
      .pipe(
        catchError((err: unknown) => {
          this._snackbar.error('Erreur', botErrorMessage(err, 'Le chatbot n’a pas pu être activé.'));
          this.isToggling.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.overview.update((o) => (o ? { ...o, tenantEnabled: enabled } : o));
        this.isToggling.set(false);
        this._snackbar.success(
          enabled ? 'Chatbot activé' : 'Chatbot désactivé',
          enabled
            ? 'Il répond pour les produits dont le profil est activé.'
            : 'Chaque message client part désormais directement vers un conseiller.',
        );
      });
  }

  public open(row: WhatsAppBotProfileRowDto): void {
    this._router.navigate(['/settings/whatsapp/bot', row.productLineId ?? 'general']);
  }

  public statusOf(row: WhatsAppBotProfileRowDto): { label: string; severity: 'success' | 'neutral' | 'warning' } {
    if (!row.version) return { label: 'Non configuré', severity: 'neutral' };
    return row.isEnabled ? { label: 'Activé', severity: 'success' } : { label: 'Désactivé', severity: 'warning' };
  }
}

export default WhatsAppBotPage;
