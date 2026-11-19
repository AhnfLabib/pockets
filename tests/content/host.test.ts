// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { startContent, type HostEnv } from '../../src/content/host';

const plan = { visitId: 'v1' } as never;

function setup(over: Partial<HostEnv> = {}, win: Window = window) {
  let handler!: (m: unknown, r: (x: unknown) => void) => boolean | void;
  const stage = { play: vi.fn().mockResolvedValue(undefined), showNotice: vi.fn(), cancel: vi.fn(), destroy: vi.fn() };
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

  it('child frames ignore ping but still report typing', async () => {
    const child = { top: {} } as unknown as Window;
    const { handler, sendMessage } = setup({}, child);
    expect(handler()).toBeUndefined();
    document.body.innerHTML = '<input id="t">';
    document.getElementById('t')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'pockets/typed' });
  });
});
