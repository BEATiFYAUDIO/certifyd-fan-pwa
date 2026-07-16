import type { MouseEvent } from 'react';

export function openExternalNavigation(event: MouseEvent<HTMLElement>, href: string | null | undefined) {
  if (!href || href === '#') return;
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  window.open(href, '_blank', 'noopener,noreferrer');
}
