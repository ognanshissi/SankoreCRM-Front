import { ChangeDetectionStrategy, Component, input, model, signal, ViewEncapsulation } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { form, FormField, FormValueControl, required, submit, validate } from '@angular/forms/signals';
import { QuillModule } from 'ngx-quill';
import type Quill from 'quill';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';

class LinkFormModel {
  public text = '';
  public url = '';
}

/** Une adresse de lien : https par défaut, `mailto:` et `tel:` gardés tels quels. */
function normalizeUrl(value: string): string {
  const url = value.trim();
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url)) return `mailto:${url}`;
  return `https://${url}`;
}

/**
 * L'éditeur d'un e-mail (réponse rapide, tiroir de rédaction, signature) : la barre de mise en
 * forme de Gmail — annuler / rétablir, police, taille, gras, italique, souligné, couleurs,
 * alignement, listes, retrait, citation, barré, effacer la mise en forme —, sous le texte comme
 * chez Gmail, masquable (« Aa »). Les liens et les émojis s'insèrent depuis la barre d'actions du
 * parent, par `openLink()` et `insertText()`.
 *
 * Contrôle de formulaire signal (`[formField]`) : sa valeur est le HTML de l'éditeur. La mise en
 * forme est faite de classes Quill ; `toEmailHtml` les écrit en style au moment d'envoyer.
 */
@Component({
  selector: 'mail-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Quill construit son éditeur hors du gabarit : des styles encapsulés ne l'atteindraient pas.
  encapsulation: ViewEncapsulation.None,
  imports: [FormsModule, QuillModule, FormField, Button, TasIcon],
  host: { class: 'mail-editor block' },
  template: `
    <quill-editor
      class="mail-editor__quill"
      [ngModel]="value()"
      (ngModelChange)="value.set($event ?? '')"
      [modules]="modules"
      theme="snow"
      customToolbarPosition="bottom"
      [placeholder]="placeholder()"
      (onEditorCreated)="created($event)"
    >
      <div quill-editor-toolbar class="mail-editor__toolbar" [class.mail-editor__toolbar--hidden]="!toolbar()" role="toolbar" aria-label="Mise en forme">
        <span class="ql-formats">
          <button type="button" class="mail-editor__history" title="Annuler (Ctrl+Z)" aria-label="Annuler" (click)="undo()">
            <tas-icon iconName="feather:corner-up-left" iconClass="!size-4"></tas-icon>
          </button>
          <button type="button" class="mail-editor__history" title="Rétablir (Ctrl+Y)" aria-label="Rétablir" (click)="redo()">
            <tas-icon iconName="feather:corner-up-right" iconClass="!size-4"></tas-icon>
          </button>
        </span>
        <span class="ql-formats">
          <select class="ql-font" aria-label="Police">
            <option selected></option>
            <option value="serif"></option>
            <option value="monospace"></option>
          </select>
          <select class="ql-size" aria-label="Taille du texte">
            <option value="small"></option>
            <option selected></option>
            <option value="large"></option>
            <option value="huge"></option>
          </select>
        </span>
        <span class="ql-formats">
          <button type="button" class="ql-bold" title="Gras (Ctrl+B)" aria-label="Gras"></button>
          <button type="button" class="ql-italic" title="Italique (Ctrl+I)" aria-label="Italique"></button>
          <button type="button" class="ql-underline" title="Souligné (Ctrl+U)" aria-label="Souligné"></button>
          <select class="ql-color" aria-label="Couleur du texte"></select>
          <select class="ql-background" aria-label="Couleur de fond"></select>
        </span>
        <span class="ql-formats">
          <select class="ql-align" aria-label="Aligner"></select>
          <button type="button" class="ql-list" value="ordered" title="Liste numérotée" aria-label="Liste numérotée"></button>
          <button type="button" class="ql-list" value="bullet" title="Liste à puces" aria-label="Liste à puces"></button>
          <button type="button" class="ql-indent" value="-1" title="Diminuer le retrait" aria-label="Diminuer le retrait"></button>
          <button type="button" class="ql-indent" value="+1" title="Augmenter le retrait" aria-label="Augmenter le retrait"></button>
          <button type="button" class="ql-blockquote" title="Citation" aria-label="Citation"></button>
        </span>
        <span class="ql-formats">
          <button type="button" class="ql-strike" title="Barré" aria-label="Barré"></button>
          <button type="button" class="ql-clean" title="Supprimer la mise en forme" aria-label="Supprimer la mise en forme"></button>
        </span>
      </div>
    </quill-editor>

    @if (linkOpen()) {
      <div class="mx-2 mb-2 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5" role="group" aria-label="Insérer un lien">
        <label class="flex min-w-36 flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
          Texte affiché
          <input type="text" class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-primary"
                 [formField]="linkForm.text" placeholder="Notre site" />
        </label>
        <label class="flex min-w-48 flex-[2] flex-col gap-1 text-xs font-medium text-slate-600">
          Adresse
          <input type="text" class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-primary"
                 [formField]="linkForm.url" placeholder="https://… ou adresse@exemple.com" (keydown.enter)="$event.preventDefault(); insertLink()" />
        </label>
        <div class="flex gap-1">
          <button tas-text-button type="button" (click)="linkOpen.set(false)">Annuler</button>
          <button tas-raised-button color="primary" type="button" [disabled]="linkForm().invalid()" (click)="insertLink()">Insérer</button>
        </div>
        @if (linkForm.url().touched() && linkForm.url().invalid()) {
          <p class="w-full text-xs text-functional-error">{{ linkForm.url().errors()[0].message }}</p>
        }
      </div>
    }
  `,
  styles: [
    `
      quill-editor.mail-editor__quill { display: flex; flex-direction: column; width: 100%; }
      .mail-editor .ql-container.ql-snow { border: 0; font-family: inherit; font-size: 0.875rem; }
      .mail-editor .ql-editor { min-height: var(--mail-editor-min, 5.5rem); max-height: var(--mail-editor-max, 14rem); overflow-y: auto; padding: 0.75rem; line-height: 1.6; }
      .mail-editor .ql-editor.ql-blank::before { left: 0.75rem; right: 0.75rem; font-style: normal; color: rgb(148 163 184); }
      .mail-editor .ql-editor blockquote { border-left: 2px solid rgb(203 213 225); color: rgb(71 85 105); }

      /* La barre de Gmail, grise sous le texte ; arrondie et non en pastille : elle passe sur deux lignes quand c'est étroit. */
      .mail-editor .mail-editor__toolbar.ql-toolbar.ql-snow {
        display: flex; flex-wrap: wrap; align-items: center; gap: 0.125rem;
        margin: 0 0.5rem 0.5rem; padding: 0.25rem 0.5rem; border: 0; border-radius: 1rem; background: rgb(241 245 249);
      }
      .mail-editor .mail-editor__toolbar--hidden.ql-toolbar.ql-snow { display: none; }
      .mail-editor .ql-toolbar.ql-snow .ql-formats { display: inline-flex; align-items: center; margin-right: 0; padding: 0 0.125rem; }
      .mail-editor .ql-toolbar.ql-snow button { width: 26px; padding: 3px 4px; }
      .mail-editor .ql-snow .ql-picker-label { white-space: nowrap; overflow: hidden; }
      .mail-editor .ql-toolbar.ql-snow .ql-formats + .ql-formats { border-left: 1px solid rgb(203 213 225); }
      .mail-editor .ql-toolbar.ql-snow button.mail-editor__history { display: inline-grid; place-items: center; color: rgb(68 68 68); }
      .mail-editor .ql-toolbar.ql-snow button.mail-editor__history:hover { color: #06c; }

      /* Les libellés des listes déroulantes, en français — ceux de Gmail. */
      .mail-editor .ql-snow .ql-picker.ql-font { width: 7.75rem; }
      .mail-editor .ql-snow .ql-picker.ql-font .ql-picker-label::before,
      .mail-editor .ql-snow .ql-picker.ql-font .ql-picker-item::before { content: 'Sans Serif'; }
      .mail-editor .ql-snow .ql-picker.ql-font .ql-picker-label[data-value='serif']::before,
      .mail-editor .ql-snow .ql-picker.ql-font .ql-picker-item[data-value='serif']::before { content: 'Serif'; }
      .mail-editor .ql-snow .ql-picker.ql-font .ql-picker-label[data-value='monospace']::before,
      .mail-editor .ql-snow .ql-picker.ql-font .ql-picker-item[data-value='monospace']::before { content: 'Largeur fixe'; }
      .mail-editor .ql-snow .ql-picker.ql-size { width: 5.75rem; }
      .mail-editor .ql-snow .ql-picker.ql-size .ql-picker-label::before,
      .mail-editor .ql-snow .ql-picker.ql-size .ql-picker-item::before { content: 'Normal'; }
      .mail-editor .ql-snow .ql-picker.ql-size .ql-picker-label[data-value='small']::before,
      .mail-editor .ql-snow .ql-picker.ql-size .ql-picker-item[data-value='small']::before { content: 'Petit'; }
      .mail-editor .ql-snow .ql-picker.ql-size .ql-picker-label[data-value='large']::before,
      .mail-editor .ql-snow .ql-picker.ql-size .ql-picker-item[data-value='large']::before { content: 'Grand'; }
      .mail-editor .ql-snow .ql-picker.ql-size .ql-picker-label[data-value='huge']::before,
      .mail-editor .ql-snow .ql-picker.ql-size .ql-picker-item[data-value='huge']::before { content: 'Très grand'; }

      /*
        Les listes déroulantes : le libellé ne passe jamais sous la flèche (Quill ne lui laisse que
        2 px), et les tailles de la liste restent un aperçu — Quill montre « Très grand » à 32 px, qui
        débordait du menu.
      */
      .mail-editor .ql-snow .ql-picker { height: 26px; font-size: 13px; }
      .mail-editor .ql-snow .ql-picker-label { display: flex; align-items: center; padding: 0 20px 0 8px; border-radius: 6px; }
      .mail-editor .ql-snow .ql-picker-label::before { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 26px; }
      .mail-editor .ql-snow .ql-picker-label svg { right: 2px; }
      .mail-editor .ql-snow .ql-picker-label:hover { background: rgb(226 232 240); }
      .mail-editor .ql-snow .ql-picker.ql-expanded .ql-picker-label { border-color: transparent; background: white; }
      .mail-editor .ql-snow .ql-picker.ql-color-picker .ql-picker-label,
      .mail-editor .ql-snow .ql-picker.ql-icon-picker .ql-picker-label { padding: 2px 4px; }
      .mail-editor .ql-snow .ql-picker-options {
        padding: 4px; border: 1px solid rgb(226 232 240) !important; border-radius: 10px; background: white;
        box-shadow: 0 10px 25px -5px rgb(15 23 42 / 0.15);
      }
      .mail-editor .ql-snow .ql-picker.ql-font .ql-picker-options,
      .mail-editor .ql-snow .ql-picker.ql-size .ql-picker-options { width: 9.5rem; max-width: none; } /* un max-width: 100% global le bornait à la largeur du champ */

      /* Les états actifs aux couleurs du CRM, pas au bleu et au gris de Quill. */
      .mail-editor .ql-snow.ql-toolbar button:hover, .mail-editor .ql-snow.ql-toolbar button.ql-active,
      .mail-editor .ql-snow.ql-toolbar .ql-picker-label:hover, .mail-editor .ql-snow.ql-toolbar .ql-picker-label.ql-active,
      .mail-editor .ql-snow.ql-toolbar .ql-picker.ql-expanded .ql-picker-label { color: rgb(var(--tas-color-primary)); }
      .mail-editor .ql-snow.ql-toolbar button:hover .ql-stroke, .mail-editor .ql-snow.ql-toolbar button.ql-active .ql-stroke,
      .mail-editor .ql-snow.ql-toolbar .ql-picker-label:hover .ql-stroke, .mail-editor .ql-snow.ql-toolbar .ql-picker-label.ql-active .ql-stroke,
      .mail-editor .ql-snow.ql-toolbar .ql-picker.ql-expanded .ql-picker-label .ql-stroke,
      .mail-editor .ql-snow.ql-toolbar .ql-picker-item:hover .ql-stroke, .mail-editor .ql-snow.ql-toolbar .ql-picker-item.ql-selected .ql-stroke { stroke: rgb(var(--tas-color-primary)); }
      .mail-editor .ql-snow.ql-toolbar button:hover .ql-fill, .mail-editor .ql-snow.ql-toolbar button.ql-active .ql-fill,
      .mail-editor .ql-snow.ql-toolbar .ql-picker-label:hover .ql-fill, .mail-editor .ql-snow.ql-toolbar .ql-picker-label.ql-active .ql-fill,
      .mail-editor .ql-snow.ql-toolbar .ql-picker.ql-expanded .ql-picker-label .ql-fill,
      .mail-editor .ql-snow.ql-toolbar .ql-picker-item:hover .ql-fill, .mail-editor .ql-snow.ql-toolbar .ql-picker-item.ql-selected .ql-fill { fill: rgb(var(--tas-color-primary)); }
      .mail-editor .ql-snow.ql-toolbar button.ql-active { background: rgb(var(--tas-color-primary) / 0.1); border-radius: 6px; }
      .mail-editor .ql-snow .ql-picker.ql-font .ql-picker-item,
      .mail-editor .ql-snow .ql-picker.ql-size .ql-picker-item { padding: 5px 10px; border-radius: 6px; line-height: 1.25; white-space: nowrap; }
      .mail-editor .ql-snow .ql-picker.ql-font .ql-picker-item:hover,
      .mail-editor .ql-snow .ql-picker.ql-size .ql-picker-item:hover { background: rgb(241 245 249); color: inherit; }
      .mail-editor .ql-snow .ql-picker .ql-picker-item.ql-selected { color: rgb(var(--tas-color-primary)); font-weight: 600; }
      .mail-editor .ql-snow .ql-picker.ql-size .ql-picker-item[data-value='small']::before { font-size: 11px; }
      .mail-editor .ql-snow .ql-picker.ql-size .ql-picker-item::before { font-size: 13px; }
      .mail-editor .ql-snow .ql-picker.ql-size .ql-picker-item[data-value='large']::before { font-size: 17px; }
      .mail-editor .ql-snow .ql-picker.ql-size .ql-picker-item[data-value='huge']::before { font-size: 21px; }

      /*
        Étroit (tiroir, signature), la barre passe sur deux lignes : un séparateur en début de ligne
        traînait seul. Sous 640 px de large, les groupes sont séparés par l'espace, plus par un trait.
      */
      .mail-editor { container-type: inline-size; }
      @container (max-width: 640px) {
        .mail-editor .ql-toolbar.ql-snow .ql-formats + .ql-formats { border-left: 0; padding-left: 0.375rem; }
      }

      /* Sous le texte, les listes s'ouvrent vers le haut pour ne pas sortir du cadre. */
      .mail-editor .ql-snow .ql-picker.ql-expanded .ql-picker-options { top: auto; bottom: 100%; margin-bottom: 0.25rem; }

      /* La bulle d'un lien cliqué dans le texte, en français. */
      .mail-editor .ql-snow .ql-tooltip::before { content: 'Lien :'; }
      .mail-editor .ql-snow .ql-tooltip a.ql-action::after { content: 'Modifier'; }
      .mail-editor .ql-snow .ql-tooltip a.ql-remove::before { content: 'Retirer'; }
      .mail-editor .ql-snow .ql-tooltip.ql-editing a.ql-action::after { content: 'Enregistrer'; }
      .mail-editor .ql-snow .ql-tooltip[data-mode='link']::before { content: 'Adresse :'; }
    `,
  ],
})
export class MailEditor implements FormValueControl<string> {
  public readonly value = model('');
  public readonly placeholder = input('Votre message…');
  /** La barre de mise en forme : affichée ou repliée (« Aa »). */
  public readonly toolbar = input(true);

  public readonly modules = { history: { delay: 600, maxStack: 200, userOnly: true } };

  private _quill: Quill | null = null;
  /** La sélection au moment d'ouvrir le lien : le panneau prend le focus, l'éditeur la perd. */
  private _linkRange: { index: number; length: number } | null = null;

  public readonly linkOpen = signal(false);
  public readonly linkModel = signal(new LinkFormModel());
  public readonly linkForm = form(this.linkModel, (schema) => {
    required(schema.url, { message: 'L’adresse du lien est obligatoire' });
    validate(schema.url, (ctx) =>
      /^\s*(javascript|vbscript|data):/i.test(ctx.value()) ? { kind: 'url', message: 'Cette adresse n’est pas autorisée' } : null,
    );
  });

  public created(quill: Quill): void {
    this._quill = quill;
    // Les listes déroulantes de Quill remplacent les <select> : leur titre est posé après coup.
    const titles: Record<string, string> = {
      'ql-font': 'Police', 'ql-size': 'Taille du texte', 'ql-color': 'Couleur du texte',
      'ql-background': 'Couleur de fond', 'ql-align': 'Aligner',
    };
    const toolbar = (quill.getModule('toolbar') as { container?: HTMLElement } | undefined)?.container;
    for (const [cls, title] of Object.entries(titles)) {
      toolbar?.querySelector(`.ql-picker.${cls} .ql-picker-label`)?.setAttribute('title', title);
    }
  }

  public undo(): void {
    (this._quill?.getModule('history') as { undo(): void } | undefined)?.undo();
  }

  public redo(): void {
    (this._quill?.getModule('history') as { redo(): void } | undefined)?.redo();
  }

  public focus(): void {
    this._quill?.focus();
  }

  /** Au curseur — un émoji, un mot ; il remplace le texte sélectionné, comme une frappe. */
  public insertText(text: string): void {
    const quill = this._quill;
    if (!quill) return;
    const range = quill.getSelection(true);
    if (range.length > 0) quill.deleteText(range.index, range.length, 'user');
    quill.insertText(range.index, text, 'user');
    quill.setSelection(range.index + text.length, 0, 'user');
  }

  /** Du HTML au curseur — la signature. */
  public insertHtml(html: string): void {
    const quill = this._quill;
    if (!quill) return;
    const range = quill.getSelection(true);
    quill.clipboard.dangerouslyPasteHTML(range.index, html, 'user');
  }

  /** Le panneau du lien, prérempli avec le texte sélectionné. */
  public openLink(): void {
    const quill = this._quill;
    const range = quill?.getSelection(true) ?? null;
    this._linkRange = range;
    const text = range && range.length > 0 ? quill!.getText(range.index, range.length) : '';
    this.linkModel.set(Object.assign(new LinkFormModel(), { text, url: '' }));
    this.linkOpen.set(true);
  }

  public insertLink(): void {
    submit(this.linkForm, async () => {
      const quill = this._quill;
      if (!quill) return;
      const url = normalizeUrl(this.linkModel().url);
      // Le texte tel quel : rogné, la sélection « site » précédée d'une espace la perdait.
      const typed = this.linkModel().text;
      const text = typed.trim() ? typed : url.replace(/^mailto:/i, '');
      const range = this._linkRange ?? { index: quill.getLength() - 1, length: 0 };

      if (range.length > 0) quill.deleteText(range.index, range.length, 'user');
      quill.insertText(range.index, text, 'link', url, 'user');
      quill.setSelection(range.index + text.length, 0, 'user');
      this.linkOpen.set(false);
    });
  }
}
