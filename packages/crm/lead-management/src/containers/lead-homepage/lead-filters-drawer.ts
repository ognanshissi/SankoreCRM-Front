import { Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction } from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';
import { CustomFieldFilters } from '@sankore/crm/common';

/** Les filtres de la liste des leads, tels que la page les tient (chaîne vide = aucun filtre). */
export interface LeadFilters {
  status: string;
  intent: string;
  agent: string;
  agency: string;
  leadSource: string;
  queue: boolean;
  custom: string[];
  /** Grands comptes, lot 1 : particulier ou entreprise, secteur et tranche d'effectif. */
  prospectType: string;
  sector: string;
  size: string;
  /** Grands comptes, lot 4 : un `LeadPotentialTier`. */
  potential: string;
}

export interface LeadFiltersDrawerData {
  value: LeadFilters;
  statusOptions: { label: string; value: string }[];
  intentOptions: { label: string; value: string }[];
  agencyOptions: { label: string; value: string }[];
  sourceOptions: { label: string; value: string }[];
  /** Vide quand l'utilisateur ne voit que ses leads : filtrer par agent n'aurait rien à montrer. */
  agentOptions: { label: string; value: string }[];
  prospectTypeOptions: { label: string; value: string }[];
  sectorOptions: ReadonlyArray<{ label: string; value: string }>;
  sizeOptions: ReadonlyArray<{ label: string; value: string }>;
  potentialOptions: ReadonlyArray<{ label: string; value: string }>;
}

export const NO_LEAD_FILTERS: LeadFilters = {
  status: '', intent: '', agent: '', agency: '', leadSource: '', queue: false, custom: [],
  prospectType: '', sector: '', size: '', potential: '',
};

/**
 * Les filtres de la liste des leads dans un tiroir (maquette du 2026-11-03) : la page ne garde que
 * les puces des filtres posés. Rien ne part au serveur avant « Appliquer » — un tiroir qui
 * rechargeait la liste à chaque choix la faisait clignoter derrière lui.
 */
@Component({
  selector: 'lead-filters-drawer',
  imports: [
    FormsModule, Button, TasFormField, TasLabel, TasSelect, TasTitle,
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, CustomFieldFilters,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Filtrer les leads</tas-title>
      </tas-drawer-title>
      <tas-drawer-content>
        <div class="flex flex-col gap-4">
          <tas-form-field>
            <tas-label>Statut</tas-label>
            <tas-select clearable [options]="data.statusOptions" placeholder="Tous les statuts"
                        [ngModel]="value().status" (ngModelChange)="set('status', $event)"></tas-select>
          </tas-form-field>
          <tas-form-field>
            <tas-label>Intérêt</tas-label>
            <tas-select clearable [options]="data.intentOptions" placeholder="Toutes les températures"
                        [ngModel]="value().intent" (ngModelChange)="set('intent', $event)"></tas-select>
          </tas-form-field>
          @if (data.agentOptions.length) {
            <tas-form-field>
              <tas-label>Agent</tas-label>
              <tas-select clearable [options]="data.agentOptions" placeholder="Tous les agents"
                          [ngModel]="value().agent" (ngModelChange)="set('agent', $event)"></tas-select>
            </tas-form-field>
          }
          <tas-form-field>
            <tas-label>Agence</tas-label>
            <tas-select clearable [options]="data.agencyOptions" placeholder="Toutes les agences"
                        [ngModel]="value().agency" (ngModelChange)="set('agency', $event)"></tas-select>
          </tas-form-field>
          <tas-form-field>
            <tas-label>Source</tas-label>
            <tas-select clearable [options]="data.sourceOptions" placeholder="Toutes les sources"
                        [ngModel]="value().leadSource" (ngModelChange)="set('leadSource', $event)"></tas-select>
          </tas-form-field>

          <tas-form-field>
            <tas-label>Type de prospect</tas-label>
            <tas-select clearable [options]="data.prospectTypeOptions" placeholder="Particuliers et entreprises"
                        [ngModel]="value().prospectType" (ngModelChange)="set('prospectType', $event)"></tas-select>
          </tas-form-field>
          <tas-form-field>
            <tas-label>Secteur d'activité</tas-label>
            <tas-select clearable [options]="sectorOptions" placeholder="Tous les secteurs"
                        [ngModel]="value().sector" (ngModelChange)="set('sector', $event)"></tas-select>
          </tas-form-field>
          <tas-form-field>
            <tas-label>Effectif</tas-label>
            <tas-select clearable [options]="sizeOptions" placeholder="Toutes les tailles"
                        [ngModel]="value().size" (ngModelChange)="set('size', $event)"></tas-select>
          </tas-form-field>

          <tas-form-field>
            <tas-label>Potentiel</tas-label>
            <tas-select clearable [options]="potentialOptions" placeholder="Tous les leads"
                        [ngModel]="value().potential" (ngModelChange)="set('potential', $event)"></tas-select>
          </tas-form-field>

          <label class="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" class="form-checkbox accent-primary mt-0.5"
                   [checked]="value().queue" (change)="setQueue($any($event.target).checked)" />
            <span>
              En file d'attente
              <span class="block text-xs text-slate-500">Leads qu'aucun agent n'a pu prendre : ils partent seuls dès qu'un agent est disponible.</span>
            </span>
          </label>

          <!-- Les champs personnalisés à choix du tenant. -->
          <div class="grid grid-cols-1 gap-4">
            <custom-field-filters entity="Lead" [value]="value().custom" (valueChange)="setCustom($event)" />
          </div>
        </div>
      </tas-drawer-content>
      <tas-drawer-action>
        <div class="flex w-full items-center justify-between gap-2">
          <button tas-text-button type="button" [disabled]="!count()" (click)="reset()">Réinitialiser</button>
          <div class="flex gap-2">
            <button tas-outlined-button type="button" (click)="close()">Annuler</button>
            <button tas-raised-button color="primary" type="button" (click)="apply()">
              Appliquer{{ count() ? ' (' + count() + ')' : '' }}
            </button>
          </div>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class LeadFiltersDrawer {
  public readonly data = inject<LeadFiltersDrawerData>(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<LeadFilters | null>);

  public readonly value = signal<LeadFilters>({ ...this.data.value, custom: [...this.data.value.custom] });
  public readonly sectorOptions = [...this.data.sectorOptions];
  public readonly sizeOptions = [...this.data.sizeOptions];
  public readonly potentialOptions = [...this.data.potentialOptions];

  /** Le nombre de filtres posés, pour le bouton : un champ personnalisé compte pour un. */
  public readonly count = computed(() => {
    const v = this.value();
    return [v.status, v.intent, v.agent, v.agency, v.leadSource, v.prospectType, v.sector, v.size, v.potential].filter(Boolean).length
      + (v.queue ? 1 : 0) + v.custom.length;
  });

  // La croix d'un `tas-select` notifie `null` : ramené à la chaîne vide, « aucun filtre » pour la page.
  public set(
    key: 'status' | 'intent' | 'agent' | 'agency' | 'leadSource' | 'prospectType' | 'sector' | 'size' | 'potential',
    next: string | null,
  ): void {
    this.value.update((v) => ({ ...v, [key]: next ?? '' }));
  }

  public setQueue(checked: boolean): void {
    this.value.update((v) => ({ ...v, queue: checked }));
  }

  public setCustom(custom: string[]): void {
    this.value.update((v) => ({ ...v, custom }));
  }

  public reset(): void {
    this.value.set({ ...NO_LEAD_FILTERS, custom: [] });
  }

  public apply(): void {
    this._dialogRef.close(this.value());
  }

  public close(): void {
    this._dialogRef.close(null);
  }
}
