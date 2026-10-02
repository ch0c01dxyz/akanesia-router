// RTK meter: agregator in-memory untuk pengukuran efektivitas kompresi RTK.
//
// Cara pakai:
//   1. chatCore memanggil recordRtkStats(rtkStats) setiap request.
//   2. GET /api/debug/token-saver-meter membaca getRtkMeter().
//   3. DELETE /api/debug/token-saver-meter me-reset akumulasi.
//
// Sengaja in-memory (bukan DB): ini alat ukur sementara untuk evaluasi,
// bukan telemetri permanen. Reset tiap restart server.

const state = {
  requests: 0, // berapa kali compressMessages berjalan (RTK enabled)
  requestsWithHits: 0, // berapa request yang benar-benar terkompresi
  bytesBefore: 0,
  bytesAfter: 0,
  byFilter: new Map(), // nama filter -> { hits, saved }
  byShape: new Map(), // shape body -> { hits, saved }
};

export function recordRtkStats(stats) {
  if (!stats) return;
  state.requests += 1;
  state.bytesBefore += stats.bytesBefore || 0;
  state.bytesAfter += stats.bytesAfter || 0;
  const hits = Array.isArray(stats.hits) ? stats.hits : [];
  if (hits.length === 0) return;
  state.requestsWithHits += 1;
  for (const h of hits) {
    const f = state.byFilter.get(h.filter) || { hits: 0, saved: 0 };
    f.hits += 1;
    f.saved += h.saved || 0;
    state.byFilter.set(h.filter, f);
    const s = state.byShape.get(h.shape) || { hits: 0, saved: 0 };
    s.hits += 1;
    s.saved += h.saved || 0;
    state.byShape.set(h.shape, s);
  }
}

function mapToObject(map) {
  const obj = {};
  for (const [k, v] of map) obj[k] = v;
  return obj;
}

export function getRtkMeter() {
  const saved = state.bytesBefore - state.bytesAfter;
  return {
    requests: state.requests,
    requestsWithHits: state.requestsWithHits,
    hitRate: state.requests > 0 ? state.requestsWithHits / state.requests : 0,
    bytesBefore: state.bytesBefore,
    bytesAfter: state.bytesAfter,
    bytesSaved: saved,
    savedPct:
      state.bytesBefore > 0 ? (saved / state.bytesBefore) * 100 : 0,
    byFilter: mapToObject(state.byFilter),
    byShape: mapToObject(state.byShape),
  };
}

export function resetRtkMeter() {
  state.requests = 0;
  state.requestsWithHits = 0;
  state.bytesBefore = 0;
  state.bytesAfter = 0;
  state.byFilter.clear();
  state.byShape.clear();
}
