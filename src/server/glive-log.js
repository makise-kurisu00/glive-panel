const BODY_LIMIT = 8192;
// Server-only logs intentionally contain credentials and user data. Restrict log access.
export function createGliveLog(write = (entry) => console.log(JSON.stringify(entry))) {
  return {
    emit(event, fields) {
      // Logging failures must not change upstream request behavior.
      try {
        write({ timestamp: new Date().toISOString(), service: 'glive', event, ...fields });
      } catch {}
    },
    body(raw) {
      let value;
      let format = 'json';
      try { value = JSON.parse(raw); }
      catch { value = raw; format = 'text'; }
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
