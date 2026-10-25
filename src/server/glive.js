import { createGliveLog } from './glive-log.js';

export function readConfig(env = process.env) {
  return {
    apiUser: env.GLIVE_APIUSER || '',
    apiKey: env.GLIVE_KEY || '',
    baseUrl: (env.GLIVE_BASE_URL || 'https://www.glivestreaming.com').replace(/\/+$/, ''),
    sports: [...new Set((env.GLIVE_SPORTTYPES || 'FOOTBALL').split(',').map((sport) => sport.trim().toUpperCase()).filter(Boolean))],
    brand: env.GLIVE_BRAND || env.GLIVE_APIUSER || 'nobarid',
    lang: env.GLIVE_LANG || 'EN',
    ip: env.GLIVE_IP || '',
    trustProxy: env.TRUST_PROXY === 'true',
  };
}

export function createGlive(config, fetcher = fetch, logWriter) {
  // Raw upstream logs stay server-side; never forward them to browser logs.
  async function request(action, params) {
    const log = createGliveLog(logWriter);
    const requestId = crypto.randomUUID();
    const started = performance.now();
    const common = { requestId, action };
    if (!config.apiUser || !config.apiKey) {
      log.emit('glive.error', { ...common, level: 'error', stage: 'config', error: 'Konfigurasi GLIVE_APIUSER dan GLIVE_KEY belum lengkap' });
      throw new Error('Konfigurasi GLIVE_APIUSER dan GLIVE_KEY belum lengkap');
    }
    const url = new URL(`${config.baseUrl}/api.php`);
    url.search = new URLSearchParams({
      action, apiuser: config.apiUser, key: config.apiKey, format: 'JSON',
      ...params, _ts: String(Date.now()),
    }).toString();
    const headers = { Accept: 'application/json', 'User-Agent': 'yaak', 'Cache-Control': 'no-cache' };
    log.emit('glive.request', {
      ...common, level: 'info', method: 'GET', endpoint: `${url.origin}${url.pathname}`,
      params: Object.fromEntries(url.searchParams), headers, timeoutMs: 15_000,
    });
    let response;
    let raw;
    try {
      response = await fetcher(url, {
        headers,
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
      raw = await response.text();
    } catch {
      log.emit('glive.error', {
        ...common, level: 'error', stage: response ? 'read' : 'fetch',
        durationMs: Math.round(performance.now() - started), status: response?.status ?? null,
        error: 'GLive tidak dapat dihubungi atau melewati batas waktu',
      });
      throw new Error('GLive tidak dapat dihubungi atau melewati batas waktu');
    }
    log.emit('glive.response', {
      ...common, level: response.ok ? 'info' : 'error', status: response.status,
      durationMs: Math.round(performance.now() - started),
      headers: Object.fromEntries(['content-type', 'cf-ray', 'x-request-id']
        .map((name) => [name, response.headers.get(name)]).filter(([, value]) => value !== null)),
      ...log.body(raw),
    });
    if (!response.ok) {
      const error = new Error(`GLive HTTP ${response.status}`);
      error.upstreamStatus = response.status;
      throw error;
    }
    try {
      return JSON.parse(raw);
    } catch {
      log.emit('glive.error', {
        ...common, level: 'error', stage: 'parse', status: response.status,
        durationMs: Math.round(performance.now() - started), error: 'Response GLive bukan JSON valid',
      });
      throw new Error('Response GLive bukan JSON valid');
    }
  }

  // Redact secrets even if upstream echoes them inside match fields or player URLs.
  function sanitize(value) {
    let text = JSON.stringify(value);
    for (const secret of [config.apiKey, config.apiUser].filter(Boolean)) {
      for (const form of new Set([secret, encodeURIComponent(secret)])) {
        text = text.replaceAll(JSON.stringify(form).slice(1, -1), '[REDACTED]');
      }
    }
    return JSON.parse(text);
  }

  async function matches() {
    const results = await Promise.all(config.sports.map(async (sport) => {
      try {
        const data = await request('getmatch', { sportstype: sport });
        if (!Array.isArray(data?.Match)) throw new Error('Response GLive tidak memiliki daftar Match');
        const rows = data.Match.filter((match) => match && typeof match === 'object' && !Array.isArray(match))
          .map((match) => ({ ...match, Type: match.Type || sport }));
        return { sport, ok: true, rows: sanitize(rows) };
      } catch (error) {
        return { sport, ok: false, rows: [], error: error.message };
      }
    }));
    const failed = results.filter((result) => !result.ok);
    const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    return {
      sports: config.sports,
      rows: results.flatMap((result) => result.rows),
      lastSync: time,
      error: failed.length ? `${failed.length} dari ${config.sports.length} sport gagal diambil: ${failed.map((result) => result.sport).join(', ')}` : '',
      trace: {
        time,
        request: config.sports.map((sport) => ({ method: 'GET', endpoint: 'GLive getmatch', sport })),
        response: results.map(({ rows, ...result }) => ({ ...result, matchCount: rows.length })),
      },
    };
  }

  async function player(matchId, uid, clientIp) {
    const params = { matchid: matchId, uid, brand: config.brand, lang: config.lang, ip: config.ip || clientIp };
    let data;
    try {
      data = await request('geth5link', params);
    } catch (error) {
      // GLive sometimes answers 5xx for a moment; one retry. Timeouts are not retried so the
      // total wait stays under Bun's 30s idleTimeout.
      if (!(error.upstreamStatus >= 500)) throw error;
      data = await request('geth5link', params);
    }
    let url;
    try {
      url = new URL(data?.H5LINKROW);
    } catch {
      throw new Error('Response GLive tidak memiliki URL player valid');
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Protokol atau kredensial URL player tidak diizinkan');
    }
    // GLive includes the API account name in legitimate player paths, but never the API key.
    const keyForms = config.apiKey ? [config.apiKey, encodeURIComponent(config.apiKey)] : [];
    if (keyForms.some((key) => url.href.includes(key))) {
      throw new Error('URL player mengandung kredensial server');
    }
    return { H5LINKROW: url.href };
  }

  return { matches, player };
}
