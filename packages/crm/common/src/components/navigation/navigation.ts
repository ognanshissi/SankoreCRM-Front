import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  ViewEncapsulation,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TasIcon } from '@talisoft/ui/icon';

export interface CommonNavigationItem {
  /** Visible label of the entry. */
  label: string;
  /** Feather icon name, e.g. `feather:grid`. */
  icon: string;
  /** Router link target. */
  link: string | any[];
  /** Match the link exactly when resolving the active state. */
  exact?: boolean;
  isDisabled?: boolean;
  isVisible?: boolean;
}

export interface CommonNavigationUser {
  name: string;
  email?: string;
  /** Optional override for the avatar initials (defaults to the name). */
  initials?: string;
}

@Component({
  selector: 'common-navigation',
  imports: [RouterLink, RouterLinkActive, TasIcon],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './navigation.html',
  styles: [
    `
      @reference "tailwindcss";

      common-navigation {
        --common-navigation-card-bg: #3a4230;
        --common-navigation-text: #e9ebe1;
        --common-navigation-muted: #97a082;
        --common-navigation-accent: #d0824e;
        --common-navigation-avatar: #8fa06a;

        display: flex;
        flex-direction: column;
        width: 280px;
        height: 100vh;
        padding: 1.75rem 1.25rem 1.25rem;
        gap: 1.75rem;
        background-color: rgb(var(--tas-color-primary));
        color: var(--common-navigation-text);
        font-family: inherit;
      }

      .common-navigation__brand {
        display: flex;
        align-items: center;
        gap: 0.85rem;
        padding-left: 0.35rem;
      }

      .common-navigation__logo {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 0.85rem;
        background-color: rgb(var(--tas-color-accent));
        color: #fff;
      }

      .common-navigation__logo tas-icon {
        transform: scale(1.1);
      }

      .common-navigation__brand-name {
        font-size: 1.35rem;
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      .common-navigation__menu {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .common-navigation__item {
        display: flex;
        align-items: center;
        gap: 0.9rem;
        padding: 0.8rem 1rem;
        border-radius: 0.9rem;
        font-size: 1rem;
        font-weight: 500;
        color: var(--common-navigation-text);
        text-decoration: none;
        transition:
          background-color 0.15s ease,
          color 0.15s ease;
      }

      .common-navigation__item tas-icon {
        color: currentColor;
      }

      .common-navigation__item:hover {
        background-color: rgba(255, 255, 255, 0.06);
      }

      .common-navigation__item--active:hover {
        background-color: rgba(255, 255, 255, 0.9);
      }

      .common-navigation__user:hover, {
      .common-navigation__item--active {
        background-color: #fff;
        color: #1f2417;
        font-weight: 600;
      }

      .common-navigation__reminder {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
      }

      .common-navigation__reminder-label {
        margin: 0;
        padding-left: 0.35rem;
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--common-navigation-muted);
      }

      .common-navigation__reminder-card {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        padding: 1.15rem;
        border-radius: 1rem;
        background-color: var(--common-navigation-card-bg);
      }

      .common-navigation__reminder-title {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 700;
        line-height: 1.35;
      }

      .common-navigation__reminder-text {
        margin: 0;
        font-size: 0.9rem;
        line-height: 1.5;
        color: var(--common-navigation-muted);
      }

      .common-navigation__spacer {
        flex: 1 1 auto;
      }

      .common-navigation__user {
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 0.85rem;
        padding-top: 1.15rem;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }

      .common-navigation__avatar {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 9999px;
        background-color: var(--common-navigation-avatar);
        color: #fff;
        font-size: 0.85rem;
        font-weight: 600;
      }

      .common-navigation__user-info {
        min-width: 0;
      }

      .common-navigation__user-name {
        margin: 0;
        font-size: 0.95rem;
        font-weight: 600;
      }

      .common-navigation__user-email {
        margin: 0;
        font-size: 0.82rem;
        color: var(--common-navigation-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `,
  ],
})
export class NavigationComponent {
  public brandName = input<string>('SankoreCRM');

  public items = input<CommonNavigationItem[]>([]);

  public reminderLabel = input<string>('A small reminder');
  public reminderTitle = input<string>('Progress is built one clear step at a time.');
  public reminderText = input<string>(
    'Focus on what matters, one relationship at a time.'
  );

  public user = input<CommonNavigationUser | null>(null);

  public initials = computed(() => {
    const current = this.user();
    if (!current) {
      return '';
    }
    if (current.initials) {
      return current.initials;
    }
    return current.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  });
}
