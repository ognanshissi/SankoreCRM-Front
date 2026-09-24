import { Component, inject, input, signal } from '@angular/core';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { DryRunResult } from '@sankore/crm-api';
import { LeadSourcesService } from './lead-sources.service';

/**
 * FE-20 — Tester l'appel au fournisseur (exécution à blanc)
 */
@Component({
  selector: 'pull-dry-run',
  standalone: true,
  imports: [TasCard, TasSpinner, TasIcon, TasTag, Button],
  template: `
    <div class="max-w-4xl flex flex-col gap-4">
      <!-- Launch -->
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-semibold text-slate-700">Test de l'API (exécution à blanc)</h2>
          <p class="text-xs text-slate-400 mt-0.5">
            Appelle l'API du fournisseur sans créer de leads. Permet de valider la configuration.
          </p>
        </div>
        <button tas-raised-button color="primary" type="button"
                [disabled]="isRunning()"
                [isLoading]="isRunning()"
                (click)="runTest()">
          <tas-icon iconName="feather:play" style="font-size:14px"></tas-icon>
          Tester
        </button>
      </div>

      @if (isRunning()) {
        <div class="flex items-center gap-3 p-4 bg-blue-50 rounded-lg">
          <tas-spinner size="5" class="text-primary"></tas-spinner>
          <div>
            <p class="text-sm font-medium text-blue-700">Test en cours…</p>
            <p class="text-xs text-blue-500">Délai maximal : 30 secondes.</p>
          </div>
        </div>
      }

      <!-- Error -->
      @if (error()) {
        <div class="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p class="text-sm font-medium text-red-800 flex items-center gap-2">
            <tas-icon iconName="feather:x-circle" class="text-red-500" style="font-size:14px"></tas-icon>
            Échec du test
          </p>
          <p class="text-xs text-red-600 mt-1">{{ error() }}</p>
        </div>
      }

      <!-- Result -->
      @if (result()) {
        <div class="grid grid-cols-3 gap-4">
          <!-- Request -->
          <tas-card class="block col-span-3 lg:col-span-1">
            <div class="p-3 border-b border-slate-100">
              <p class="text-xs font-semibold text-slate-600">Requête envoyée</p>
            </div>
            <div class="p-3 space-y-2">
              <div>
                <p class="text-[10px] text-slate-400">URL</p>
                <p class="text-xs text-slate-700 font-mono break-all">{{ result()!.request?.url ?? '—' }}</p>
              </div>
              <div>
                <p class="text-[10px] text-slate-400">Méthode</p>
                <p class="text-xs text-slate-700">{{ result()!.request?.method ?? '—' }}</p>
              </div>
              <div>
                <p class="text-[10px] text-slate-400">Authentification</p>
                <p class="text-xs text-slate-700">{{ result()!.request?.authType ?? '—' }}</p>
              </div>
              <p class="text-[10px] text-slate-400 italic">Les secrets sont masqués.</p>
            </div>
          </tas-card>

          <!-- Response -->
          <tas-card class="block col-span-3 lg:col-span-2">
            <div class="p-3 border-b border-slate-100 flex items-center justify-between">
              <p class="text-xs font-semibold text-slate-600">Réponse brute</p>
              @if (responseExpanded()) {
                <button tas-outlined-button type="button" class="text-[10px]" (click)="responseExpanded.set(false)">Réduire</button>
              } @else {
                <button tas-outlined-button type="button" class="text-[10px]" (click)="responseExpanded.set(true)">Déplier</button>
              }
            </div>
            <div class="p-3">
              <pre class="bg-slate-900 text-green-400 text-[10px] p-3 rounded-lg overflow-auto font-mono"
                   [class.max-h-40]="!responseExpanded()"
                   [class.max-h-96]="responseExpanded()">{{ result()!.rawResponseTruncated ?? 'Vide' }}</pre>
            </div>
          </tas-card>
        </div>

        <!-- Simulated leads -->
        <tas-card class="block">
          <div class="p-3 border-b border-slate-100 flex items-center justify-between">
            <p class="text-xs font-semibold text-slate-600">
              Leads qui seraient créés
              <tas-tag severity="info" class="ml-1">{{ result()!.simulatedLeads?.length ?? 0 }}</tas-tag>
            </p>
            <div class="flex items-center gap-3 text-xs text-slate-400">
              <span>Total récupéré : {{ result()!.totalFetched ?? 0 }}</span>
              @if ((result()!.mappingErrors ?? 0) > 0) {
                <tas-tag severity="error">{{ result()!.mappingErrors }} erreur(s) mapping</tas-tag>
              }
            </div>
          </div>
          <div class="divide-y divide-slate-100">
            @for (lead of result()!.simulatedLeads ?? []; track $index) {
              <div class="px-3 py-2 flex items-center gap-3">
                <tas-icon iconName="feather:user" class="text-slate-400" style="font-size:12px"></tas-icon>
                <div class="flex-1 min-w-0 grid grid-cols-4 gap-2 text-xs">
                  <span class="truncate text-slate-700 font-medium">{{ lead.fullName ?? '—' }}</span>
                  <span class="truncate text-slate-500">{{ lead.phoneNumber ?? '—' }}</span>
                  <span class="truncate text-slate-500">{{ lead.email ?? '—' }}</span>
                  <span class="truncate text-slate-400 font-mono">{{ lead.externalId ?? '—' }}</span>
                </div>
                @if (lead.error) {
                  <tas-tag severity="error" class="shrink-0">{{ lead.error }}</tas-tag>
                }
              </div>
            }
            @if ((result()!.simulatedLeads?.length ?? 0) === 0) {
              <div class="p-4 text-center text-xs text-slate-400">Aucun lead extrait.</div>
            }
          </div>
        </tas-card>
      }
    </div>
  `,
})
export class PullDryRun {
  private readonly _sourcesService = inject(LeadSourcesService);

  public readonly sourceId = input.required<string>();

  public isRunning = signal(false);
  public result = signal<DryRunResult | null>(null);
  public error = signal<string | null>(null);
  public responseExpanded = signal(false);

  public runTest(): void {
    this.isRunning.set(true);
    this.result.set(null);
    this.error.set(null);

    this._sourcesService.dryRun(this.sourceId()).pipe(
      catchError((err) => {
        this.error.set(
          err?.error?.detail ?? err?.message ?? 'Erreur inattendue lors du test.',
        );
        this.isRunning.set(false);
        return EMPTY;
      }),
    ).subscribe((res) => {
      this.result.set(res);
      this.isRunning.set(false);
    });
  }
}

export default PullDryRun;
