import { useEffect, useMemo, useState } from 'react';

const apiUser = import.meta.env.VITE_GLIVE_APIUSER || '';
const apiKey = import.meta.env.VITE_GLIVE_KEY || '';
const sports = (import.meta.env.VITE_GLIVE_SPORTTYPES || 'FOOTBALL')
  .split(',')
  .map((sport) => sport.trim().toUpperCase())
  .filter(Boolean);
const format = import.meta.env.VITE_GLIVE_FORMAT || 'JSON';

function getApiPath(sport) {
  return `/api.php?action=getmatch&apiuser=${encodeURIComponent(apiUser)}&key=${encodeURIComponent(apiKey)}&sportstype=${encodeURIComponent(sport)}&format=${encodeURIComponent(format)}`;
}

function formatLogValue(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isLive(item) {
  return item.IsLive === '1' || item.NowPlaying === 1;
}

export default function App() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [trace, setTrace] = useState(null);
  const [lastSync, setLastSync] = useState('');
  const [sportFilter, setSportFilter] = useState('ALL');
  const [liveFilter, setLiveFilter] = useState('ALL');

  const sync = async () => {
    setLoading(true);
    setError('');

    const requests = sports.map((sport) => ({
      sport,
      method: 'GET',
      url: getApiPath(sport),
      headers: { Accept: '*/*' },
      body: null,
    }));

    setTrace({
      time: new Date().toLocaleString('id-ID'),
      request: requests,
      response: null,
    });

    const results = await Promise.all(
      requests.map(async (request) => {
        try {
          const response = await fetch(request.url, {
            method: request.method,
            headers: request.headers,
          });
          const rawBody = await response.text();
          let data = null;

          try {
            data = JSON.parse(rawBody);
          } catch {
            if (response.ok) throw new Error('Response bukan JSON valid');
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
          }

          return {
            sport: request.sport,
            ok: true,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: data,
            matches: Array.isArray(data?.Match)
              ? data.Match.map((match) => ({ ...match, Type: match.Type || request.sport }))
              : [],
          };
        } catch (err) {
          return {
            sport: request.sport,
            ok: false,
            error: err instanceof Error ? err.message : 'Gagal mengambil data',
            matches: [],
          };
        }
      })
    );

    const failed = results.filter((result) => !result.ok);
    const matches = results.flatMap((result) => result.matches);

    setRows(matches);
    setLastSync(new Date().toLocaleString('id-ID'));
    setTrace({
      time: new Date().toLocaleString('id-ID'),
      request: requests,
      response: results.map(({ matches, ...result }) => result),
    });

    if (failed.length) {
      setError(`${failed.length} dari ${sports.length} sport gagal diambil: ${failed.map((item) => item.sport).join(', ')}`);
    }

    setLoading(false);
  };

  useEffect(() => {
    sync();
  }, []);

  const totalLive = useMemo(() => rows.filter(isLive).length, [rows]);
  const filteredRows = useMemo(
    () =>
      rows.filter(
        (item) =>
          (sportFilter === 'ALL' || item.Type === sportFilter) &&
          (liveFilter === 'ALL' || isLive(item))
      ),
    [rows, sportFilter, liveFilter]
  );

  return (
    <div className="page">
      <div className="container">
        <div className="hero">
          <div>
            <h1>Panel Jadwal GLive</h1>
            <p>Ambil seluruh jadwal sport lalu tampilkan tanpa database.</p>
          </div>
          <button type="button" onClick={sync} disabled={loading}>
            {loading ? `Sinkron ${sports.length} sport...` : 'Sync Data'}
          </button>
        </div>

        <div className="stats">
          <div className="card"><span>Total Match</span><strong>{rows.length}</strong></div>
          <div className="card"><span>Sedang Live</span><strong>{totalLive}</strong></div>
          <div className="card"><span>Last Sync</span><strong>{lastSync || '-'}</strong></div>
        </div>

        {error ? <div className="alert">{error}</div> : null}

        <div className="panel">
          <div className="panel-head schedule-head">
            <h2>Jadwal</h2>
            <div className="filters">
              <label>
                Sport
                <select value={sportFilter} onChange={(event) => setSportFilter(event.target.value)}>
                  <option value="ALL">Semua sport</option>
                  {sports.map((sport) => <option key={sport} value={sport}>{sport}</option>)}
                </select>
              </label>
              <label>
                Status
                <select value={liveFilter} onChange={(event) => setLiveFilter(event.target.value)}>
                  <option value="ALL">Semua status</option>
                  <option value="LIVE">Live saja</option>
                </select>
              </label>
              <span>{filteredRows.length} match</span>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>MatchID</th><th>Sport</th><th>Start</th><th>Stop</th><th>Channel</th>
                  <th>Match</th><th>League</th><th>State</th><th>Live</th><th>Score</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length ? filteredRows.map((item) => (
                  <tr key={`${item.Type}-${item.MatchID}`}>
                    <td>{item.MatchID}</td>
                    <td>{item.Type || '-'}</td>
                    <td>{item.TimeStart || '-'}</td>
                    <td>{item.TimeStop || '-'}</td>
                    <td>{item.Channel || '-'}</td>
                    <td>
                      <div className="match-name">{item.Name || '-'}</div>
                      <div className="teams">{item.Home || '-'} vs {item.Away || '-'}</div>
                    </td>
                    <td>{item.League || '-'}</td>
                    <td>{item.State || '-'}</td>
                    <td><span className={isLive(item) ? 'badge live' : 'badge'}>{isLive(item) ? 'Live' : 'Off'}</span></td>
                    <td>{item.HomeScore || '-'} : {item.AwayScore || '-'}</td>
                  </tr>
                )) : (
                  <tr><td colSpan="10" className="empty">{loading ? 'Mengambil data...' : 'Tidak ada data sesuai filter'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Request & Response</h2>
            <span>{trace?.time || 'Belum ada log'}</span>
          </div>
          {trace ? (
            <div className="trace-grid">
              <div className="log-item">
                <div className="log-meta"><strong>REQUEST</strong><span>{trace.request.length} request</span></div>
                <pre>{formatLogValue(trace.request)}</pre>
              </div>
              <div className="log-item">
                <div className="log-meta"><strong>RESPONSE</strong><span>{trace.response ? `${trace.response.length} response` : 'Menunggu...'}</span></div>
                <pre>{formatLogValue(trace.response)}</pre>
              </div>
            </div>
          ) : <div className="empty-log">Belum ada log</div>}
        </div>
      </div>
    </div>
  );
}
