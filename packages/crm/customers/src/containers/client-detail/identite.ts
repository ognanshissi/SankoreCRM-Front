import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
} from '@angular/core';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { PermissionsService } from '@sankore/crm/common';
import { RevealSensitiveFieldRequestFieldEnum } from '@sankore/crm-api';
import { ClientDetailStore } from '../../models/client-detail.store';
import {
  genderLabel,
  identityDocumentLabel,
  isLegalClient,
  maritalStatusLabel,
} from '../../models/client-labels';
import { SensitiveField } from '../../components/sensitive-field';
import {
  EditClientIdentityDrawer,
  preferredLanguageLabel,
} from './edit-client-identity-drawer';
import { EditClientSensitiveDrawer } from './edit-client-sensitive-drawer';

/** En deçà de ce délai, la pièce d'identité est signalée comme bientôt expirée. */
const EXPIRY_WARNING_DAYS = 90;

function todayISODate(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

@Component({
  selector: 'client-identite',
  templateUrl: './identite.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasCard, TasIcon, TasTag, Button, SensitiveField],
})
export class ClientIdentityPage {
  protected readonly store = inject(ClientDetailStore);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _injector = inject(Injector);
  private readonly _permissions = inject(PermissionsService);

  private readonly _canUpdate = this._permissions.can('customers:update');
  private readonly _canUpdateSensitive = this._permissions.can(
    'customers:update_sensitive',
  );

  /**
   * `SensitiveField.field` est typé par l'énumération générée : une chaîne littérale dans le
   * template serait refusée par la vérification de types des templates.
   */
  protected readonly SENSITIVE = RevealSensitiveFieldRequestFieldEnum;

  protected readonly clientId = computed(() => this.store.clientId() ?? '');
  protected readonly isLegal = computed(() =>
    isLegalClient(this.store.client()?.clientType),
  );

  /** Une fiche archivée ou fusionnée ne propose aucune action de modification. */
  protected readonly canEdit = computed(
    () => this._canUpdate() && !this.store.isReadOnly(),
  );
  protected readonly canEditSensitive = computed(
    () => this._canUpdateSensitive() && !this.store.isReadOnly(),
  );

  protected readonly genderLabel = genderLabel;
  protected readonly maritalStatusLabel = maritalStatusLabel;
  protected readonly identityDocumentLabel = identityDocumentLabel;
  protected readonly preferredLanguageLabel = preferredLanguageLabel;

  /** Validité de la pièce déclarée, signalée à l'écran quand elle mérite une action. */
  protected readonly documentValidity = computed<{
    label: string;
    severity: Severity;
  } | null>(() => {
    const expiresOn = this.store.client()?.identityDocumentExpiresOn?.slice(0, 10);
    if (!expiresOn) return null;
    const today = todayISODate();
    if (expiresOn < today) return { label: 'Pièce expirée', severity: 'error' };
    const days = Math.round(
      (Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
        86_400_000,
    );
    return days <= EXPIRY_WARNING_DAYS
      ? { label: `Expire dans ${days} jours`, severity: 'warning' }
      : null;
  });

  /**
   * Les dates du contrat arrivent en `yyyy-MM-dd`. `DatePipe` les interprète en UTC et peut
   * afficher la veille selon le fuseau : le découpage de la chaîne ne décale rien.
   */
  protected formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const [year, month, day] = value.slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : value;
  }

  protected openIdentityDrawer(): void {
    const client = this.store.client();
    if (!client) return;

    const ref = this._sideDrawer.open(EditClientIdentityDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { client },
      // `ClientDetailStore` est fourni par la coquille de la fiche. Sans cet injecteur, le CDK
      // instancie le drawer depuis l'injecteur racine, où le store n'existe pas : le drawer ne
      // pourrait ni lire la version courante ni recharger la fiche après un conflit.
      injector: this._injector,
    });

    ref.closed.subscribe((saved) => {
      if (saved) this.store.reload().subscribe();
    });
  }

  protected openSensitiveDrawer(): void {
    const client = this.store.client();
    if (!client) return;

    const ref = this._sideDrawer.open(EditClientSensitiveDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { client },
      injector: this._injector,
    });

    ref.closed.subscribe((saved) => {
      if (saved) this.store.reload().subscribe();
    });
  }
}

export default ClientIdentityPage;
