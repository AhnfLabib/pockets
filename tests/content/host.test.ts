// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { startContent, type ContentHandle, type HostEnv } from '../../src/content/host';

const plan = { visitId: 'v1' } as never;

function fakeStage(connected = true) {
  return { play: vi.fn().mockResolvedValue(undefined), showNotice: vi.fn(), cancel: vi.fn(), destroy: vi.fn(), connected: vi.fn(() => connected) };
}

let lastHandle: ContentHandle | null = null;
let lastWin: Window | null = null;

/** A child frame's window: an event target whose top is some other window. */
function childWin(): Window {
  return Object.assign(new EventTarget(), { top: {}, setTimeout: (f: () => void, ms: number) => setTimeout(f, ms) }) as unknown as Window;
}
/** A top frame's window, separate from jsdom's so its listeners do not leak between tests. */
function topWin(): Window {
  const w = Object.assign(new EventTarget(), { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms) }) as unknown as Window & { top: Window };
  (w as { top: Window }).top = w;
  return w;
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
  lastHandle = startContent(env);
  lastWin = win;
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

  it('content.js never sends page-loaded (content-start.js does, at document_start)', async () => {
    const { sendMessage, call } = setup();
    await call({ type: 'pockets/ping' });
    await call({ type: 'pockets/play', plan });
    expect(sendMessage.mock.calls.some(([m]) => m.type === 'pockets/page-loaded')).toBe(false);
  });

  it('a child frame never sends page-loaded', () => {
    const { sendMessage } = setup({}, childWin());
    expect(sendMessage.mock.calls.some(([m]) => m.type === 'pockets/page-loaded')).toBe(false);
  });

  it('child frames ignore ping but still report typing', async () => {
    const { handler, sendMessage } = setup({}, childWin());
    expect(handler()).toBeUndefined();
    document.body.innerHTML = '<input id="t">';
    document.getElementById('t')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'pockets/typed' });
  });
});

const sent = (m: { mock: { calls: unknown[][] } }, type: string) => m.mock.calls.filter(([x]) => (x as { type: string }).type === type).length;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('content host: injected into a tab open before install (typing unknown)', () => {
  it('the injected top frame reports typed at once and never page-loaded', async () => {
    const { sendMessage, call } = setup({ typingUnknown: true });
    await flush();
    expect(sent(sendMessage, 'pockets/typed')).toBe(1);
    expect(sent(sendMessage, 'pockets/page-loaded')).toBe(0);
    // It still hosts the stage.
    expect(await call({ type: 'pockets/play', plan })).toEqual({ ok: true });
  });

  it('retries the unknown-typing report when the send fails, a bounded number of times', async () => {
    const sendMessage = vi.fn().mockRejectedValueOnce(new Error('no worker')).mockResolvedValue(undefined);
    setup({ typingUnknown: true, sendMessage, retryMs: 1 });
    await vi.waitFor(() => expect(sent(sendMessage, 'pockets/typed')).toBe(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(sent(sendMessage, 'pockets/typed')).toBe(2);
    const failing = vi.fn().mockRejectedValue(new Error('dead'));
    setup({ typingUnknown: true, sendMessage: failing, retryMs: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent(failing, 'pockets/typed')).toBe(5);
  });

  it('a declared (seen-start) top frame does not report typing on its own', async () => {
    const { sendMessage } = setup({ typingUnknown: false });
    await flush();
    expect(sent(sendMessage, 'pockets/typed')).toBe(0);
  });

  it('a child frame ignores typingUnknown (the top frame speaks for the tab)', async () => {
    const { sendMessage } = setup({ typingUnknown: true }, childWin());
    await flush();
    expect(sent(sendMessage, 'pockets/typed')).toBe(0);
  });

  it('removes stage hosts an orphaned instance left in the page', () => {
    document.body.innerHTML = '';
    document.documentElement.appendChild(document.createElement('pockets-stage'));
    setup();
    expect(document.querySelectorAll('pockets-stage').length).toBe(0);
  });

  it('dispose stops typing reports, ignores messages and destroys the stage', async () => {
    const { sendMessage, call, stage, env, handler } = setup();
    await call({ type: 'pockets/play', plan });
    void env;
    lastHandle!.dispose();
    expect(stage.destroy).toHaveBeenCalledTimes(1);
    expect(handler()({ type: 'pockets/ping' }, () => {})).toBe(false);
    document.body.innerHTML = '<input id="t">';
    document.getElementById('t')!.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    expect(sent(sendMessage, 'pockets/typed')).toBe(0);
  });
});

function pageEvent(type: 'pageshow' | 'pagehide', persisted: boolean): Event {
  return Object.assign(new Event(type), { persisted });
}

describe('content host: back/forward cache', () => {
  it('a restored page that was typed into reports typed again', async () => {
    const { sendMessage } = setup({}, childWin());
    document.body.innerHTML = '<input id="t">';
    document.getElementById('t')!.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    expect(sent(sendMessage, 'pockets/typed')).toBe(1);
    lastWin!.dispatchEvent(pageEvent('pageshow', true));
    await flush();
    expect(sent(sendMessage, 'pockets/typed')).toBe(2);
  });

  it('a restored page that was never typed into reports nothing; a normal pageshow reports nothing', async () => {
    const { sendMessage } = setup({}, childWin());
    lastWin!.dispatchEvent(pageEvent('pageshow', true));
    await flush();
    expect(sent(sendMessage, 'pockets/typed')).toBe(0);
    document.body.innerHTML = '<input id="t">';
    document.getElementById('t')!.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    lastWin!.dispatchEvent(pageEvent('pageshow', false));
    await flush();
    expect(sent(sendMessage, 'pockets/typed')).toBe(1);
  });

  it('counts typing whose send failed, and re-reports it on restore', async () => {
    const sendMessage = vi.fn().mockRejectedValueOnce(new Error('no')).mockResolvedValue(undefined);
    setup({ sendMessage, retryMs: 1 }, childWin());
    document.body.innerHTML = '<input id="t">';
    document.getElementById('t')!.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    lastWin!.dispatchEvent(pageEvent('pageshow', true));
    await vi.waitFor(() => expect(sent(sendMessage, 'pockets/typed')).toBe(2));
  });

  it('the top frame also re-reports, and never sends page-loaded on restore', async () => {
    const top = topWin();
    const { sendMessage } = setup({}, top);
    document.body.innerHTML = '<input id="t">';
    document.getElementById('t')!.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    top.dispatchEvent(pageEvent('pagehide', true));
    top.dispatchEvent(pageEvent('pageshow', true));
    await flush();
    expect(sent(sendMessage, 'pockets/typed')).toBe(2);
    expect(sent(sendMessage, 'pockets/page-loaded')).toBe(0);
  });

  it('pagehide into the cache cancels the playing visit; on restore a dead stage is replaced', async () => {
    const top = topWin();
    const first = fakeStage();
    const second = fakeStage();
    const mount = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { call } = setup({ mountStage: mount }, top);
    await call({ type: 'pockets/play', plan });
    top.dispatchEvent(pageEvent('pagehide', true));
    expect(first.cancel).toHaveBeenCalledTimes(1);
    first.connected.mockReturnValue(false);
    top.dispatchEvent(pageEvent('pageshow', true));
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(await call({ type: 'pockets/play', plan: { visitId: 'v2' } })).toEqual({ ok: true });
    expect(second.play).toHaveBeenCalledTimes(1);
  });

  it('a non-persisted pagehide (real unload) does not cancel', async () => {
    const top = topWin();
    const { call, stage } = setup({}, top);
    await call({ type: 'pockets/play', plan });
    top.dispatchEvent(pageEvent('pagehide', false));
    expect(stage.cancel).not.toHaveBeenCalled();
  });
});
