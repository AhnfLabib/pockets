/** A recording stand-in for CanvasRenderingContext2D: logs calls and property sets in order. */
export interface Call { op: string; args: unknown[]; shadow: { color: string; blur: number; offsetY: number } }

export function fakeContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {
    shadowColor: 'rgba(0, 0, 0, 0)', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    font: '10px sans-serif', textBaseline: 'alphabetic', textAlign: 'start', globalAlpha: 1,
  };
  const stack: Record<string, unknown>[] = [];
  const record = (op: string, args: unknown[]): void => {
    calls.push({
      op, args,
      shadow: {
        color: String(state.shadowColor), blur: Number(state.shadowBlur), offsetY: Number(state.shadowOffsetY),
      },
    });
  };
  const methods: Record<string, (...a: unknown[]) => unknown> = {
    save: () => { stack.push({ ...state }); record('save', []); },
    restore: () => { const s = stack.pop(); if (s) Object.assign(state, s); record('restore', []); },
    measureText: (s: unknown) => ({ width: String(s).length * 5.5 }),
  };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, key: string) {
      if (key in methods) return methods[key];
      if (key in state) return state[key];
      return (...args: unknown[]) => record(key, args);
    },
    set(_t, key: string, value: unknown) {
      state[key] = value;
      record('set:' + key, [value]);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}
