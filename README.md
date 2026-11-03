<p align="center">
  <img src="public/logo.png" alt="Akanesia-Router" width="160" />
</p>

# Akanesia-Gateway

Akanesia-Gateway (`akanesia-router`) adalah gateway AI lokal dengan dashboard web. Aplikasi meneruskan request ke provider yang dipilih, menerjemahkan format API, dan mencoba akun atau model lain saat terjadi kegagalan.

Versi repository: **1.5.0**.

## Fitur

- Routing antar akun dengan strategi round-robin atau fill-first, combo fallback antar model, dan alias model melalui Route-Masking.
- Endpoint Chat Completions, Responses, Messages, serta translasi format OpenAI, Claude, dan Gemini.
- Koneksi provider melalui API key, OAuth, atau cookie sesuai dukungan provider; beberapa akun dapat dipasang pada provider yang sama.
- Penemuan dan sinkronisasi model, custom header, serta pengelompokan model di dashboard.
- Pemantauan penggunaan, latensi, cache, dan kuota ketika provider menyediakan datanya. Cooldown membantu menghindari percobaan berulang pada akun yang sedang dibatasi.
- RTK untuk kompresi `tool_result` dan integrasi Headroom untuk kompresi prompt. Penghematan bergantung pada isi request dan pengaturan kompresi.
- Playground dengan Test, Compare, dan Probe, serta log dan replay request upstream yang gagal.
- Proxy HTTP/SOCKS, proxy pool, mode strict, pengecualian `noProxy`, dan relay Vercel/Cloudflare.

Dashboard menyediakan konfigurasi untuk klien seperti Claude Code, Codex, Cursor, Cline, dan OpenCode. Ketersediaan model, kuota, dan fitur tetap mengikuti akun serta provider upstream yang digunakan.

## Menjalankan dari source

Siapkan **Node.js 24 atau lebih baru**, npm, dan Git. Installer Node tersedia di [nodejs.org](https://nodejs.org); pengguna macOS/Linux juga dapat memakai [nvm](https://github.com/nvm-sh/nvm).

```bash
git clone https://github.com/ch0c01dxyz/akanesia-router.git
cd akanesia-router
npm install
```

Salin konfigurasi contoh. Di PowerShell:

```powershell
Copy-Item .env.example .env
```

Di macOS/Linux:

```bash
cp .env.example .env
```

Edit `.env` sebelum menjalankan aplikasi:

- Ganti nilai contoh untuk secret dan password, termasuk `JWT_SECRET` dan `INITIAL_PASSWORD`. Password awal berlaku saat password dashboard belum tersimpan.
- Isi `DATA_DIR` dengan direktori yang dapat ditulisi, atau kosongkan untuk memakai lokasi bawaan.
- Contoh `.env` memakai port `20128`. Untuk script source di repository ini, sesuaikan nilai lokalnya ke `20127`:

```dotenv
PORT=20127
BASE_URL=http://localhost:20127
NEXT_PUBLIC_BASE_URL=http://localhost:20127
```

Untuk pengembangan:

```bash
npm run dev
```

Untuk menjalankan build produksi:

```bash
npm run build
npm start
```

Kedua script memakai port **20127**. Buka dashboard di [http://localhost:20127/dashboard](http://localhost:20127/dashboard). Base URL untuk klien OpenAI-compatible adalah `http://localhost:20127/v1`.

Alternatif mode pengembangan dengan Webpack tersedia melalui `npm run dev:webpack`.

## Menghubungkan klien

1. Tambahkan koneksi provider di dashboard dan isi kredensial yang sesuai.
2. Sinkronkan daftar model, lalu pilih ID dari dashboard atau `GET /v1/models`.
3. Buat API key gateway untuk klien. Gunakan key tersebut pada klien, bukan API key provider.
4. Atur endpoint sesuai protokol yang dipakai klien.

| Protokol | Endpoint pada server source |
|---|---|
| Chat Completions | `http://localhost:20127/v1/chat/completions` |
| Responses | `http://localhost:20127/v1/responses` |
| Messages | `http://localhost:20127/v1/messages` |
| Daftar model | `http://localhost:20127/v1/models` |

Contoh request melalui Bash. Ganti `<API_KEY_GATEWAY>` dan `<ID_MODEL>` dengan nilai dari dashboard:

```bash
curl http://localhost:20127/v1/chat/completions \
  -H "Authorization: Bearer <API_KEY_GATEWAY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<ID_MODEL>",
    "messages": [{"role": "user", "content": "Balas dengan OK."}],
    "stream": false
  }'
```

## CLI launcher

Direktori [`cli/`](cli/) memuat launcher desktop dan perintah `connect` untuk mengatur klien yang memakai server remote. Launcher memakai port **20128** secara bawaan, berbeda dari script source di atas. Pada desktop yang mendukungnya, launcher menyediakan ikon tray.

Untuk memasang dependensi CLI dan melihat opsi dari checkout ini:

```bash
npm install --prefix cli
node cli/cli.js --help
```

Script pembuatan paket tersedia di [`cli/package.json`](cli/package.json). Build server dari source dapat dijalankan langsung dengan `npm start` tanpa launcher.

## Data dan kredensial

`DATA_DIR` menentukan lokasi data aplikasi. Jika tidak diisi, lokasi bawaannya:

| Sistem operasi | Direktori |
|---|---|
| Windows | `%APPDATA%\9router` |
| macOS/Linux | `~/.9router` |

Database SQLite berada di `db/data.sqlite` dalam direktori tersebut. Konfigurasi dan riwayat disimpan lokal; isi request diteruskan ke provider yang digunakan.

Kredensial provider tersimpan dalam data aplikasi. Batasi akses ke direktori data dan `.env`, serta sertakan direktori data dalam backup. `.env` tidak dilacak Git. Untuk akses jarak jauh, gunakan autentikasi dashboard, API key klien, dan HTTPS.

## Pengembangan dan pengujian

Dependensi tes dipasang terpisah dari aplikasi:

```bash
npm install --prefix tests
npm --prefix tests test
```

Suite bawaan tidak menjalankan tes live `*.live.test.js`; tes tersebut memerlukan `RUN_LIVE_TESTS=1`. Tes komponen cloud hanya dijalankan jika source komponennya tersedia. Detail ada di [panduan pengujian](docs/TESTING.md).

Lint tersedia melalui `npx eslint .`. Panduan perubahan source ada di [`docs/specs/`](docs/specs/); untuk mesin routing dan translasi, baca [`open-sse/AGENTS.md`](open-sse/AGENTS.md).

## Dokumentasi

- [Deployment](docs/DEPLOYMENT.md)
- [Keamanan](docs/SECURITY.md)
- [Arsitektur](docs/ARCHITECTURE.md)
- [Changelog](docs/CHANGELOG.md)
- [Laporan audit dan perbaikan](docs/audits/)

## Asal-usul dan lisensi

Proyek ini dikembangkan dari [9router](https://github.com/decolua/9router) oleh decolua, lalu dilanjutkan secara independen sebagai Akanesia-Router. Sebagian integrasi provider berasal dari penggabungan OmniRoute.

Lisensi tetap [Apache License 2.0](LICENSE).
