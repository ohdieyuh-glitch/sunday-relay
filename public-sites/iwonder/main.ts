import './site.css';
import { initChrome, prefersReducedMotion } from '../shared/chrome';
import { webglAvailable } from '../shared/three/stage';

initChrome();
initProviderSlots();
initBrainRecord();

const host = document.getElementById('stage');
const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-scene]'));

if (host && sections.length > 0) {
  if (!webglAvailable()) {
    // No WebGL is not an error state: the document is the page, over a lit void.
    host.className = 'pw-stage-fallback';
  } else {
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    // The world is a separate chunk: the copy, nav and CTAs are interactive
    // before a single byte of Three.js has arrived.
    void import('./world-scene').then(({ mountWorldScene }) => {
      mountWorldScene(host, canvas, sections, prefersReducedMotion());
    });
  }
}

/**
 * THE PROVIDER SLOTS. Each tier's socket shows one provider at a time and
 * steps through its example sequence, so the point — the slot stays, what
 * fills it changes — is shown rather than stated.
 *
 * Every provider is already in the HTML as a readable sequence. This only
 * moves the highlight; it never adds or hides a name. It runs only while the
 * slots are on screen, and not at all under reduced motion.
 */
function initProviderSlots(): void {
  const slots = Array.from(document.querySelectorAll<HTMLElement>('[data-slot]'));
  if (slots.length === 0 || prefersReducedMotion() || !('IntersectionObserver' in window)) return;

  const state = slots.map((slot) => ({
    slot,
    items: Array.from(slot.querySelectorAll<HTMLElement>('.iw-slot-sequence li')),
    current: slot.querySelector<HTMLElement>('[data-slot-current]'),
    index: 0,
  }));

  let timer = 0;
  let tick = 0;
  const step = () => {
    tick += 1;
    // Staggered: one tier changes per beat, never all three at once.
    const entry = state[tick % state.length];
    const { items, current } = entry;
    if (!current || items.length < 2) return;
    entry.index = (entry.index + 1) % items.length;
    items.forEach((item, i) => { item.dataset.active = i === entry.index ? 'true' : 'false'; });
    current.dataset.swapping = 'true';
    window.setTimeout(() => {
      current.textContent = items[entry.index].textContent;
      current.dataset.swapping = 'false';
    }, 360);
  };

  const list = slots[0].closest('.iw-slot-list') ?? slots[0];
  new IntersectionObserver((entries) => {
    const visible = entries.some((entry) => entry.isIntersecting);
    if (visible && timer === 0) timer = window.setInterval(() => { if (!document.hidden) step(); }, 1500);
    if (!visible && timer !== 0) {
      window.clearInterval(timer);
      timer = 0;
    }
  }, { threshold: 0.2 }).observe(list);
}

/**
 * THE PROJECT BRAIN RECORD. Entries are written as the reader moves through
 * the record, with a write head travelling down its spine. Without script,
 * or under reduced motion, every entry is simply shown.
 */
function initBrainRecord(): void {
  const list = document.getElementById('brain-record');
  if (!list) return;
  const entries = Array.from(list.children) as HTMLElement[];
  if (prefersReducedMotion()) {
    entries.forEach((entry) => { entry.dataset.written = 'true'; });
    return;
  }
  list.dataset.writing = 'true';
  let queued = false;
  const update = () => {
    queued = false;
    const rect = list.getBoundingClientRect();
    const viewport = window.innerHeight;
    // Begins when the record's top reaches 80% of the viewport; complete when
    // its bottom reaches 60%.
    const start = viewport * 0.8;
    const end = viewport * 0.6;
    const span = rect.height + (start - end);
    const progress = Math.min(1, Math.max(0, (start - rect.top) / span));
    const written = Math.round(progress * entries.length);
    entries.forEach((entry, i) => { entry.dataset.written = i < written ? 'true' : 'false'; });
    const head = entries[Math.max(0, written - 1)];
    list.style.setProperty('--iw-head', `${head.offsetTop + 17}px`);
  };
  window.addEventListener('scroll', () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  window.addEventListener('resize', update);
  update();
}
