// Playwright fixtures that load the built extension from dist/ into a persistent Chromium.
//
// Exports `test` with:
//   context     persistent Chromium context with dist/ loaded as an unpacked extension
//   worker      the extension's service worker
//   userDataDir the profile directory behind `context` (fresh per test)
//   server      a local HTTP server for test pages (test-side only; the extension makes no requests)
//
// `launchExtensionContext` is exported so a test can close and relaunch on the same profile.
//
// `launchRawExtensionBrowser` starts the same Chromium without Playwright's page handling. It talks
// CDP over a pipe and attaches only to the extension's service worker. Two things need it, both
// found in Task 1 (see docs/verification.md):
//   - Playwright keeps every page it attaches to "visible", so a real background tab can only be
//     seen with this helper (document.visibilityState is "hidden" here, "visible" under Playwright).
//   - chrome.tabs.discard crashes Chromium (SIGSEGV) while Playwright is attached to the pages.
import { test as base, chromium, expect, type BrowserContext, type Worker } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

export const DIST = resolve(process.cwd(), 'dist');

export async function launchExtensionContext(
  userDataDir: string,
  extraArgs: string[] = [],
): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    // The full Chromium build in headless mode ("new headless") can load extensions.
    channel: 'chromium',
    // POCKETS_HEADED=1 runs headed (use under xvfb-run -a in a container). Results match headless.
    headless: !process.env.POCKETS_HEADED,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, ...extraArgs],
  });
}

export async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
  if (existing) return existing;
  return context.waitForEvent('serviceworker', {
    predicate: (w) => w.url().startsWith('chrome-extension://'),
  });
}

export interface RawExtensionBrowser {
  /** Evaluate `fn(arg)` in the extension's service worker and return its JSON-serialisable result. */
  evaluate<A, R>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  /** Whether Chromium printed a crash signal on stderr. */
  crashed(): boolean;
  close(): Promise<void>;
}

export async function launchRawExtensionBrowser(userDataDir: string): Promise<RawExtensionBrowser> {
  const args = [
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-component-extensions-with-background-pages',
    '--remote-debugging-pipe',
    `--user-data-dir=${userDataDir}`,
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    'about:blank',
  ];
  if (!process.env.POCKETS_HEADED) args.unshift('--headless');
  const proc = spawn(chromium.executablePath(), args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let crashed = false;
  proc.stderr!.on('data', (d: Buffer) => {
    if (/SEGV|Received signal/.test(d.toString())) crashed = true;
  });
  const toBrowser = proc.stdio[3] as NodeJS.WritableStream;
  const fromBrowser = proc.stdio[4] as NodeJS.ReadableStream;

  let nextId = 0;
  let buffer = '';
  const pending = new Map<number, (msg: any) => void>();
  fromBrowser.on('data', (d: Buffer) => {
    buffer += d.toString();
    let end: number;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
      }
    }
  });
  const send = (method: string, params: object = {}, sessionId?: string, timeoutMs = 30_000) =>
    new Promise<any>((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => reject(new Error(`CDP ${method} timed out`)), timeoutMs);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`CDP ${method}: ${msg.error.message}`));
        else resolve(msg.result);
      });
      toBrowser.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });

  // Find the worker and attach. Headed, the worker is sometimes replaced just after startup and a
  // session on the old one never answers, so check the session with a short probe and re-attach.
  let sessionId: string | undefined;
  for (let attempt = 0; attempt < 10 && !sessionId; attempt++) {
    const { targetInfos } = await send('Target.getTargets');
    const target = targetInfos.find(
      (t: { type: string; url: string }) =>
        t.type === 'service_worker' && t.url.startsWith('chrome-extension://') && t.url.endsWith('/background.js'),
    );
    if (!target) {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    try {
      await send('Runtime.evaluate', { expression: 'chrome.runtime.id', returnByValue: true }, attached.sessionId, 2000);
      sessionId = attached.sessionId;
    } catch {
      await send('Target.detachFromTarget', { sessionId: attached.sessionId }).catch(() => {});
    }
  }
  if (!sessionId) throw new Error('could not attach to the extension service worker');

  return {
    async evaluate(fn, arg) {
      const result = await send(
        'Runtime.evaluate',
        { expression: `(${fn.toString()})(${JSON.stringify(arg)})`, awaitPromise: true, returnByValue: true },
        sessionId,
      );
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      }
      return result.result.value;
    },
    crashed: () => crashed,
    async close() {
      const exited = new Promise<void>((r) => proc.once('exit', () => r()));
      try {
        await Promise.race([send('Browser.close'), new Promise((r) => setTimeout(r, 3000))]);
      } catch {
        // already gone
      }
      proc.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    },
  };
}

export type Route = (req: IncomingMessage, res: ServerResponse) => void;

export interface TestServer {
  origin: string;
  /** Register or replace a handler for an exact path. */
  route(path: string, handler: Route): void;
}

function defaultPage(path: string): string {
  const name = path.replace(/[^a-z0-9-]/gi, '') || 'root';
  return `<!doctype html><html><head><title>page ${name}</title></head><body><h1>${name}</h1></body></html>`;
}

export const test = base.extend<
  { context: BrowserContext; worker: Worker; userDataDir: string },
  { server: TestServer }
>({
  server: [
    async ({}, use) => {
      const routes = new Map<string, Route>();
      const httpServer: Server = createServer((req, res) => {
        const path = (req.url ?? '/').split('?')[0];
        const handler = routes.get(path);
        if (handler) return handler(req, res);
        if (path === '/favicon.ico') {
          res.writeHead(404);
          return res.end();
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(defaultPage(path));
      });
      await new Promise<void>((done) => httpServer.listen(0, '127.0.0.1', done));
      const { port } = httpServer.address() as AddressInfo;
      await use({
        origin: `http://127.0.0.1:${port}`,
        route: (path, handler) => routes.set(path, handler),
      });
      await new Promise<void>((done) => httpServer.close(() => done()));
    },
    { scope: 'worker' },
  ],

  userDataDir: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'pockets-profile-'));
    await use(dir);
    await rm(dir, { recursive: true, force: true });
  },

  context: async ({ userDataDir }, use) => {
    const context = await launchExtensionContext(userDataDir);
    await use(context);
    await context.close().catch(() => {});
  },

  worker: async ({ context }, use) => {
    await use(await getServiceWorker(context));
  },
});

export { expect };
