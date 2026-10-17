export function readConfig(env = process.env) {
  return {
    apiUser: env.GLIVE_APIUSER || '',
    apiKey: env.GLIVE_KEY || '',
    sports: [...new Set((env.GLIVE_SPORTTYPES || 'FOOTBALL').split(',').map((sport) => sport.trim().toUpperCase()).filter(Boolean))],
    brand: env.GLIVE_BRAND || env.GLIVE_APIUSER || 'nobarid',
    lang: env.GLIVE_LANG || 'EN',
    ip: env.GLIVE_IP || '',
    trustProxy: env.TRUST_PROXY === 'true',
  };
}

export function createGlive(config, fetcher = fetch) {
  // Never forward upstream URLs, headers, raw errors or bodies to browser logs.
  async function request(action, params) {
    if (!config.apiUser || !config.apiKey) throw new Error('Konfigurasi GLIVE_APIUSER dan GLIVE_KEY belum lengkap');
    const url = new URL('https://www.glivestreaming.com/api.php');
    url.search = new URLSearchParams({
      action, apiuser: config.apiUser, key: config.apiKey, format: 'JSON',
      ...params, _ts: String(Date.now()),
    }).toString();
    let response;
    try {
      response = await fetcher(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'yaak', 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
    } catch {
      throw new Error('GLive tidak dapat dihubungi atau melewati batas waktu');
    }
    if (!response.ok) throw new Error(`GLive HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
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
    const data = await request('geth5link', {
      matchid: matchId, uid, brand: config.brand, lang: config.lang, ip: config.ip || clientIp,
    });
    let url;
    try {
      url = new URL(data?.H5LINKROW);
    } catch {
      throw new Error('Response GLive tidak memiliki URL player valid');
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Protokol atau kredensial URL player tidak diizinkan');
    }
    if (sanitize(url.href) !== url.href) throw new Error('URL player mengandung kredensial server');
    return { H5LINKROW: url.href };
  }

  return { matches, player };
}
