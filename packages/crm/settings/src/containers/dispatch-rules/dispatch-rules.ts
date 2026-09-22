import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasSwitch } from '@talisoft/ui/switch';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  DispatchingRulesApiService,
  DispatchingRuleDto,
} from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { strategySeverity, strategyLabel } from './dispatch-rules.shared';

@Component({
  selector: 'dispatch-rules-config',
  imports: [TasCard, TasSpinner, TasIcon, TasTag, Button, TasSwitch],
  templateUrl: 'dispatch-rules.html',
})
export class DispatchRulesConfig implements OnInit {
  private readonly _dispatchApi = inject(DispatchingRulesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _router = inject(Router);

  public readonly strategySeverity = strategySeverity;
  public readonly strategyLabel = strategyLabel;

  public isLoading = signal(true);
  public rules = signal<DispatchingRuleDto[]>([]);
  public togglingRuleId = signal<string | null>(null);

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Stratégies d\'affectation' },
    ]);
    this._loadRules();
  }

  public toggleRuleActive(rule: DispatchingRuleDto, active: boolean): void {
    this.togglingRuleId.set(rule.id ?? null);
    const obs = active
      ? this._dispatchApi.activateDispatchingRule(rule.id!)
      : this._dispatchApi.deactivateDispatchingRule(rule.id!);

    obs.pipe(
      catchError(() => {
        this._snackbar.error('Erreur', `Impossible de ${active ? 'activer' : 'désactiver'} la règle.`);
        return EMPTY;
      }),
    ).subscribe({
      next: () => {
        this.rules.update((list) =>
          list.map((r) => (r.id === rule.id ? { ...r, isActive: active } : r)),
        );
        this._snackbar.success('Succès', `Règle ${active ? 'activée' : 'désactivée'}.`);
      },
      complete: () => this.togglingRuleId.set(null),
    });
  }

  public deleteRule(rule: DispatchingRuleDto): void {
    this._confirmDialog.confirm({
      title: 'Supprimer cette règle ?',
      message: `La règle « ${rule.name} » sera supprimée définitivement.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Supprimer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this._dispatchApi.deactivateDispatchingRule(rule.id!).pipe(
          catchError(() => {
            this._snackbar.error('Erreur', 'Impossible de supprimer la règle.');
            return EMPTY;
          }),
        ).subscribe(() => {
          this.rules.update((list) => list.filter((r) => r.id !== rule.id));
          this._snackbar.success('Succès', 'Règle supprimée.');
        });
      },
    });
  }

  public navigateToCreate(): void {
    this._router.navigate(['/settings/dispatch-rules/create']);
  }

  public startEdit(rule: DispatchingRuleDto): void {
    this._router.navigate(['/settings/dispatch-rules', rule.id, 'edit']);
  }

  private _loadRules(): void {
    this.isLoading.set(true);
    this._dispatchApi.listDispatchingRules().pipe(
      catchError(() => {
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((rules) => {
      this.rules.set(rules ?? []);
      this.isLoading.set(false);
    });
  }
}

export default DispatchRulesConfig;
