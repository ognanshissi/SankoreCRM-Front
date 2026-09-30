import { Component, signal } from '@angular/core';
import { form, FormField, FormRoot } from '@angular/forms/signals';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TasFileUploader } from '@talisoft/ui/file-uploader';

/**
 * Contrat de `tas-file-uploader` après son passage de `ControlValueAccessor` à
 * `FormValueControl`.
 *
 * Le composant était relié par `[formControl]`, seule occurrence de Reactive Forms
 * du dépôt. `value` est désormais un `model()`, ce qui lui ouvre `[formField]` dans
 * un signal form. Ces trois cas sont les régressions possibles de ce changement :
 * un fichier choisi qui n'atteint pas le modèle, un fichier trop lourd accepté
 * malgré tout, et un retrait qui ne vide pas la valeur.
 */
class UploadFormModel {
  public document!: File | null;

  public static instantiate(): UploadFormModel {
    const m = new UploadFormModel();
    m.document = null;
    return m;
  }
}

@Component({
  standalone: true,
  imports: [TasFileUploader, FormRoot, FormField],
  template: `
    <form [formRoot]="formSchema">
      <tas-file-uploader
        accept=".csv"
        [maxSizeMb]="maxSizeMb()"
        [formField]="formSchema.document"
      ></tas-file-uploader>
    </form>
  `,
})
class HostComponent {
  public maxSizeMb = signal<number | null>(1);
  public model = signal(UploadFormModel.instantiate());
  public formSchema = form(this.model);
}

/** `File` léger : la taille est ce qui compte pour ces cas. */
function fileOfSize(name: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type: 'text/csv' });
}

describe('TasFileUploader — contrat FormValueControl', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let uploader: TasFileUploader;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
    uploader = fixture.debugElement.query((n) => n.name === 'tas-file-uploader')
      .componentInstance as TasFileUploader;
  });

  it('écrit le fichier choisi dans le modèle du formulaire', async () => {
    const file = fileOfSize('leads.csv', 512);
    uploader.value.set(file);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.formSchema.document().value()).toBe(file);
  });

  it('refuse un fichier au-delà de maxSizeMb sans toucher à la valeur', async () => {
    const tooBig = fileOfSize('gros.csv', 2 * 1024 * 1024);
    uploader.onDrop({
      preventDefault: () => undefined,
      dataTransfer: { files: [tooBig] },
    } as unknown as DragEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(uploader.value()).toBeNull();
    expect(host.formSchema.document().value()).toBeNull();
    expect(uploader.sizeError()).toContain('1 Mo');
  });

  it('accepte le même fichier une fois la limite levée', async () => {
    const file = fileOfSize('gros.csv', 2 * 1024 * 1024);
    host.maxSizeMb.set(null);
    fixture.detectChanges();
    await fixture.whenStable();

    uploader.onDrop({
      preventDefault: () => undefined,
      dataTransfer: { files: [file] },
    } as unknown as DragEvent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.formSchema.document().value()).toBe(file);
    expect(uploader.sizeError()).toBe('');
  });

  it('vide la valeur et le message au retrait', async () => {
    uploader.value.set(fileOfSize('leads.csv', 512));
    fixture.detectChanges();
    await fixture.whenStable();

    uploader.clearFile();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(uploader.value()).toBeNull();
    expect(host.formSchema.document().value()).toBeNull();
    expect(uploader.sizeError()).toBe('');
  });
});
