/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import { RelayDogMotionBoundary } from './RelayDogMotionBoundary';
import { projectHomeDogBehavior, projectWorkspaceDogBehavior } from './dog-behavior';
import { RelayWorkspaceDog } from '../project-workspace/RelayWorkspaceDog';
import { RelayHomeDog } from '../entry-home/RelayHomeDog';
import type { WorkspaceDogState } from '../project-workspace/contracts';

/* ------------------------------------------------------------- harness */

let rafCallbacks = new Map<number, (t: number) => void>();
let rafId = 0;
let cancelled: number[] = [];

/** Drives the controller's single loop by hand — no real time anywhere.
    Wrapped in act() so the resulting state updates flush to the DOM. */
function flushFrames(times: number[]) {
  act(() => {
    for (const time of times) {
      const pending = [...rafCallbacks.values()];
      rafCallbacks = new Map();
      for (const cb of pending) cb(time);
    }
  });
}

const pendingFrames = () => rafCallbacks.size;

function stubMatchMedia(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/** Gives the boundary a real track and the dog a real width. */
function stubGeometry(containerWidth = 400, dogWidth = 120) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('rdm') ? containerWidth : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('rdm-travel') ? dogWidth : 0;
    },
  });
}

beforeEach(() => {
  rafCallbacks = new Map();
  rafId = 0;
  cancelled = [];
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    rafId += 1;
    rafCallbacks.set(rafId, cb);
    return rafId;
  });
  // Realistic: cancelling actually drops the pending callback.
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    cancelled.push(id);
    rafCallbacks.delete(id);
  });
  stubMatchMedia(false);
  stubGeometry();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const dogFixture = <span className="dog-art">dog</span>;

function renderBoundary(state: WorkspaceDogState, reducedMotion = false) {
  return render(
    <RelayDogMotionBoundary behavior={projectWorkspaceDogBehavior(state)} reducedMotion={reducedMotion}>
      {dogFixture}
    </RelayDogMotionBoundary>,
  );
}

const boundaryEl = (container: HTMLElement) => container.querySelector('.rdm') as HTMLElement;
const travelEl = (container: HTMLElement) => container.querySelector('.rdm-travel') as HTMLElement;
const bodyEl = (container: HTMLElement) => container.querySelector('.rdm-body') as HTMLElement;
const facingEl = (container: HTMLElement) => container.querySelector('.rdm-facing') as HTMLElement;

const xOf = (container: HTMLElement): number => {
  const match = /translateX\((-?\d+)px\)/.exec(travelEl(container).style.transform);
  return match ? Number(match[1]) : 0;
};

/* ----------------------------------------------------------- structure */

describe('motion boundary structure', () => {
  it('renders the layered hierarchy around the untouched artwork', () => {
    const { container } = renderBoundary('wandering');
    expect(boundaryEl(container)).toBeTruthy();
    expect(travelEl(container)).toBeTruthy();
    expect(facingEl(container)).toBeTruthy();
    expect(bodyEl(container)).toBeTruthy();
    expect(container.querySelector('.rdm-body .dog-art')).toBeTruthy();
  });

  it('exposes the activity and patrol mode for inspection', () => {
    const { container } = renderBoundary('implementing');
    expect(boundaryEl(container).dataset.relayDogActivity).toBe('implementing');
    expect(boundaryEl(container).dataset.relayDogPatrol).toBe('off');

    cleanup();
    const idle = renderBoundary('wandering');
    expect(boundaryEl(idle.container).dataset.relayDogPatrol).toBe('on');
  });
});

/* -------------------------------------------------------------- patrol */

describe('idle patrol', () => {
  it('starts walking and moves in the facing direction', () => {
    const { container } = renderBoundary('wandering');
    flushFrames([0, 500, 1000]);
    expect(xOf(container)).toBeGreaterThan(0);
    expect(facingEl(container).className).toContain('rdm-facing--right');
  });

  it('reverses and faces left at the right boundary', () => {
    const { container } = renderBoundary('wandering');
    // 400 container − 120 dog = 280px of track at 26px/s ≈ 10.8s to the edge.
    const frames: number[] = [];
    for (let t = 0; t <= 24_000; t += 200) frames.push(t);
    flushFrames(frames);
    expect(facingEl(container).className).toContain('rdm-facing--left');
    expect(xOf(container)).toBeLessThanOrEqual(280);
  });

  it('never leaves the measured track', () => {
    const { container } = renderBoundary('wandering');
    const frames: number[] = [];
    for (let t = 0; t <= 60_000; t += 200) frames.push(t);
    flushFrames(frames);
    expect(xOf(container)).toBeGreaterThanOrEqual(0);
    expect(xOf(container)).toBeLessThanOrEqual(280);
  });

  it('keeps exactly ONE frame loop across many rerenders', () => {
    const { container, rerender } = renderBoundary('wandering');
    flushFrames([0, 200]);
    for (let i = 0; i < 8; i += 1) {
      rerender(
        <RelayDogMotionBoundary behavior={projectWorkspaceDogBehavior('wandering')}>
          {dogFixture}
        </RelayDogMotionBoundary>,
      );
    }
    // A single pending frame is queued no matter how many renders happened.
    expect(pendingFrames()).toBe(1);
    expect(boundaryEl(container)).toBeTruthy();
  });

  it('cancels the loop on unmount and schedules nothing further', () => {
    const view = renderBoundary('wandering');
    flushFrames([0, 200]);
    view.unmount();
    const before = pendingFrames();
    flushFrames([400]);
    expect(cancelled.length).toBeGreaterThan(0);
    expect(pendingFrames()).toBeLessThanOrEqual(before);
  });

  it('disables patrol safely when the container is narrower than the dog', () => {
    stubGeometry(100, 120);
    const { container } = renderBoundary('wandering');
    flushFrames([0, 500, 1000, 2000]);
    expect(xOf(container)).toBe(0);
    expect(boundaryEl(container).className).not.toContain('rdm--walking');
  });
});

/* -------------------------------------------- interruption + position */

describe('state interruption preserves position', () => {
  const INTERRUPTERS: WorkspaceDogState[] = [
    'trotting',
    'waiting_for_user',
    'researching',
    'implementing',
    'reviewing',
    'verifying',
    'repairing',
    'complete',
  ];

  it.each(INTERRUPTERS)('%s stops the walk immediately and holds position', (state) => {
    const { container, rerender } = renderBoundary('wandering');
    flushFrames([0, 1000, 2000, 3000]);
    const walkedTo = xOf(container);
    expect(walkedTo).toBeGreaterThan(0);

    rerender(
      <RelayDogMotionBoundary behavior={projectWorkspaceDogBehavior(state)}>
        {dogFixture}
      </RelayDogMotionBoundary>,
    );
    // Frames keep arriving; the dog must not drift.
    flushFrames([4000, 5000, 6000]);
    expect(xOf(container)).toBe(walkedTo);
    expect(boundaryEl(container).className).not.toContain('rdm--walking');
  });

  it('returning to idle resumes from the preserved position, not the centre', () => {
    const { container, rerender } = renderBoundary('wandering');
    flushFrames([0, 1000, 2000, 3000]);
    const walkedTo = xOf(container);

    rerender(
      <RelayDogMotionBoundary behavior={projectWorkspaceDogBehavior('trotting')}>
        {dogFixture}
      </RelayDogMotionBoundary>,
    );
    flushFrames([4000]);
    expect(xOf(container)).toBe(walkedTo);

    rerender(
      <RelayDogMotionBoundary behavior={projectWorkspaceDogBehavior('wandering')}>
        {dogFixture}
      </RelayDogMotionBoundary>,
    );
    flushFrames([5000, 5200]);
    expect(xOf(container)).toBeGreaterThanOrEqual(walkedTo);
  });

  it('rapid state changes leave exactly one loop and no stale motion', () => {
    const { container, rerender } = renderBoundary('wandering');
    flushFrames([0, 500]);
    for (const state of ['trotting', 'wandering', 'implementing', 'wandering', 'reviewing'] as const) {
      rerender(
        <RelayDogMotionBoundary behavior={projectWorkspaceDogBehavior(state)}>
          {dogFixture}
        </RelayDogMotionBoundary>,
      );
    }
    const held = xOf(container);
    flushFrames([1000, 1500, 2000]);
    expect(xOf(container)).toBe(held);
    expect(pendingFrames()).toBeLessThanOrEqual(1);
  });
});

/* ------------------------------------------------ activity animations */

describe('waiting and implementing animations', () => {
  it('waiting for the user selects the jump class and never walks', () => {
    const { container } = renderBoundary('waiting_for_user');
    expect(bodyEl(container).className).toContain('rdm-body--waiting_for_user');
    expect(boundaryEl(container).className).toContain('rdm--attention');
    flushFrames([0, 1000, 2000, 3000]);
    expect(xOf(container)).toBe(0);
    expect(boundaryEl(container).className).not.toContain('rdm--walking');
  });

  it('implementing selects the tippy-toe scratch class and never walks', () => {
    const { container } = renderBoundary('implementing');
    expect(bodyEl(container).className).toContain('rdm-body--implementing');
    flushFrames([0, 1000, 2000, 3000]);
    expect(xOf(container)).toBe(0);
  });

  it('the implementing class is stable across rerenders and stops on change', () => {
    const { container, rerender } = renderBoundary('implementing');
    for (let i = 0; i < 4; i += 1) {
      rerender(
        <RelayDogMotionBoundary behavior={projectWorkspaceDogBehavior('implementing')}>
          {dogFixture}
        </RelayDogMotionBoundary>,
      );
    }
    expect(bodyEl(container).className).toContain('rdm-body--implementing');

    rerender(
      <RelayDogMotionBoundary behavior={projectWorkspaceDogBehavior('reviewing')}>
        {dogFixture}
      </RelayDogMotionBoundary>,
    );
    expect(bodyEl(container).className).not.toContain('rdm-body--implementing');
    expect(bodyEl(container).className).toContain('rdm-body--reviewing');
  });
});

/* ------------------------------------------------------ reduced motion */

describe('reduced motion', () => {
  it('a reduced-motion prop stops patrol and shows the state label', () => {
    const { container } = renderBoundary('wandering', true);
    flushFrames([0, 1000, 2000]);
    expect(xOf(container)).toBe(0);
    expect(boundaryEl(container).className).toContain('rdm--reduced');
    expect(container.querySelector('.rdm-reduced-label')?.textContent).toBe('RELAY IDLE');
  });

  it('the system preference alone stops patrol', () => {
    stubMatchMedia(true);
    const { container } = renderBoundary('wandering');
    flushFrames([0, 1000, 2000]);
    expect(xOf(container)).toBe(0);
    expect(boundaryEl(container).className).toContain('rdm--reduced');
  });

  it('waiting and implementing keep their meaning without looping', () => {
    const waiting = renderBoundary('waiting_for_user', true);
    expect(waiting.container.querySelector('.rdm-reduced-label')?.textContent).toBe('WAITING FOR YOU');
    expect(waiting.container.querySelector('.rdm-body')).toBeTruthy();
    cleanup();

    const implementing = renderBoundary('implementing', true);
    expect(implementing.container.querySelector('.rdm-reduced-label')?.textContent).toBe(
      'IMPLEMENTING',
    );
  });

  it('never hides the dog', () => {
    const { container } = renderBoundary('implementing', true);
    expect(container.querySelector('.rdm-body .dog-art')).toBeTruthy();
  });

  it('survives an environment with no matchMedia at all', () => {
    Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: undefined });
    const { container } = renderBoundary('wandering');
    expect(boundaryEl(container)).toBeTruthy();
    expect(boundaryEl(container).className).not.toContain('rdm--reduced');
  });
});

/* ----------------------------------------- shared across both surfaces */

describe('live and demo share one dog and one controller', () => {
  it('the workspace dog renders through the shared boundary', () => {
    const { container } = render(<RelayWorkspaceDog state="implementing" />);
    expect(container.querySelectorAll('.rdm').length).toBe(1);
    expect(container.querySelectorAll('.rpd').length).toBe(1);
    expect(container.querySelector('[aria-label="Relay Dog: IMPLEMENTING"]')).toBeTruthy();
    expect(container.querySelector('.rdm-body--implementing')).toBeTruthy();
  });

  it('the home dog renders through the same shared boundary', () => {
    const { container } = render(<RelayHomeDog state="ready" />);
    expect(container.querySelectorAll('.rdm').length).toBe(1);
    expect(container.querySelectorAll('.rpd').length).toBe(1);
    expect(container.querySelector('.rdm')?.getAttribute('data-relay-dog-patrol')).toBe('on');
  });

  it('home waiting asks for attention rather than patrolling', () => {
    const { container } = render(<RelayHomeDog state="waiting" />);
    expect(container.querySelector('.rdm')?.getAttribute('data-relay-dog-patrol')).toBe('off');
    expect(container.querySelector('.rdm-body--waiting_for_user')).toBeTruthy();
    expect(projectHomeDogBehavior('waiting').attentionRequired).toBe(true);
  });

  it('a mounted dog produces no duplicate boundary for repeated identical states', () => {
    const { container, rerender } = render(<RelayWorkspaceDog state="wandering" />);
    for (let i = 0; i < 5; i += 1) rerender(<RelayWorkspaceDog state="wandering" />);
    expect(container.querySelectorAll('.rdm').length).toBe(1);
    expect(pendingFrames()).toBeLessThanOrEqual(1);
  });
});
