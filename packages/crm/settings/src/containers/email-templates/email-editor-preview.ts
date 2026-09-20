import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  ElementRef,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { QuillModule } from 'ngx-quill';
import {
  generateEmailHtml,
  generateTextFromHtml,
  getEmailHtmlSize,
  formatSize,
  EmailTemplateOptions,
} from './email-html-generator';

type PreviewDevice = 'desktop' | 'tablet' | 'mobile';
type EditorTab = 'visual' | 'html' | 'email-html' | 'text';

const QUILL_MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ color: [] }, { background: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ indent: '-1' }, { indent: '+1' }],
    [{ align: [] }],
    ['blockquote'],
    ['link', 'image'],
    ['clean'],
  ],
};

const DEVICE_WIDTHS: Record<PreviewDevice, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
};

@Component({
  selector: 'email-editor-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TasIcon, TasTag, Button, QuillModule],
  template: `
    <div class="flex flex-col h-full">
      <!-- Toolbar -->
      <div class="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2 rounded-t-lg">
        <div class="flex items-center gap-1">
          @for (tab of editorTabs; track tab.key) {
            <button
              class="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
              [class]="activeTab() === tab.key
                ? 'bg-primary text-white'
                : 'text-slate-500 hover:bg-slate-100'"
              (click)="activeTab.set(tab.key)"
            >
              <tas-icon [iconName]="tab.icon" style="font-size:12px" class="mr-1"></tas-icon>
              {{ tab.label }}
            </button>
          }
        </div>
        <div class="flex items-center gap-2">
          <!-- Size indicator -->
          <div class="flex items-center gap-1.5 mr-2">
            <span
              class="text-[10px] font-mono px-1.5 py-0.5 rounded"
              [class]="emailHtmlSizeBytes() > 102400
                ? 'bg-red-50 text-red-600'
                : emailHtmlSizeBytes() > 80000
                  ? 'bg-amber-50 text-amber-600'
                  : 'bg-slate-50 text-slate-500'"
            >{{ emailHtmlSizeFormatted() }}</span>
            @if (emailHtmlSizeBytes() > 102400) {
              <tas-tag severity="error">Trop lourd</tas-tag>
            }
          </div>

          <!-- Auto text -->
          <button
            class="px-2 py-1 text-[10px] font-medium rounded transition-colors border"
            [class]="'border-slate-200 text-slate-500 hover:bg-slate-50'"
            title="Generer automatiquement le texte brut depuis le HTML"
            (click)="autoGenerateText()"
          >
            <tas-icon iconName="feather:refresh-cw" style="font-size:10px" class="mr-0.5"></tas-icon>
            Auto texte
          </button>

          <div class="w-px h-5 bg-slate-200 mx-1"></div>

          <!-- Devices -->
          <span class="text-[10px] text-slate-400 mr-1">Apercu :</span>
          @for (device of devices; track device.key) {
            <button
              class="p-1.5 rounded transition-colors"
              [class]="previewDevice() === device.key
                ? 'bg-slate-200 text-slate-700'
                : 'text-slate-400 hover:text-slate-600'"
              [title]="device.label"
              (click)="previewDevice.set(device.key)"
            >
              <tas-icon [iconName]="device.icon" style="font-size:14px"></tas-icon>
            </button>
          }
        </div>
      </div>

      <!-- Split pane -->
      <div class="flex-1 flex min-h-0">
        <!-- Editor side -->
        <div class="w-1/2 border-r border-slate-200 flex flex-col min-h-0 bg-white">
          @if (activeTab() === 'visual') {
            <div class="flex-1 overflow-auto">
              <quill-editor
                [modules]="quillModules"
                [ngModel]="htmlBody()"
                (ngModelChange)="onHtmlChange($event)"
                placeholder="Redigez le contenu de votre e-mail..."
                [styles]="{ minHeight: '100%', height: '100%', border: 'none' }"
                theme="snow"
              ></quill-editor>
            </div>
          }
          @if (activeTab() === 'html') {
            <div class="flex-1 overflow-auto p-3">
              <textarea
                class="w-full h-full font-mono text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                [ngModel]="htmlBody()"
                (ngModelChange)="onHtmlChange($event)"
                placeholder="<h1>Votre HTML ici...</h1>"
                spellcheck="false"
              ></textarea>
            </div>
          }
          @if (activeTab() === 'email-html') {
            <div class="flex-1 flex flex-col min-h-0">
              <div class="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50 shrink-0">
                <div class="flex items-center gap-2">
                  <tas-icon iconName="feather:zap" class="text-amber-500" style="font-size:12px"></tas-icon>
                  <span class="text-[10px] text-slate-500">HTML genere pour les clients mail (lecture seule)</span>
                </div>
                <button
                  class="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded border border-slate-200 text-slate-600 hover:bg-white transition-colors"
                  (click)="copyEmailHtml()"
                >
                  <tas-icon [iconName]="copied() ? 'feather:check' : 'feather:copy'" style="font-size:10px"></tas-icon>
                  {{ copied() ? 'Copie !' : 'Copier' }}
                </button>
              </div>
              <div class="flex-1 overflow-auto p-3">
                <pre class="w-full h-full font-mono text-[11px] leading-relaxed text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-auto whitespace-pre-wrap break-all">{{ generatedEmailHtml() }}</pre>
              </div>
            </div>
          }
          @if (activeTab() === 'text') {
            <div class="flex-1 overflow-auto p-3">
              <textarea
                class="w-full h-full text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                [ngModel]="textBody()"
                (ngModelChange)="onTextChange($event)"
                placeholder="Version texte brut de l'e-mail..."
              ></textarea>
            </div>
          }
        </div>

        <!-- Preview side -->
        <div class="w-1/2 bg-slate-100 flex flex-col items-center min-h-0 overflow-auto p-4">
          <div
            class="transition-all duration-300 h-full"
            [style.width]="deviceWidth()"
            [style.max-width]="'100%'"
          >
            <div class="bg-white rounded-lg shadow-sm overflow-hidden border border-slate-200 h-full">
              <iframe
                #previewFrame
                class="w-full h-full border-0"
                sandbox="allow-same-origin"
                title="Apercu de l'e-mail"
              ></iframe>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }
    :host ::ng-deep .ql-toolbar.ql-snow {
      border: none !important;
      border-bottom: 1px solid #e2e8f0 !important;
      background: #f8fafc;
    }
    :host ::ng-deep .ql-container.ql-snow {
      border: none !important;
    }
    :host ::ng-deep .ql-editor {
      padding: 16px 20px;
      font-size: 14px;
      line-height: 1.7;
    }
    :host ::ng-deep .ql-editor.ql-blank::before {
      font-style: normal;
      color: #94a3b8;
    }
  `],
})
export class EmailEditorPreview {
  public readonly subject = input<string>('');
  public readonly htmlBody = input<string>('');
  public readonly textBody = input<string>('');
  public readonly templateOptions = input<Partial<EmailTemplateOptions>>({});

  public readonly htmlBodyChange = output<string>();
  public readonly textBodyChange = output<string>();
  public readonly emailHtmlGenerated = output<string>();

  public readonly quillModules = QUILL_MODULES;

  public activeTab = signal<EditorTab>('visual');
  public previewDevice = signal<PreviewDevice>('desktop');
  public copied = signal(false);

  public deviceWidth = computed(() => DEVICE_WIDTHS[this.previewDevice()]);

  public generatedEmailHtml = computed(() =>
    generateEmailHtml(this.subject(), this.htmlBody(), this.templateOptions()),
  );

  public emailHtmlSizeBytes = computed(() => getEmailHtmlSize(this.generatedEmailHtml()));
  public emailHtmlSizeFormatted = computed(() => formatSize(this.emailHtmlSizeBytes()));

  public readonly previewFrame = viewChild<ElementRef<HTMLIFrameElement>>('previewFrame');

  public readonly editorTabs = [
    { key: 'visual' as const, label: 'Visuel', icon: 'feather:edit-3' },
    { key: 'html' as const, label: 'HTML', icon: 'feather:code' },
    { key: 'email-html' as const, label: 'E-mail HTML', icon: 'feather:send' },
    { key: 'text' as const, label: 'Texte', icon: 'feather:file-text' },
  ];

  public readonly devices = [
    { key: 'desktop' as const, label: 'Bureau', icon: 'feather:monitor' },
    { key: 'tablet' as const, label: 'Tablette', icon: 'feather:tablet' },
    { key: 'mobile' as const, label: 'Mobile', icon: 'feather:smartphone' },
  ];

  constructor() {
    // Update preview iframe with generated email HTML
    effect(() => {
      const emailHtml = this.generatedEmailHtml();
      this.previewDevice(); // track device changes
      const frame = this.previewFrame();
      if (!frame) return;
      const doc = frame.nativeElement.contentDocument;
      if (!doc) return;
      doc.open();
      doc.write(emailHtml);
      doc.close();
    });

    // Emit generated HTML when content changes
    effect(() => {
      const emailHtml = this.generatedEmailHtml();
      this.emailHtmlGenerated.emit(emailHtml);
    });
  }

  public onHtmlChange(value: string): void {
    this.htmlBodyChange.emit(value);
  }

  public onTextChange(value: string): void {
    this.textBodyChange.emit(value);
  }

  public autoGenerateText(): void {
    const text = generateTextFromHtml(this.htmlBody());
    this.textBodyChange.emit(text);
  }

  public copyEmailHtml(): void {
    navigator.clipboard.writeText(this.generatedEmailHtml()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }
}
