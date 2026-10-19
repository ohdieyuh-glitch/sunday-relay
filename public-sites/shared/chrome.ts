/**
 * PUBLIC SITE CHROME — navigation, the menu sheet, reveals, active section.
 *
 * Progressive enhancement only. Every piece of content is in the HTML and
 * visible without this file; what it adds is the scrolled nav plate, the
 * mobile menu, entrance reveals and `aria-current` on the section in view.
 */

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function initChrome(): void {
  document.documentElement.classList.add('pw-js');
  initNav();
  initMenu();
  initReveals();
  initActiveSection();
  const year = String(new Date().getFullYear());
  document.querySelectorAll<HTMLElement>('[data-year]').forEach((node) => {
    node.textContent = year;
  });
}

function initNav(): void {
  const nav = document.querySelector<HTMLElement>('.pw-nav');
  if (!nav) return;
  let queued = false;
  const update = () => {
    queued = false;
    nav.dataset.scrolled = window.scrollY > 24 ? 'true' : 'false';
  };
  window.addEventListener('scroll', () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  update();
}

function initMenu(): void {
  const button = document.querySelector<HTMLButtonElement>('.pw-menu-button');
  const sheet = document.getElementById('pw-sheet');
  if (!button || !sheet) return;

  const setOpen = (open: boolean) => {
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.querySelector('.pw-menu-label')!.textContent = open ? 'Close' : 'Menu';
    sheet.dataset.open = open ? 'true' : 'false';
    sheet.toggleAttribute('inert', !open);
    sheet.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) sheet.querySelector<HTMLElement>('a')?.focus();
  };

  setOpen(false);
  button.addEventListener('click', () => setOpen(button.getAttribute('aria-expanded') !== 'true'));
  sheet.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      button.focus();
    }
  });
  // A sheet left open across a resize to desktop would hide the page behind a
  // menu the desktop layout has no button to close.
  window.matchMedia('(min-width: 901px)').addEventListener('change', (event) => {
    if (event.matches) setOpen(false);
  });
}

function initReveals(): void {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
  if (nodes.length === 0) return;
  if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
    nodes.forEach((node) => { node.dataset.in = 'true'; });
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      (entry.target as HTMLElement).dataset.in = 'true';
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  nodes.forEach((node) => observer.observe(node));
}

function initActiveSection(): void {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.pw-nav-link[href^="#"]'));
  const sections = links
    .map((link) => document.querySelector<HTMLElement>(link.getAttribute('href')!))
    .filter((section): section is HTMLElement => section !== null);
  if (sections.length === 0 || !('IntersectionObserver' in window)) return;

  const visible = new Map<Element, number>();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) visible.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
    let best: Element | null = null;
    let bestRatio = 0;
    for (const [section, ratio] of visible) {
      if (ratio > bestRatio) {
        best = section;
        bestRatio = ratio;
      }
    }
    for (const link of links) {
      const current = best !== null && link.getAttribute('href') === `#${best.id}`;
      if (current) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
  }, { threshold: [0, 0.15, 0.35, 0.6], rootMargin: '-30% 0px -40% 0px' });
  sections.forEach((section) => observer.observe(section));
}
