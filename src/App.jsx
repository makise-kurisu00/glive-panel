import { useEffect, useMemo, useState } from 'react';

const API_PATH =
  '/api.php?action=getmatch&apiuser=nobarid&key=&sportstype=FOOTBALL&format=JSON';

function formatLogValue(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function App() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState([]);
  const [lastSync, setLastSync] = useState('');

  const addLog = (type, payload) => {
    setLogs((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        time: new Date().toLocaleString('id-ID'),
        type,
        payload,
      },
      ...prev,
    ]);
  };

  const sync = async () => {
    setLoading(true);
    setError('');

    const requestTrace = {
      method: 'GET',
      url: API_PATH,
      headers: {
        Accept: '*/*',
      },
      body: null,
      note: 'Browser fetch tidak bisa set header User-Agent manual.',
    };

    addLog('request', requestTrace);

    try {
      const response = await fetch(API_PATH, {
        method: 'GET',
        headers: {
          Accept: '*/*',
        },
      });

      const rawBody = await response.clone().text();

      addLog('response', {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: rawBody,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }

      const data = JSON.parse(rawBody);
      const matchRows = Array.isArray(data.Match) ? data.Match : [];

      setRows(matchRows);
      setLastSync(new Date().toLocaleString('id-ID'));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal mengambil data';
      setError(message);
      setRows([]);
      addLog('error', {
        message,
        stack: err instanceof Error ? err.stack : null,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    sync();
  }, []);

  const totalLive = useMemo(
    () => rows.filter((item) => item.IsLive === '1' || item.NowPlaying === 1).length,
    [rows]
  );

  return (
    <div className="page">
      <div className="container">
        <div className="hero">
          <div>
            <h1>Panel Jadwal GLive</h1>
            <p>Ambil data jadwal football lalu tampilkan tanpa database.</p>
          </div>
          <button type="button" onClick={sync} disabled={loading}>
            {loading ? 'Sinkron...' : 'Sync Data'}
          </button>
        </div>

        <div className="stats">
          <div className="card">
            <span>Total Match</span>
            <strong>{rows.length}</strong>
          </div>
          <div className="card">
            <span>Sedang Live</span>
            <strong>{totalLive}</strong>
          </div>
          <div className="card">
            <span>Last Sync</span>
            <strong>{lastSync || '-'}</strong>
          </div>
        </div>

        {error ? <div className="alert">{error}</div> : null}

        <div className="panel">
          <div className="panel-head">
            <h2>Jadwal</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>MatchID</th>
                  <th>Start</th>
                  <th>Stop</th>
                  <th>Channel</th>
                  <th>Match</th>
                  <th>League</th>
                  <th>State</th>
                  <th>Live</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((item) => (
                    <tr key={item.MatchID}>
                      <td>{item.MatchID}</td>
                      <td>{item.TimeStart || '-'}</td>
                      <td>{item.TimeStop || '-'}</td>
                      <td>{item.Channel || '-'}</td>
                      <td>
                        <div className="match-name">{item.Name || '-'}</div>
                        <div className="teams">
                          {item.Home || '-'} vs {item.Away || '-'}
                        </div>
                      </td>
                      <td>{item.League || '-'}</td>
                      <td>{item.State || '-'}</td>
                      <td>
                        <span className={item.IsLive === '1' ? 'badge live' : 'badge'}>
                          {item.IsLive === '1' ? 'Live' : 'Off'}
                        </span>
                      </td>
                      <td>
                        {item.HomeScore || '-'} : {item.AwayScore || '-'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="9" className="empty">
                      {loading ? 'Mengambil data...' : 'Tidak ada data'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Browser Logs</h2>
            <span>{logs.length} entri</span>
          </div>
          <div className="logs">
            {logs.length ? (
              logs.map((entry) => (
                <div key={entry.id} className="log-item">
                  <div className="log-meta">
                    <strong>{entry.type.toUpperCase()}</strong>
                    <span>{entry.time}</span>
                  </div>
                  <pre>{formatLogValue(entry.payload)}</pre>
                </div>
              ))
            ) : (
              <div className="empty-log">Belum ada log</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
