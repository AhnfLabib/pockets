import { describe, it, expect } from 'vitest';
import { createChain, followChain, LINKS } from '../../../src/stage/rig/chain';

const len = (n: { x: number; y: number }[], i: number) =>
  Math.hypot(n[i].x - n[i - 1].x, n[i].y - n[i - 1].y);

describe('chain', () => {
  it('has every link at its length at stretch 1', () => {
    const nodes = createChain({ x: 100, y: 200 }, 0.7);
    followChain(nodes, 1);
    for (let i = 1; i < nodes.length; i++) expect(Math.abs(len(nodes, i) - LINKS[i])).toBeLessThan(1e-6);
  });

  it('shortens links 1 and 2 to 74% and leaves the tail alone', () => {
    const nodes = createChain({ x: 0, y: 0 }, -Math.PI / 2);
    followChain(nodes, 0.74);
    expect(Math.abs(len(nodes, 1) - LINKS[1] * 0.74)).toBeLessThan(1e-6);
    expect(Math.abs(len(nodes, 2) - LINKS[2] * 0.74)).toBeLessThan(1e-6);
    for (let i = 3; i < nodes.length; i++) expect(Math.abs(len(nodes, i) - LINKS[i])).toBeLessThan(1e-6);
  });
});
