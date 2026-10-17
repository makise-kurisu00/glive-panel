const BODY_LIMIT = 8192;
const PRIVATE_FIELD = /^(key|apiuser|uid|ip|h5linkrow|authorization|cookie|set-cookie|token|.*password.*|.*secret.*)$/i;

export function createGliveLog(config, params, write = (entry) => console.log(JSON.stringify(entry))) {
  const secrets = [config.apiKey, config.apiUser, params.uid, params.ip].filter(Boolean)
    .flatMap((value) => [String(value), encodeURIComponent(value)])
    .sort((a, b) => b.length - a.length);

  function text(value) {
    let result = value;
    for (const secret of secrets) result = result.replaceAll(secret, '[REDACTED]');
    // Player URLs can contain credentials in path segments as well as query strings.
    return result.replace(/https?:\/\/[^\s<>"']+/gi, '[REDACTED_URL]');
  }

  function redact(value) {
    if (typeof value === 'string') return text(value);
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        text(key), PRIVATE_FIELD.test(key) ? '[REDACTED]' : redact(item),
      ]));
    }
    return value;
  }

  return {
    emit(event, fields) {
      // Logging failures must not change upstream request behavior.
      try {
        write({ timestamp: new Date().toISOString(), service: 'glive', event, ...fields });
      } catch {}
    },
    redact,
    body(raw) {
      let value;
      let format = 'json';
      try { value = redact(JSON.parse(raw)); }
      catch { value = text(raw); format = 'text'; }
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      const truncated = serialized.length > BODY_LIMIT;
      return {
        body: truncated ? serialized.slice(0, BODY_LIMIT) : value,
        bodyFormat: format,
        bodyBytes: new TextEncoder().encode(raw).length,
        bodyTruncated: truncated,
      };
    },
  };
}
