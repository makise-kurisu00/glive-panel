import React from 'react';
import { renderToReadableStream } from 'react-dom/server';
import Document from './src/server/document.jsx';
import { createGlive, readConfig } from './src/server/glive.js';

export function createHandler({ config = readConfig(), glive = createGlive(config) } = {}) {
  const assets = new Map([
    ['/assets/main.js', Bun.file(new URL('./dist/main.js', import.meta.url))],
    ['/assets/main.css', Bun.file(new URL('./dist/main.css', import.meta.url))],
  ]);
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const json = (body, status = 200) => Response.json(body, { status, headers });

  return async function handler(request, server) {
    const url = new URL(request.url);
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
      if (url.pathname === '/api/matches') return json(await glive.matches());
      if (url.pathname === '/api/player') {
        const matchId = url.searchParams.get('matchid') || '';
        const uid = url.searchParams.get('uid') || '';
        if (!/^[\w-]{1,128}$/.test(matchId) || !/^[\w-]{1,128}$/.test(uid)) {
          return json({ error: 'matchid atau uid tidak valid' }, 400);
        }
        const directIp = server?.requestIP(request)?.address || '';
        const forwardedIp = config.trustProxy ? request.headers.get('x-forwarded-for')?.split(',')[0].trim() : '';
        try {
          return json(await glive.player(matchId, uid, forwardedIp || directIp));
        } catch (error) {
          return json({ error: error.message }, 502);
        }
      }
      if (url.pathname !== '/') return new Response('Not Found', { status: 404, headers });
      const data = await glive.matches();
      const stream = await renderToReadableStream(<Document data={data} />, {
        signal: request.signal,
        onError(error) { console.error('SSR gagal:', error); },
      });
      return new Response(stream, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (error) {
      console.error('Request gagal:', error);
      return json({ error: 'Server gagal memproses request' }, 500);
    }
  };
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
