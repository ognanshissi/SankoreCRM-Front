import { CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MyNotificationDto } from '@sankore/crm-api';
import { ButtonModule } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { Menu } from '@talisoft/ui/menu';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { NotificationCenterService } from './notification-center.service';

interface CategoryVisual {
  readonly icon: string;
  readonly tone: string;
}

function categoryVisual(category: string | null | undefined): CategoryVisual {
  const value = (category ?? '').toLowerCase();
  if (value === 'whatsapp.takeover-breach') return { icon: 'feather:alert-triangle', tone: 'text-red-600 bg-red-50' };
  if (value === 'whatsapp.message-failed') return { icon: 'feather:alert-circle', tone: 'text-amber-600 bg-amber-50' };
  if (value.startsWith('whatsapp.')) return { icon: 'feather:message-circle', tone: 'text-emerald-600 bg-emerald-50' };
  return { icon: 'feather:bell', tone: 'text-slate-500 bg-slate-100' };
}

/**
 * Cloche des notifications in-app dans la barre supérieure (WA-FE-10).
 *
 * L'aperçu est un popover d'en-tête de 20 éléments, pas un écran de liste : il n'utilise donc
 * pas `tas-table`, comme le menu utilisateur voisin.
 *
 * `CdkMenuTrigger` directement plutôt que `TasMenuTrigger` : ce dernier n'expose pas
 * `cdkMenuOpened`, dont on a besoin pour relire la liste à l'ouverture. Les lignes sont des
 * `cdkMenuItem` pour garder la navigation au clavier du menu (flèches, Entrée, Échap).
 */
@Component({
  selector: 'common-notification-bell',
  imports: [ButtonModule, TasIcon, TasSpinner, Menu, CdkMenuTrigger, CdkMenuItem, TimeagoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notification-bell.html',
})
export class NotificationBell {
  private readonly _center = inject(NotificationCenterService);
  private readonly _router = inject(Router);

  public readonly items = this._center.items;
  public readonly unreadCount = this._center.unreadCount;
  public readonly isLoading = this._center.isLoading;

  public readonly badgeLabel = computed(() => {
    const count = this.unreadCount();
    return count > 99 ? '99+' : String(count);
  });

  public readonly ariaLabel = computed(() => {
    const count = this.unreadCount();
    return `Notifications (${count} ${count === 1 ? 'non lue' : 'non lues'})`;
  });

  public visual(notification: MyNotificationDto): CategoryVisual {
    return categoryVisual(notification.category);
  }

  public onOpened(): void {
    this._center.reload();
  }

  public open(notification: MyNotificationDto): void {
    this._center.markRead(notification);
    const link = notification.link?.trim();
    // Uniquement des routes internes : un lien absolu ou `//hôte` sortirait de l'application.
    if (link && link.startsWith('/') && !link.startsWith('//')) {
      void this._router.navigateByUrl(link);
    }
  }

  public markAllRead(): void {
    this._center.markAllRead();
  }
}
