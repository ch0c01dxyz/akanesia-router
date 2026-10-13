// Bounded concurrency pool: jalankan fn untuk tiap item dengan maksimal
// `limit` worker paralel. Urutan hasil mengikuti urutan items.
// Tiap item fail-open sendiri: bungkus fn dengan try/catch bila satu item
// yang gagal tidak boleh menggagalkan batch (lihat pemakaian di check-models
// dan test-batch).
export async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.allSettled(workers); // satu worker gagal ≠ batch mati (ide #1)
  return out;
}
