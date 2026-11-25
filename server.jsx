import React from 'react';
import { renderToReadableStream } from 'react-dom/server';
import Document from './src/server/document.jsx';
import { createGlive, readConfig } from './src/server/glive.js';
import { createGliveLog } from './src/server/glive-log.js';

export function createHandler({ config = readConfig(), logWriter, glive = createGlive(config, fetch, logWriter) } = {}) {
  const log = createGliveLog(logWriter);
  const assets = new Map([
    ['/assets/main.js', Bun.file(new URL('./dist/main.js', import.meta.url))],
    ['/assets/main.css', Bun.file(new URL('./dist/main.css', import.meta.url))],
  ]);
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const json = (body, status = 200) => Response.json(body, { status, headers });

  // Every non-healthcheck request is logged in full (all headers, visitor IP, response body),
  // and its traceId is attached to the GLive calls it triggers.
  return async function handler(request, server) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return handle(request, url, {});
    const traceId = crypto.randomUUID();
    const started = performance.now();
    const directIp = server?.requestIP(request)?.address || '';
    const forwardedFor = request.headers.get('x-forwarded-for') || '';
    const clientIp = (config.trustProxy && forwardedFor.split(',')[0].trim()) || directIp;
    log.emit('http.request', {
      traceId, level: 'info', method: request.method, path: url.pathname,
      query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(request.headers),
      ip: { client: clientIp, direct: directIp, forwardedFor, realIp: request.headers.get('x-real-ip') || '' },
    });
    let response;
    try {
      response = await handle(request, url, { traceId, clientIp });
    } catch (error) {
      log.emit('http.error', { traceId, level: 'error', path: url.pathname, error: error.message, stack: error.stack });
      response = json({ error: 'Server gagal memproses request' }, 500);
    }
    response.headers.set('X-Trace-Id', traceId);
    const fields = {
      traceId, level: response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info',
      method: request.method, path: url.pathname, status: response.status,
      durationMs: Math.round(performance.now() - started), headers: Object.fromEntries(response.headers),
    };
    if (response.headers.get('content-type')?.includes('application/json')) {
      Object.assign(fields, log.body(await response.clone().text()));
    }
    log.emit('http.response', fields);
    return response;
  };

  async function handle(request, url, { traceId, clientIp }) {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method Not Allowed', { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
    }
    if (assets.has(url.pathname)) {
      const file = assets.get(url.pathname);
      if (!await file.exists()) return new Response('Assets belum dibangun. Jalankan bun run build.', { status: 503, headers });
      return new Response(request.method === 'HEAD' ? null : file, { headers: {
        ...headers,
        'Content-Type': url.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
      } });
    }
    if (url.pathname === '/healthz') return new Response(request.method === 'HEAD' ? null : 'ok', { headers });
    if (request.method === 'HEAD') {
      const status = ['/', '/api/matches', '/api/player'].includes(url.pathname) ? 200 : 404;
      return new Response(null, { status, headers });
    }
    try {
      if (url.pathname === '/api/matches') return json(await glive.matches(traceId));
      if (url.pathname === '/api/player') {
        const matchId = url.searchParams.get('matchid') || '';
        const uid = url.searchParams.get('uid') || '';
        if (!/^[\w-]{1,128}$/.test(matchId) || !/^[\w-]{1,128}$/.test(uid)) {
          return json({ error: 'matchid atau uid tidak valid' }, 400);
        }
        try {
          return json(await glive.player(matchId, uid, clientIp, traceId));
        } catch (error) {
          return json({ error: error.message }, 502);
        }
      }
      if (url.pathname !== '/') return new Response('Not Found', { status: 404, headers });
      const data = await glive.matches(traceId);
      const stream = await renderToReadableStream(<Document data={data} />, {
        signal: request.signal,
        onError(error) { log.emit('ssr.error', { traceId, level: 'error', error: error.message, stack: error.stack }); },
      });
      return new Response(stream, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (error) {
      log.emit('http.error', { traceId, level: 'error', path: url.pathname, error: error.message, stack: error.stack });
      return json({ error: 'Server gagal memproses request' }, 500);
    }
  }
}

if (import.meta.main) {
  for (const name of ['main.js', 'main.css']) {
    if (!await Bun.file(new URL(`./dist/${name}`, import.meta.url)).exists()) {
      throw new Error('Assets belum dibangun. Jalankan bun run build sebelum bun run start.');
    }
  }
  const server = Bun.serve({
    hostname: process.env.HOST || '0.0.0.0',
    port: Number(process.env.PORT || 6663),
    idleTimeout: 30,
    fetch: createHandler(),
  });
  console.log(`GLive SSR berjalan di ${server.url}`);
}
