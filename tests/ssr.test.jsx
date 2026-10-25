import { describe, expect, test } from 'bun:test';
import { createHandler } from '../server.jsx';
import { createGlive, readConfig } from '../src/server/glive.js';
import { serializeInitialData } from '../src/server/document.jsx';

const config = readConfig({ GLIVE_APIUSER: 'test-user', GLIVE_KEY: 'secret-key', GLIVE_SPORTTYPES: 'FOOTBALL,BASKETBALL' });
const match = { MatchID: '123', Name: 'SSR Test Match', Type: 'FOOTBALL', IsLive: '1' };
const fixture = {
  sports: config.sports, rows: [match], error: '', lastSync: '17/10/2026, 10.00.00',
  trace: { time: 'test', request: [], response: [] },
};

describe('SSR HTTP server', () => {
  const handler = createHandler({ config, logWriter: () => {}, glive: {
    matches: async () => fixture,
    player: async () => ({ H5LINKROW: 'https://player.example/watch' }),
  } });

  test('HTML pertama berisi data pertandingan dan bootstrap hydration', async () => {
    const response = await handler(new Request('http://localhost/'));
    const html = await response.text();
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<div class="match-name">SSR Test Match</div>');
    expect(html).toContain('id="initial-data"');
    expect(html).toContain('/assets/main.js');
    expect(html).toContain('src="https://gls.liveplugins.com/embed.js"');
    expect(html).toContain('data-site-id="gls"');
    expect(html).not.toContain('secret-key');
  });

  test('endpoint internal mengembalikan data dan menolak input invalid', async () => {
    expect(await (await handler(new Request('http://localhost/api/matches'))).json()).toEqual(fixture);
    expect((await handler(new Request('http://localhost/api/player?matchid=123&uid=abc'))).status).toBe(200);
    expect((await handler(new Request('http://localhost/api/player?matchid=../etc&uid=abc'))).status).toBe(400);
    expect((await handler(new Request('http://localhost/api.php'))).status).toBe(404);
    expect((await handler(new Request('http://localhost/', { method: 'POST' }))).status).toBe(405);
  });

  test('aset Bun tersedia dengan MIME benar', async () => {
    for (const [name, type] of [['main.js', 'text/javascript'], ['main.css', 'text/css']]) {
      const response = await handler(new Request(`http://localhost/assets/${name}`));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(type);
      expect((await response.text()).length).toBeGreaterThan(0);
    }
  });

  test('bootstrap JSON aman terhadap penutupan script dan tetap bisa dibaca', () => {
    const data = { name: '</script><script>alert(1)</script>&\u2028' };
    const serialized = serializeInitialData(data);
    expect(serialized).not.toContain('<');
    expect(JSON.parse(serialized)).toEqual(data);
  });
});

describe('GLive khusus server', () => {
  test('structured log menghubungkan request dan response tanpa redaksi server-side', async () => {
    const logs = [];
    const glive = createGlive(config, async () => Response.json({
      H5LINKROW: 'https://player.example/private-token',
      Debug: 'secret-key test-user viewer-123 127.0.0.1',
    }), (entry) => logs.push(entry));
    await glive.player('123', 'viewer-123', '127.0.0.1');
    expect(logs.map((entry) => entry.event)).toEqual(['glive.request', 'glive.response']);
    expect(logs[0].requestId).toBe(logs[1].requestId);
    expect(logs[0].params.matchid).toBe('123');
    expect(logs[1].status).toBe(200);
    expect(logs[1].durationMs).toBeGreaterThanOrEqual(0);
    expect(logs[0].params.key).toBe('secret-key');
    expect(logs[0].params.apiuser).toBe('test-user');
    expect(logs[0].params.uid).toBe('viewer-123');
    expect(logs[0].params.ip).toBe('127.0.0.1');
    expect(logs[1].body.H5LINKROW).toBe('https://player.example/private-token');
    for (const secret of ['secret-key', 'test-user', 'viewer-123', '127.0.0.1', 'private-token']) {
      expect(JSON.stringify(logs)).toContain(secret);
    }
  });

  test('structured log merekam HTML 502 dan membatasi body', async () => {
    const logs = [];
    const glive = createGlive(config, async () => new Response(`<html>${'x'.repeat(9000)}</html>`, {
      status: 502, headers: { 'cf-ray': 'test-ray', 'content-type': 'text/html' },
    }), (entry) => logs.push(entry));
    await expect(glive.player('123', 'abc', '127.0.0.1')).rejects.toThrow('GLive HTTP 502');
    expect(logs[1].status).toBe(502);
    expect(logs[1].headers['cf-ray']).toBe('test-ray');
    expect(logs[1].bodyFormat).toBe('text');
    expect(logs[1].bodyTruncated).toBe(true);
    expect(logs[1].body.length).toBe(8192);
  });

  test('structured log merekam kegagalan jaringan dan JSON invalid', async () => {
    for (const [fetcher, stage] of [
      [async () => { throw new Error('secret-key'); }, 'fetch'],
      [async () => new Response('not json'), 'parse'],
    ]) {
      const logs = [];
      const glive = createGlive(config, fetcher, (entry) => logs.push(entry));
      await expect(glive.player('123', 'abc', '127.0.0.1')).rejects.toThrow();
      expect(logs.at(-1).event).toBe('glive.error');
      expect(logs.at(-1).stage).toBe(stage);
      expect(logs[0].params.key).toBe('secret-key');
    }
  });

  test('kegagalan log writer tidak menggagalkan request', async () => {
    const glive = createGlive(config, async () => Response.json({ H5LINKROW: 'https://player.example/watch' }),
      () => { throw new Error('log unavailable'); });
    expect(await glive.player('123', 'abc', '127.0.0.1')).toEqual({ H5LINKROW: 'https://player.example/watch' });
  });

  test('partial failure, redaksi key, dan trace tanpa raw response', async () => {
    const glive = createGlive(config, async (url) => {
      expect(url.searchParams.get('key')).toBe('secret-key');
      if (url.searchParams.get('sportstype') === 'BASKETBALL') return new Response('error', { status: 503 });
      return Response.json({ Match: [{ ...match, Note: 'secret-key test-user' }], Debug: 'secret-key' });
    });
    const data = await glive.matches();
    expect(data.rows.length).toBe(1);
    expect(data.error).toContain('BASKETBALL');
    expect(JSON.stringify(data)).not.toContain('secret-key');
    expect(JSON.stringify(data)).not.toContain('test-user');
    expect(data.trace.response[0].matchCount).toBe(1);
  });

  test('geth5link memakai IP server-side dan hanya mengembalikan URL player', async () => {
    const glive = createGlive(config, async (url) => {
      expect(url.searchParams.get('action')).toBe('geth5link');
      expect(url.searchParams.get('ip')).toBe('127.0.0.1');
      return Response.json({ H5LINKROW: 'https://player.example/watch', Debug: 'secret-key' });
    });
    expect(await glive.player('123', 'abc', '127.0.0.1')).toEqual({ H5LINKROW: 'https://player.example/watch' });
  });

  test('geth5link diulang sekali saat GLive membalas 5xx', async () => {
    const statuses = [502, 200];
    let calls = 0;
    const glive = createGlive(config, async () => {
      const status = statuses[calls++];
      return status === 200
        ? Response.json({ H5LINKROW: 'https://player.example/watch' })
        : new Response('<html>Bad gateway</html>', { status });
    }, () => {});
    expect(await glive.player('123', 'abc', '127.0.0.1')).toEqual({ H5LINKROW: 'https://player.example/watch' });
    expect(calls).toBe(2);
  });

  test('geth5link tidak diulang saat GLive membalas 4xx atau gagal dua kali', async () => {
    let calls = 0;
    const notFound = createGlive(config, async () => { calls++; return new Response('nope', { status: 404 }); }, () => {});
    await expect(notFound.player('123', 'abc', '127.0.0.1')).rejects.toThrow('GLive HTTP 404');
    expect(calls).toBe(1);

    calls = 0;
    const down = createGlive(config, async () => { calls++; return new Response('down', { status: 503 }); }, () => {});
    await expect(down.player('123', 'abc', '127.0.0.1')).rejects.toThrow('GLive HTTP 503');
    expect(calls).toBe(2);
  });

  test('URL player resmi boleh mengandung nama akun API tanpa membuka API key', async () => {
    const playerUrl = 'https://www.glivestreaming.com/livetv/1/test-user/test-user/123/abc/player-token';
    const logs = [];
    const glive = createGlive(config, async () => Response.json({
      Status: 'OK', H5LINKROW: playerUrl, Debug: 'secret-key',
    }), (entry) => logs.push(entry));
    const handler = createHandler({ config, glive });
    const response = await handler(new Request('http://localhost/api/player?matchid=123&uid=abc'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ H5LINKROW: playerUrl });
  });

  test('URL player berbahaya ditolak', async () => {
    for (const url of [
      'javascript:alert(1)', 'https://player.example/?key=secret-key',
      'https://player.example/secret-key/watch', 'https://user:password@player.example/watch',
    ]) {
      const glive = createGlive(config, async () => Response.json({ H5LINKROW: url }));
      await expect(glive.player('123', 'abc', '127.0.0.1')).rejects.toThrow();
    }
  });

  test('URL player dengan API key terenkode ditolak', async () => {
    const encodedConfig = { ...config, apiKey: 'secret/key?value' };
    const glive = createGlive(encodedConfig, async () => Response.json({
      H5LINKROW: `https://player.example/${encodeURIComponent(encodedConfig.apiKey)}`,
    }), () => {});
    await expect(glive.player('123', 'abc', '127.0.0.1')).rejects.toThrow('URL player mengandung kredensial server');
  });

  test('konfigurasi kosong tidak menghubungi upstream', async () => {
    const glive = createGlive(readConfig({}), () => { throw new Error('Tidak boleh dipanggil'); });
    expect((await glive.matches()).trace.response[0].error).toContain('Konfigurasi');
  });
});

describe('structured log HTTP', () => {
  test('request FE, IP visitor, panggilan GLive, dan response terhubung lewat traceId', async () => {
    const logs = [];
    const logWriter = (entry) => logs.push(entry);
    const handler = createHandler({ config, logWriter, glive: createGlive(config, async () => new Response('bad gateway', { status: 502 }), logWriter) });
    const server = { requestIP: () => ({ address: '10.0.0.5' }) };
    const response = await handler(new Request('http://localhost/api/player?matchid=123&uid=abc', {
      headers: { 'User-Agent': 'test-browser', 'X-Forwarded-For': '203.0.113.9, 10.0.0.1', Cookie: 'session=abc' },
    }), server);
    const traceId = response.headers.get('x-trace-id');
    expect(response.status).toBe(502);
    expect(logs.map((entry) => entry.event)).toEqual(['http.request', 'glive.request', 'glive.response', 'glive.request', 'glive.response', 'http.response']);
    expect(logs.every((entry) => entry.traceId === traceId)).toBe(true);
    expect(logs[0].query).toEqual({ matchid: '123', uid: 'abc' });
    expect(logs[0].headers['user-agent']).toBe('test-browser');
    expect(logs[0].headers.cookie).toBe('session=abc');
    expect(logs[0].ip).toEqual({ client: '10.0.0.5', direct: '10.0.0.5', forwardedFor: '203.0.113.9, 10.0.0.1', realIp: '' });
    expect(logs[1].params.key).toBe('secret-key');
    expect(logs[2].body).toBe('bad gateway');
    expect(logs.at(-1)).toMatchObject({ status: 502, level: 'error', body: { error: 'GLive HTTP 502' } });
  });

  test('IP visitor diambil dari X-Forwarded-For saat TRUST_PROXY aktif', async () => {
    const logs = [];
    const proxied = { ...config, trustProxy: true };
    const handler = createHandler({ config: proxied, logWriter: (entry) => logs.push(entry), glive: { matches: async () => fixture } });
    await handler(new Request('http://localhost/api/matches', { headers: { 'X-Forwarded-For': '203.0.113.9' } }), { requestIP: () => ({ address: '10.0.0.5' }) });
    expect(logs[0].ip.client).toBe('203.0.113.9');
  });

  test('healthcheck tidak dicatat', async () => {
    const logs = [];
    const handler = createHandler({ config, logWriter: (entry) => logs.push(entry), glive: {} });
    expect((await handler(new Request('http://localhost/healthz'))).status).toBe(200);
    expect(logs).toEqual([]);
  });
});
