import { CommonModule } from "@angular/common";
import { Component, inject } from "@angular/core";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { PageLoadingService } from "../..";
import { TasSpinner } from '@talisoft/ui/spinner';

@Component({
    selector: "page-loader",
    template: `
    @if (_loaderService.isLoading()) {
        <div class="flex items-center justify-content h-full w-full top-0 left-0 z-10 bg-black/50">
            <div>
                <tas-spinner></tas-spinner>
                <p>Chargement en cours...</p>
            </div>
        </div>
    }
    `,
    imports: [CommonModule, MatProgressBarModule, TasSpinner],
})
export class PageLoadingComponent {
    public readonly _loaderService = inject(PageLoadingService);
}
