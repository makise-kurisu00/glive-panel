# GLive Panel — Bun SSR

React 19 dirender lewat `renderToReadableStream()` pada server Bun. HTML pertama sudah berisi pertandingan; hydration mengaktifkan filter, player, dan refresh lima menit. Tanpa Vite atau Nginx. Semua request GLive dan kredensial berada di server.

## Lokal

1. Pasang Bun 1.4.3 atau lebih baru.
2. Salin `.env.example` ke `.env`, lalu isi `GLIVE_APIUSER` dan `GLIVE_KEY`.
3. Jalankan:

```sh
bun install
bun run build
bun run start
```

Buka `http://localhost:6663`. `bun run dev` membangun aset lalu menjalankan server dengan watch. Setelah mengubah kode browser atau CSS, jalankan kembali `bun run build` dan muat ulang browser; tidak ada Vite HMR.

## Docker

```sh
docker compose up --build -d
```

Port `6663` langsung dilayani Bun. Konfigurasi dibaca dari `.env` saat runtime, bukan dimasukkan ke bundle saat build. Compose tidak membutuhkan jaringan proxy eksternal.

## Migrasi konfigurasi

Ganti nama `VITE_GLIVE_*` menjadi `GLIVE_*`. `GLIVE_FORMAT` tidak diperlukan: endpoint internal selalu memakai JSON. Jangan simpan kredensial dalam kode browser. Jika key lama pernah dipublikasikan melalui bundle Vite, rotasi key tersebut.

`GLIVE_IP` opsional untuk override IP yang dikirim ke `geth5link`; bila kosong, Bun memakai IP koneksi. `TRUST_PROXY=false` secara default. Aktifkan hanya di belakang proxy tepercaya yang menimpa `X-Forwarded-For`, dan batasi akses langsung ke Bun agar header tidak bisa dipalsukan.

Endpoint: `/` untuk SSR, `/api/matches` untuk refresh, `/api/player?matchid=...&uid=...` untuk player, `/healthz` untuk health check. Trace browser hanya menampilkan ringkasan aman, bukan URL berkredensial atau body mentah upstream.

### Structured log

Semua request ke server (kecuali `/healthz`) dan semua panggilan server ke GLive menghasilkan JSON per baris di stdout, di development maupun production. Satu request dari browser mendapat satu `traceId`. ID ini ikut tercatat di semua log GLive yang dipicunya dan dikirim balik ke browser lewat header `X-Trace-Id`, jadi alurnya bisa dilacak dengan `docker compose logs glive-panel | grep <traceId>`.

- `http.request`: `traceId`, method, path, query, semua header request browser, dan IP visitor (`ip.client` adalah IP yang dipakai; ada juga `ip.direct`, `ip.forwardedFor`, `ip.realIp`).
- `glive.request`: `traceId`, `requestId`, action, method, endpoint, parameter, header request, dan timeout.
- `glive.response`: ID yang sama, status HTTP, durasi dalam milidetik, header diagnostik (`content-type`, `cf-ray`, `x-request-id`), dan body JSON atau teks, termasuk HTML error upstream.
- `glive.error`: kegagalan konfigurasi, jaringan/pembacaan response, atau parsing JSON, dengan field `stage`.
- `http.response`: status yang dikirim ke browser, durasi total, header response, dan body untuk response JSON (misalnya pesan error 502).
- `http.error` / `ssr.error`: exception tak terduga beserta stack trace.

**Peringatan keamanan:** log server tidak memakai redaksi. API key, API user, UID, IP visitor, semua header browser (termasuk cookie/authorization), dan URL/token player dicatat apa adanya. Batasi akses serta retensi log; jangan bagikan log mentah ke publik. Body yang dicatat dibatasi 8.192 karakter; `bodyTruncated` menunjukkan pemotongan, `bodyBytes` menunjukkan ukuran body asli dalam byte. Response ke browser tetap memakai pengamanan yang sudah ada dan tidak menyertakan log ini.

Lihat log deployment Docker dengan `docker compose logs -f`. Kegagalan sebelum request mencapai aplikasi (misalnya reverse proxy tidak dapat menghubungi Bun) tidak menghasilkan log GLive; periksa log proxy untuk kasus tersebut.

Panel belum memiliki autentikasi. Jangan mengekspos panel atau endpoint player ke internet tanpa kontrol akses dan pembatasan request. Bun melayani HTTP; gunakan terminasi TLS tepercaya jika perlu akses HTTPS.

## Verifikasi

```sh
bun run build
bun test
```

Test memakai mock GLive: SSR HTML, aset, validasi endpoint, partial failure, redaksi kredensial, dan keamanan bootstrap JSON. Pengujian upstream asli membutuhkan kredensial valid.
