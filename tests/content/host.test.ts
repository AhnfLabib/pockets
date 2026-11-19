// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { startContent, type HostEnv } from '../../src/content/host';

const plan = { visitId: 'v1' } as never;

function fakeStage(connected = true) {
  return { play: vi.fn().mockResolvedValue(undefined), showNotice: vi.fn(), cancel: vi.fn(), destroy: vi.fn(), connected: vi.fn(() => connected) };
}

function setup(over: Partial<HostEnv> = {}, win: Window = window) {
  let handler!: (m: unknown, r: (x: unknown) => void) => boolean | void;
  const stage = fakeStage();
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const env: HostEnv = {
    win, doc: document, assetBase: 'x/', iconUrl: 'i', sendMessage,
    onMessage: (fn) => { handler = fn; },
    mountStage: vi.fn().mockResolvedValue(stage),
    ...over,
  };
  startContent(env);
  const call = (m: unknown) => new Promise<unknown>((res) => { const sync = handler(m, res); if (sync !== true) { /* responded synchronously */ } });
  return { stage, sendMessage, call, env, handler: () => handler };
}

describe('content host', () => {
  it('answers ping in the top frame', async () => {
    const { call } = setup();
    expect(await call({ type: 'pockets/ping' })).toEqual({ type: 'pockets/pong', from: 'content' });
  });

  it('play replies ok:true once mounted, ok:false if mounting fails', async () => {
    const a = setup();
    expect(await a.call({ type: 'pockets/play', plan })).toEqual({ ok: true });
    expect(a.stage.play).toHaveBeenCalled();
    const b = setup({ mountStage: vi.fn().mockRejectedValue(new Error('no')) });
    expect(await b.call({ type: 'pockets/play', plan })).toEqual({ ok: false });
  });

  it('a cancel delivered before the mount resolves means play is never called', async () => {
    let resolve!: (s: never) => void;
    const mount = vi.fn().mockReturnValue(new Promise((r) => { resolve = r; }));
    const { call, stage } = setup({ mountStage: mount });
    const p = call({ type: 'pockets/play', plan });
    await call({ type: 'pockets/cancel', visitId: 'v1' });
    resolve(stage as never);
    await p;
    expect(stage.play).not.toHaveBeenCalled();
  });

  it('reuses a cached stage while its host element is still in the page', async () => {
    const { call, stage, env } = setup();
    await call({ type: 'pockets/play', plan });
    await call({ type: 'pockets/play', plan: { visitId: 'v2' } });
    expect(env.mountStage).toHaveBeenCalledTimes(1);
    expect(stage.play).toHaveBeenCalledTimes(2);
    expect(stage.destroy).not.toHaveBeenCalled();
  });

  it('a cached stage whose host element the page removed is destroyed and a fresh one mounted', async () => {
    const first = fakeStage();
    const second = fakeStage();
    const mount = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { call } = setup({ mountStage: mount });
    await call({ type: 'pockets/play', plan });
    expect(first.play).toHaveBeenCalledTimes(1);
    first.connected.mockReturnValue(false); // the page removed <pockets-stage>
    expect(await call({ type: 'pockets/play', plan: { visitId: 'v2' } })).toEqual({ ok: true });
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledTimes(2);
    expect(first.play).toHaveBeenCalledTimes(1);
    expect(second.play).toHaveBeenCalledTimes(1);
    // The notice also goes to the fresh stage.
    await call({ type: 'pockets/notice', title: 'x', takenAt: 1 });
    expect(second.showNotice).toHaveBeenCalledTimes(1);
    expect(first.showNotice).not.toHaveBeenCalled();
  });

  it('child frames ignore ping but still report typing', async () => {
    const child = { top: {} } as unknown as Window;
    const { handler, sendMessage } = setup({}, child);
    expect(handler()).toBeUndefined();
    document.body.innerHTML = '<input id="t">';
    document.getElementById('t')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'pockets/typed' });
  });
});
