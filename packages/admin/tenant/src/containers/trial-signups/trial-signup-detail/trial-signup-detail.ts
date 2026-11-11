import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, EMPTY, finalize } from 'rxjs';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TenantSignupDetail, TenantSignupsApiService, TenantSignupSummary } from '@sankore/crm-admin-api';
import { countryLabel, describeTrialError, trialStatusStyle } from '../trial-signup-referential';
import { RejectTrialSignupData, RejectTrialSignupDrawer } from './reject-trial-signup-drawer';

/**
 * Une demande d'essai, de quoi la juger, et la décision. « Approuver » crée l'institution (socle
 * seul, données de démarrage, essai de 30 jours) ; le demandeur reçoit « Votre CRM est prêt » dès
 * que son compte existe. Les demandes venues de la même adresse IP ou du même domaine d'e-mail sont
 * là pour repérer un doublon ou un abus avant de décider.
 */
@Component({
  templateUrl: './trial-signup-detail.html',
  imports: [DatePipe, NgTemplateOutlet, RouterLink, Anchor, Button, TasIcon, TasSpinner, TasTable],
})
export class TrialSignupDetailPage implements OnInit {
  private readonly _api = inject(TenantSignupsApiService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public detail = signal<TenantSignupDetail | null>(null);
  public isLoading = signal(true);
  public loadError = signal<string | null>(null);
  public isApproving = signal(false);

  public readonly signup = computed(() => this.detail()?.signup ?? null);
  public readonly status = computed(() => trialStatusStyle(this.signup()?.status));
  /** « par Untel », collé à la date : un bloc @if laissait une espace avant le point. */
  public readonly decidedBy = computed(() => {
    const name = this.detail()?.decidedByAdminName;
    return name ? ` par ${name}` : '';
  });
  public readonly country = computed(() => countryLabel(this.signup()?.country));
  public readonly canApprove = computed(() => this.signup()?.status === 'Confirmed');
  public readonly canReject = computed(() => ['Confirmed', 'PendingEmail', 'Expired'].includes(this.signup()?.status ?? ''));

  /** Pagination locale : le registre renvoie au plus 10 demandes liées par critère. */
  public readonly relatedConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10] },
  });

  public readonly sameIp = computed(() => this._related(this.detail()?.sameIp));
  public readonly sameDomain = computed(() => this._related(this.detail()?.sameEmailDomain));

  private _id = '';

  public ngOnInit(): void {
    this._route.paramMap.subscribe((params) => {
      this._id = params.get('signupId') ?? '';
      this.load();
    });
  }

  public load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this._api
      .getTenantSignup(this._id)
      .pipe(
        catchError((err) => {
          this.loadError.set(describeTrialError(err, 'La demande n’a pas pu être chargée.'));
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((detail) => this.detail.set(detail));
  }

  public open(id: string): void {
    this._router.navigate(['/essais', id]);
  }

  public confirmApprove(): void {
    const s = this.signup();
    if (!s) return;
    this._confirm.confirm({
      title: 'Approuver cette demande ?',
      message:
        `L’institution « ${s.institutionName} » sera créée à l’adresse ${s.fqdn ?? s.slug}, en socle seul, ` +
        `avec ses données de démarrage et 30 jours d’essai. ${s.firstName} recevra « Votre CRM est prêt » ` +
        `et un lien pour choisir son mot de passe d’ici une à deux minutes.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Approuver', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._approve(),
    });
  }

  public openReject(): void {
    const s = this.signup();
    if (!s) return;
    const ref = this._drawer.open<boolean, RejectTrialSignupData, RejectTrialSignupDrawer>(RejectTrialSignupDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { signupId: s.id ?? '', institutionName: s.institutionName ?? '' },
    });
    ref.closed.subscribe((rejected) => {
      if (!rejected) return;
      this._snackbar.success('Demande refusée', 'Le demandeur reçoit le motif par e-mail.');
      this.load();
    });
  }

  private _approve(): void {
    this.isApproving.set(true);
    this._api
      .approveTenantSignup(this._id)
      .pipe(
        catchError((err) => {
          this._snackbar.error('Approbation impossible', describeTrialError(err, 'La demande n’a pas été approuvée.'));
          this.load();
          return EMPTY;
        }),
        finalize(() => this.isApproving.set(false)),
      )
      .subscribe((approved) => {
        this._snackbar.success('Institution créée', `${approved.fqdn} — les données de démarrage se chargent.`);
        this.load();
      });
  }

  private _related(items: TenantSignupSummary[] | null | undefined) {
    return (items ?? []).map((s) => ({
      id: s.id ?? '',
      institution: s.institutionName ?? '—',
      email: s.email ?? '',
      createdAt: s.createdAt ?? null,
      ...trialStatusStyle(s.status),
    }));
  }
}

export default TrialSignupDetailPage;
