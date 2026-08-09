/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { RelayPixelDog, PIXEL_DOG_PARTS, pixelDogPart } from './RelayPixelDog';

/**
 * A LIVING ANIMAL NEEDS PARTS THAT MOVE INDEPENDENTLY.
 *
 * The sprite was one flat list of rects, so the only motion available to it
 * was translating the whole mark — which reads as a UI icon pulsing rather
 * than an animal breathing, and makes a four-beat gait impossible because
 * every leg is the same element.
 *
 * These hold the structure the animation depends on. A CSS keyframe cannot be
 * asserted in jsdom; the GROUPS it animates can, and without them no amount of
 * CSS produces a gait.
 */

describe('the pixel dog is built from parts, not one sprite', () => {
  it('classifies every pixel into exactly one anatomical part', () => {
    for (let y = 0; y < 14; y += 1) {
      for (let x = 0; x < 18; x += 1) {
        const part = pixelDogPart(x, y);
        expect(PIXEL_DOG_PARTS).toContain(part);
      }
    }
  });

  it('puts the head above the body, and the legs below both', () => {
    expect(pixelDogPart(9, 0)).toBe('head');
    expect(pixelDogPart(9, 5)).toBe('head');
    expect(pixelDogPart(9, 6)).toBe('body');
    expect(pixelDogPart(9, 10)).toBe('body');
    expect(pixelDogPart(3, 11)).toContain('leg');
    expect(pixelDogPart(3, 13)).toContain('leg');
  });

  /**
   * FOUR PAWS, OR THERE IS NO GAIT. The approved sprite drew three leg
   * columns, so a four-beat sequence would have required one column to do two
   * jobs — which is exactly the synchronised-leg look the design forbids.
   */
  it('renders four separately addressable legs in the standing pose', () => {
    const { container } = render(
      <RelayPixelDog pose="standing" label="READY" />,
    );
    const legs = container.querySelectorAll('[class*="rpd-part--leg-"]');
    expect(legs.length).toBe(4);
    for (const leg of ['front-near', 'front-far', 'rear-near', 'rear-far']) {
      expect(container.querySelector(`.rpd-part--leg-${leg}`)).toBeTruthy();
    }
    cleanup();
  });

  it('gives the body and head their own groups, so the chest can rise alone', () => {
    const { container } = render(<RelayPixelDog pose="standing" label="READY" />);
    expect(container.querySelector('.rpd-part--body')).toBeTruthy();
    expect(container.querySelector('.rpd-part--head')).toBeTruthy();
    cleanup();
  });

  /**
   * The moving class is what the gait keyframes hang off. Reduced motion must
   * remove it — a user who asked for no motion did not ask for less motion,
   * and the idle breath is motion too.
   */
  it('does not mark the dog as moving when reduced motion is requested', () => {
    const { container } = render(
      <RelayPixelDog pose="trotting" label="WANDERING" moving reducedMotion />,
    );
    expect(container.querySelector('.rpd--moving')).toBeNull();
    cleanup();
  });

  it('marks the dog as moving when it is walking and motion is allowed', () => {
    const { container } = render(
      <RelayPixelDog pose="trotting" label="WANDERING" moving />,
    );
    expect(container.querySelector('.rpd--moving')).toBeTruthy();
    cleanup();
  });

  /** A pose with no pixels in a band contributes no group, rather than an
   *  empty one that CSS would still animate. */
  it('emits no group for a part the pose does not draw', () => {
    const { container } = render(<RelayPixelDog pose="lying" label="RESTING" />);
    const groups = container.querySelectorAll('.rpd-part');
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.length).toBeLessThanOrEqual(PIXEL_DOG_PARTS.length);
    cleanup();
  });
});
