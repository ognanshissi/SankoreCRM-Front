import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';

/** Une image chargée depuis Internet : souvent un pixel qui dit à l'expéditeur que le message a été ouvert. */
const REMOTE_IMAGE = /<img\b[^>]*\bsrc\s*=\s*["']?\s*https?:/i;

/**
 * Le corps d'un e-mail (messagerie connectée, lot 5). Le HTML arrive tel que l'expéditeur l'a
 * écrit — le serveur ne le nettoie pas — et s'affiche donc dans un cadre ISOLÉ :
 *
 * - `sandbox` sans `allow-scripts` : aucun script ne s'exécute, ni formulaire ; `allow-same-origin`
 *   seul ne donne rien au contenu (sans script, il ne peut pas s'en servir) et permet à la page de
 *   mesurer sa hauteur ;
 * - une CSP dans le document : rien n'est chargé du réseau, sauf les images une fois que l'agent
 *   l'a demandé — un pixel de suivi ne part pas à l'ouverture ;
 * - `<base target="_blank">` + `allow-popups-to-escape-sandbox` : un lien s'ouvre dans un onglet,
 *   jamais dans le cadre.
 */
@Component({
  selector: 'mail-body',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, TasIcon],
  template: `
    @if (isHtml()) {
      @if (hasRemoteImages() && !showImages()) {
        <div class="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
          <tas-icon iconName="feather:image" iconClass="!size-3"></tas-icon>
          Images distantes masquées pour protéger votre vie privée.
          <button tas-text-button color="primary" type="button" (click)="showImages.set(true)">Afficher les images</button>
        </div>
      }
      <iframe
        #frame
        class="block w-full border-0"
        title="Contenu de l'e-mail"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerpolicy="no-referrer"
        [style.height.px]="height()"
        [srcdoc]="document()"
        (load)="measure()"
      ></iframe>
    } @else {
      <pre class="whitespace-pre-wrap break-words font-sans text-sm text-slate-800">{{ body() }}</pre>
    }
  `,
})
export class MailBody {
  private readonly _sanitizer = inject(DomSanitizer);
  private readonly _frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');
  private _observer: ResizeObserver | null = null;

  public readonly body = input<string | null | undefined>('');
  public readonly isHtml = input(false);

  public readonly showImages = signal(false);
  public readonly height = signal(80);

  public readonly hasRemoteImages = computed(() => REMOTE_IMAGE.test(this.body() ?? ''));

  /** Contourner la protection d'Angular est sûr ICI parce que le cadre n'exécute rien : voir la classe. */
  public readonly document = computed<SafeHtml>(() => {
    const images = this.showImages() ? 'data: cid: https: http:' : 'data: cid:';
    const head =
      `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${images}; font-src data:">` +
      '<base target="_blank">' +
      '<style>html{overflow:hidden}body{margin:0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1e293b;overflow-wrap:anywhere}img{max-width:100%;height:auto}blockquote{margin:0 0 0 .5rem;padding-left:.75rem;border-left:2px solid #cbd5e1;color:#475569}</style>';
    return this._sanitizer.bypassSecurityTrustHtml(`<!doctype html><html><head>${head}</head><body>${this.body() ?? ''}</body></html>`);
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this._observer?.disconnect());
  }

  /**
   * La hauteur suit le contenu — y compris quand une image arrive après coup. Le cadre ne défile
   * jamais lui-même (`overflow:hidden`) : c'est la page qui défile, une seule barre.
   */
  public measure(): void {
    const frame = this._frame()?.nativeElement;
    const doc = frame?.contentDocument;
    if (!frame || !doc?.body) return;

    const fit = () => this.height.set(Math.max(40, Math.ceil(doc.documentElement.scrollHeight)));
    fit();

    // Les écouteurs sont ceux de la page, pas du cadre : aucun script ne s'exécute dedans.
    for (const img of Array.from(doc.images)) {
      img.addEventListener('load', fit);
      img.addEventListener('error', fit);
    }

    this._observer?.disconnect();
    this._observer = new ResizeObserver(fit);
    this._observer.observe(frame);
  }
}
