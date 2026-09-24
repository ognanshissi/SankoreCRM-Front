import { inject, Injectable, signal } from '@angular/core';
import { LeadSourcesApiService, SourceMetadataResponse } from '@sankore/crm-api';
import { catchError, of, tap } from 'rxjs';
import { buildChannelOptions, buildModeOptions, buildStatusOptions } from './lead-source.types';

/**
 * FE-01 — Cache des metadonnees de sources (canaux, modes, combinaisons autorisees).
 * Charge une seule fois depuis GET /api/leads/sources/metadata et met en cache.
 */
@Injectable({ providedIn: 'root' })
export class LeadSourceMetadataService {
  private readonly _api = inject(LeadSourcesApiService);

  private _loaded = false;

  public readonly metadata = signal<SourceMetadataResponse | null>(null);
  public readonly channelOptions = signal<{ label: string; value: string }[]>([]);
  public readonly modeOptions = signal<{ label: string; value: string }[]>([]);
  public readonly statusOptions = signal<{ label: string; value: string }[]>(buildStatusOptions());

  public load(): void {
    if (this._loaded) return;
    this._loaded = true;

    this._api.getLeadSourceMetadata().pipe(
      tap((res) => {
        this.metadata.set(res);
        this.channelOptions.set(buildChannelOptions(res));
        this.modeOptions.set(buildModeOptions(res));
      }),
      catchError(() => of(null)),
    ).subscribe();
  }

  /** Returns the allowed modes for a given channel code */
  public allowedModes(channelCode: string): string[] {
    const ch = (this.metadata()?.channels ?? []).find((c) => c.code === channelCode);
    return ch?.allowedModes ?? [];
  }
}
