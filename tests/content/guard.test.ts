import { describe, it, expect, vi } from 'vitest';
import { CONTENT_KEY, claim, contextProbe, isLive, type GuardRecord } from '../../src/content/guard';

/** A fake chrome.runtime whose context can be invalidated, as an extension update or reload does. */
function fakeRuntime() {
  const rt: { id?: string } = { id: 'ext' };
  return { rt, kill: () => { delete rt.id; } };
}

/** What content.js does: claim the frame, and only on success start (here: count starts). */
function runContent(g: Record<string, unknown>, build: string, runtime: { id?: string }) {
  const started = { n: 0, disposed: 0 };
  const alive = contextProbe(runtime);
  const ok = alive() && claim(g, CONTENT_KEY, { build, alive, dispose: () => { started.disposed++; } });
  if (ok) started.n++;
  return started;
}

describe('content guard', () => {
  it('a second run of the same live build in the same world is a no-op', () => {
    const g: Record<string, unknown> = {};
    const { rt } = fakeRuntime();
    const first = runContent(g, 'b1', rt);
    const second = runContent(g, 'b1', rt);
    expect(first.n).toBe(1);
    expect(second.n).toBe(0);
    expect(first.disposed).toBe(0);
  });

  it('after the old context dies (update or reload, same build stamp), a new run starts fresh and disposes the orphan', () => {
    const g: Record<string, unknown> = {};
    const old = fakeRuntime();
    const orphan = runContent(g, 'b1', old.rt);
    old.kill();
    const fresh = runContent(g, 'b1', fakeRuntime().rt);
    expect(fresh.n).toBe(1);
    expect(orphan.disposed).toBe(1);
    // And the new one now guards against a third run.
    expect(runContent(g, 'b1', fakeRuntime().rt).n).toBe(0);
  });

  it('a different build starts fresh even if the old record still claims to be alive', () => {
    const g: Record<string, unknown> = {};
    const orphan = runContent(g, 'b1', fakeRuntime().rt);
    expect(runContent(g, 'b2', fakeRuntime().rt).n).toBe(1);
    expect(orphan.disposed).toBe(1);
  });

  it('a run whose own context is already dead does nothing', () => {
    const g: Record<string, unknown> = {};
    const dead = fakeRuntime();
    dead.kill();
    expect(runContent(g, 'b1', dead.rt).n).toBe(0);
    expect(g[CONTENT_KEY]).toBeUndefined();
  });

  it('a record whose alive() or dispose() throws is treated as dead and replaced', () => {
    const g: Record<string, unknown> = {
      [CONTENT_KEY]: { build: 'b1', alive: () => { throw new Error('Extension context invalidated.'); }, dispose: () => { throw new Error('x'); } },
    };
    expect(runContent(g, 'b1', fakeRuntime().rt).n).toBe(1);
  });

  it('malformed records are not live', () => {
    expect(isLive(undefined, 'b')).toBe(false);
    expect(isLive({ build: 'b' }, 'b')).toBe(false);
    expect(isLive({ build: 'b', alive: () => 'yes' }, 'b')).toBe(false);
    expect(isLive({ build: 'b', alive: () => true }, 'b')).toBe(true);
    expect(isLive({ build: 'c', alive: () => true }, 'b')).toBe(false);
  });

  it('contextProbe reads the captured runtime, and a throwing getter means dead', () => {
    const rt = {} as { id?: string };
    Object.defineProperty(rt, 'id', { get: () => { throw new Error('Extension context invalidated.'); } });
    expect(contextProbe(rt)()).toBe(false);
    expect(contextProbe(undefined)()).toBe(false);
    expect(contextProbe({ id: 'x' })()).toBe(true);
  });

  it('claim does not call dispose on a live same-build holder', () => {
    const dispose = vi.fn();
    const rec: GuardRecord = { build: 'b', alive: () => true, dispose };
    const g: Record<string, unknown> = { k: rec };
    expect(claim(g, 'k', { build: 'b', alive: () => true })).toBe(false);
    expect(dispose).not.toHaveBeenCalled();
    expect(g.k).toBe(rec);
  });

  it('a live same-build record from another document (a replaced initial about:blank) does not block a new start', () => {
    const blank = {};
    const real = {};
    const g: Record<string, unknown> = {};
    expect(claim(g, CONTENT_KEY, { build: 'b', alive: () => true, doc: blank })).toBe(true);
    expect(claim(g, CONTENT_KEY, { build: 'b', alive: () => true, doc: real })).toBe(true);
    expect(claim(g, CONTENT_KEY, { build: 'b', alive: () => true, doc: real })).toBe(false);
    expect(isLive(g[CONTENT_KEY], 'b', blank)).toBe(false);
    expect(isLive(g[CONTENT_KEY], 'b', real)).toBe(true);
  });
});
