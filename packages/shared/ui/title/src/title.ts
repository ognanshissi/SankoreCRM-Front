import { ChangeDetectionStrategy, Component, HostBinding } from '@angular/core';

@Component({
  selector: 'tas-title, Title, [Title]',
  template: `
    <div class="text-xl font-bold text-gray-700">
      <ng-content></ng-content>
    </div>
  `,
  standalone: true,
  exportAs: 'TasTitle',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TasTitle {
  static nextId = 0;
  @HostBinding() id = `tas-title-id-${TasTitle.nextId++}`;
  @HostBinding('attr.role') role = 'title';
}
