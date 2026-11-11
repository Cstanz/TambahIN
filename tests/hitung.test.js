// tests/hitung.test.js  ->  jalankan: node tests/hitung.test.js
const assert = require('assert');
const { hitungSisaBudget, ringkasSemuaPeriode, cariPeriode, ringkasanPeriode } = require('../backend/hitung.js');

let gagal = 0;
function uji(nama, fn) {
  try {
    fn();
    console.log('  OK   ' + nama);
  } catch (e) {
    gagal++;
    console.log('  GAGAL ' + nama + '\n       ' + e.message);
  }
}

const keluar = (tanggal, nominal) => ({ tanggal, tipe: 'keluar', nominal });
const masuk = (tanggal, nominal) => ({ tanggal, tipe: 'masuk', nominal });
const periode = (minggu_mulai, budget, status = 'diterima') => ({ minggu_mulai, budget, status });

uji('sisa dan jatah harian dasar', () => {
  const r = hitungSisaBudget(
    [periode('2026-11-02', 150000)],
    [keluar('2026-11-03', 12000)],
    '2026-11-04'
  );
  assert.strictEqual(r.pengeluaran, 12000);
  assert.strictEqual(r.sisa, 138000);
  assert.strictEqual(r.akhir_rencana, '2026-11-08');
  assert.strictEqual(r.hari_tersisa, 5);
  assert.strictEqual(r.jatah_harian, 27600);
  assert.strictEqual(r.peringatan, null);
});

uji('periode boleh mulai di hari apa saja', () => {
  const r = hitungSisaBudget([periode('2026-11-05', 100000)], [], '2026-11-05');
  assert.strictEqual(r.akhir_rencana, '2026-11-11');
  assert.strictEqual(r.hari_tersisa, 7);
  assert.strictEqual(r.jatah_harian, 14285);
});

uji('pemasukan non-budget menambah sisa', () => {
  const r = hitungSisaBudget(
    [periode('2026-11-02', 100000)],
    [masuk('2026-11-03', 50000), keluar('2026-11-03', 20000)],
    '2026-11-03'
  );
  assert.strictEqual(r.pemasukan_lain, 50000);
  assert.strictEqual(r.sisa, 130000);
});

uji('sisa minggu lalu dibawa ke minggu baru', () => {
  const r = hitungSisaBudget(
    [periode('2026-11-02', 150000), periode('2026-11-09', 200000)],
    [keluar('2026-11-04', 100000)],
    '2026-11-09'
  );
  assert.strictEqual(r.bawaan, 50000);
  assert.strictEqual(r.sisa, 250000);
  assert.strictEqual(r.jatah_harian, 35714);
});

uji('kelebihan belanja (sisa negatif) juga dibawa', () => {
  const r = hitungSisaBudget(
    [periode('2026-11-02', 150000), periode('2026-11-09', 200000)],
    [keluar('2026-11-04', 160000)],
    '2026-11-09'
  );
  assert.strictEqual(r.bawaan, -10000);
  assert.strictEqual(r.sisa, 190000);
});

uji('sisa negatif -> jatah harian 0', () => {
  const r = hitungSisaBudget([periode('2026-11-02', 50000)], [keluar('2026-11-03', 70000)], '2026-11-04');
  assert.strictEqual(r.sisa, -20000);
  assert.strictEqual(r.jatah_harian, 0);
});

uji('transaksi di tanggal mulai periode baru masuk periode baru', () => {
  const [a, b] = ringkasSemuaPeriode(
    [periode('2026-11-02', 150000), periode('2026-11-09', 200000)],
    [keluar('2026-11-08', 10000), keluar('2026-11-09', 20000)]
  );
  assert.strictEqual(a.pengeluaran, 10000);
  assert.strictEqual(b.pengeluaran, 20000);
});

uji('periode baru mulai lebih awal memotong akhir periode lama', () => {
  const [a] = ringkasSemuaPeriode(
    [periode('2026-11-02', 150000), periode('2026-11-06', 100000)],
    []
  );
  assert.strictEqual(a.akhir_rencana, '2026-11-05');
});

uji('budget "menunggu" dihitung 0 dan memberi peringatan', () => {
  const r = hitungSisaBudget(
    [periode('2026-11-02', 150000, 'menunggu')],
    [keluar('2026-11-03', 10000)],
    '2026-11-03'
  );
  assert.strictEqual(r.budget, 0);
  assert.strictEqual(r.sisa, -10000);
  assert.strictEqual(r.peringatan, 'budget_menunggu');
});

uji('lewat jadwal 7 hari tanpa budget baru -> peringatan', () => {
  const r = hitungSisaBudget([periode('2026-11-02', 150000)], [], '2026-11-12');
  assert.strictEqual(r.peringatan, 'periode_lewat');
  assert.strictEqual(r.hari_tersisa, 1);
});

uji('belum ada periode', () => {
  assert.strictEqual(hitungSisaBudget([], [], '2026-11-04').peringatan, 'belum_ada_periode');
  assert.strictEqual(
    hitungSisaBudget([periode('2026-11-10', 100000)], [], '2026-11-04').ada_periode,
    false
  );
});

uji('data tidak valid ditolak', () => {
  const p = [periode('2026-11-02', 100000)];
  assert.throws(() => hitungSisaBudget(p, [keluar('2026-11-03', -5)], '2026-11-04'));
  assert.throws(() => hitungSisaBudget(p, [keluar('2026-11-03', 12.5)], '2026-11-04'));
  assert.throws(() => hitungSisaBudget(p, [keluar('2026-02-30', 5000)], '2026-11-04'));
  assert.throws(() => hitungSisaBudget(p, [{ tanggal: '2026-11-03', tipe: 'x', nominal: 5000 }], '2026-11-04'));
  assert.throws(() => hitungSisaBudget(p, [], '4 November'));
  assert.throws(() => hitungSisaBudget([periode('2026-11-02', 1), periode('2026-11-02', 2)], [], '2026-11-03'));
});

uji('cariPeriode: periode terakhir yang sudah mulai', () => {
  const p = [periode('2026-11-09', 1), periode('2026-11-02', 1)];
  assert.strictEqual(cariPeriode(p, '2026-11-08').minggu_mulai, '2026-11-02');
  assert.strictEqual(cariPeriode(p, '2026-11-09').minggu_mulai, '2026-11-09');
  assert.strictEqual(cariPeriode(p, '2026-11-01'), null);
});

uji('ringkasanPeriode: kategori, rata-rata, perbandingan minggu lalu', () => {
  const kat = (tanggal, nominal, kategori) => ({ tanggal, tipe: 'keluar', nominal, kategori });
  const r = ringkasanPeriode(
    [periode('2026-11-02', 150000), periode('2026-11-09', 200000)],
    [kat('2026-11-04', 100000, 'makan'), kat('2026-11-10', 15000, 'makan'), kat('2026-11-10', 5000, 'hiburan')],
    '2026-11-10'
  );
  assert.strictEqual(r.pengeluaran, 20000);
  assert.strictEqual(r.rata_harian, 10000);          // 2 hari berjalan
  assert.strictEqual(r.hari_berjalan, 2);
  assert.deepStrictEqual(r.per_kategori.map((k) => k.kategori), ['makan', 'hiburan']);
  assert.strictEqual(r.per_kategori[0].persen, 75);
  assert.strictEqual(r.minggu_lalu.rata_harian, 14285); // 100000 / 7 hari
  assert.strictEqual(r.minggu_lalu.selisih_rata_harian, -4285);
});

uji('ringkasanPeriode tanpa periode', () => {
  assert.strictEqual(ringkasanPeriode([], [], '2026-11-08').ada_periode, false);
});

console.log(gagal === 0 ? '\nSemua tes lulus.' : '\n' + gagal + ' tes gagal.');
process.exitCode = gagal === 0 ? 0 : 1;
