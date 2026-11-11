// tests/api.test.js  ->  jalankan: node tests/api.test.js
// Menguji semua endpoint tanpa Google Sheets dan tanpa LLM asli:
// penyimpanan = array di memori, LLM = fungsi palsu yang kita atur jawabannya.
const assert = require('assert');
const { tangani } = require('../backend/api.js');
const { buatDbMemori } = require('./db-memori.js');

const HARI_INI = '2026-11-08';

let total = 0;
let gagal = 0;
function uji(nama, fn) {
  total++;
  try {
    fn();
  } catch (e) {
    gagal++;
    console.log('GAGAL  ' + nama + '\n       ' + e.message.split('\n')[0]);
  }
}

// LLM palsu: membalas item yang kita tentukan
const item = (nominal_teks, kategori, catatan, extra) =>
  Object.assign({ tipe: 'keluar', nominal_teks, kategori, catatan, kapan: null, uang_saku: false }, extra || {});
const llmBalas = (...items) => () => JSON.stringify({ status: 'ok', transaksi: items });

const catat = (db, llm, teks) => tangani({ aksi: 'catat', teks: teks || 'x' }, db, HARI_INI, llm);
const budget = (db, extra) => tangani({ aksi: 'budget', ...extra }, db, HARI_INI);

uji('catat tanpa periode: tersimpan, tapi belum ada periode', () => {
  const db = buatDbMemori();
  const r = catat(db, llmBalas(item('12rb', 'makan', 'kopi')));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.tersimpan.length, 1);
  assert.strictEqual(r.sisa.ada_periode, false);
});

uji('budget baru lalu catat: sisa dihitung kode', () => {
  const db = buatDbMemori();
  const b = budget(db, { nominal: '150rb', tanggal: '2026-11-02', mode: 'baru', sumber: 'ortu' });
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.sisa.sisa, 150000);
  const r = catat(db, llmBalas(item('12rb', 'makan', 'kopi')));
  assert.strictEqual(r.sisa.sisa, 138000);
  assert.strictEqual(r.sisa.jatah_harian, 138000); // 8 Nov = hari terakhir rencana
});

uji('uang saku tidak langsung disimpan, minta konfirmasi', () => {
  const db = buatDbMemori();
  const r = catat(db, llmBalas(item('200rb', 'lain-lain', 'dari ortu', { tipe: 'masuk', uang_saku: true })));
  assert.strictEqual(r.tersimpan.length, 0);
  assert.strictEqual(r.perlu_konfirmasi_budget.length, 1);
  assert.strictEqual(r.perlu_konfirmasi_budget[0].nominal, 200000);
  assert.strictEqual(db.daftarTransaksi().length, 0);
  assert.strictEqual(db.daftarPeriode().length, 0);
});

uji('campuran: pengeluaran disimpan, uang saku menunggu konfirmasi', () => {
  const db = buatDbMemori();
  const r = catat(db, llmBalas(
    item('12rb', 'makan', 'kopi'),
    item('200rb', 'lain-lain', 'dari ortu', { tipe: 'masuk', uang_saku: true })
  ));
  assert.strictEqual(r.tersimpan.length, 1);
  assert.strictEqual(r.perlu_konfirmasi_budget.length, 1);
});

uji('budget mode tambah menambah periode berjalan', () => {
  const db = buatDbMemori();
  budget(db, { nominal: 150000, tanggal: '2026-11-02', mode: 'baru' });
  const r = budget(db, { nominal: 50000, tanggal: '2026-11-08', mode: 'tambah' });
  assert.strictEqual(r.sisa.budget, 200000);
  assert.strictEqual(db.daftarPeriode().length, 1);
});

uji('budget mode tambah tanpa periode ditolak', () => {
  assert.strictEqual(budget(buatDbMemori(), { nominal: 50000, tanggal: '2026-11-08', mode: 'tambah' }).ok, false);
});

uji('budget baru setelah lewat jadwal: periode baru + sisa dibawa', () => {
  const db = buatDbMemori();
  budget(db, { nominal: 150000, tanggal: '2026-11-02', mode: 'baru' });
  db.tambahTransaksi({ tanggal: '2026-11-04', tipe: 'keluar', nominal: 100000, kategori: 'makan', catatan: '' });
  const r = budget(db, { nominal: 200000, tanggal: '2026-11-08', mode: 'baru' });
  assert.strictEqual(db.daftarPeriode().length, 2);
  assert.strictEqual(r.sisa.bawaan, 50000);
  assert.strictEqual(r.sisa.sisa, 250000);
});

uji('budget "menunggu" diisi, bukan ditambah', () => {
  const db = buatDbMemori();
  db.tambahPeriode({ minggu_mulai: '2026-11-02', budget: 999, sumber: '', status: 'menunggu' });
  const r = budget(db, { nominal: 150000, tanggal: '2026-11-08', mode: 'baru' });
  assert.strictEqual(db.daftarPeriode().length, 1);
  assert.strictEqual(r.sisa.budget, 150000);
  assert.strictEqual(r.sisa.status, 'diterima');
});

uji('budget: nominal / mode / tanggal tidak valid ditolak', () => {
  const db = buatDbMemori();
  assert.strictEqual(budget(db, { nominal: 0, tanggal: '2026-11-08', mode: 'baru' }).ok, false);
  assert.strictEqual(budget(db, { nominal: 'banyak', tanggal: '2026-11-08', mode: 'baru' }).ok, false);
  assert.strictEqual(budget(db, { nominal: 5000, tanggal: '2026-11-08', mode: 'timpa' }).ok, false);
  assert.strictEqual(budget(db, { nominal: 5000, tanggal: '2027-01-01', mode: 'baru' }).ok, false);
});

uji('daftar transaksi: hanya periode berjalan, terbaru di atas', () => {
  const db = buatDbMemori();
  budget(db, { nominal: 150000, tanggal: '2026-11-02', mode: 'baru' });
  db.tambahTransaksi({ tanggal: '2026-10-30', tipe: 'keluar', nominal: 1000, kategori: 'makan', catatan: 'lama' });
  db.tambahTransaksi({ tanggal: '2026-11-03', tipe: 'keluar', nominal: 2000, kategori: 'makan', catatan: 'a' });
  db.tambahTransaksi({ tanggal: '2026-11-05', tipe: 'keluar', nominal: 3000, kategori: 'makan', catatan: 'b' });
  const r = tangani({ aksi: 'transaksi' }, db, HARI_INI);
  assert.deepStrictEqual(r.transaksi.map((t) => t.catatan), ['b', 'a']);
});

uji('ubah transaksi: hitungan ikut berubah', () => {
  const db = buatDbMemori();
  budget(db, { nominal: 150000, tanggal: '2026-11-02', mode: 'baru' });
  const id = catat(db, llmBalas(item('12rb', 'makan', 'kopi'))).tersimpan[0].id;
  const r = tangani({ aksi: 'ubah', id, nominal: '15rb', kategori: 'hiburan' }, db, HARI_INI);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.transaksi.kategori, 'hiburan');
  assert.strictEqual(r.sisa.sisa, 135000);
});

uji('ubah: input buruk dan field terlarang ditolak/diabaikan', () => {
  const db = buatDbMemori();
  const id = catat(db, llmBalas(item('12rb', 'makan', 'kopi'))).tersimpan[0].id;
  assert.strictEqual(tangani({ aksi: 'ubah', id, kategori: 'hack' }, db, HARI_INI).ok, false);
  assert.strictEqual(tangani({ aksi: 'ubah', id, nominal: -5 }, db, HARI_INI).ok, false);
  assert.strictEqual(tangani({ aksi: 'ubah', id, tanggal: '' }, db, HARI_INI).ok, false);
  assert.strictEqual(tangani({ aksi: 'ubah', id: 'tidak ada', nominal: 5000 }, db, HARI_INI).ok, false);
  assert.strictEqual(tangani({ aksi: 'ubah', id }, db, HARI_INI).ok, false); // tidak ada yang diubah
  // field di luar daftar putih (tipe, id) tidak boleh ikut berubah
  tangani({ aksi: 'ubah', id, catatan: 'baru', tipe: 'masuk', dibuat_pada: 'palsu' }, db, HARI_INI);
  const t = db.daftarTransaksi()[0];
  assert.strictEqual(t.catatan, 'baru');
  assert.strictEqual(t.tipe, 'keluar');
  assert.notStrictEqual(t.dibuat_pada, 'palsu');
});

uji('hapus transaksi', () => {
  const db = buatDbMemori();
  budget(db, { nominal: 150000, tanggal: '2026-11-02', mode: 'baru' });
  const id = catat(db, llmBalas(item('12rb', 'makan', 'kopi'))).tersimpan[0].id;
  const r = tangani({ aksi: 'hapus', id }, db, HARI_INI);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sisa.sisa, 150000);
  assert.strictEqual(tangani({ aksi: 'hapus', id }, db, HARI_INI).ok, false); // sudah tidak ada
  assert.strictEqual(tangani({ aksi: 'hapus', id: '../x' }, db, HARI_INI).ok, false);
});

uji('ringkasan: per kategori, rata-rata, persen terpakai', () => {
  const db = buatDbMemori();
  budget(db, { nominal: 150000, tanggal: '2026-11-02', mode: 'baru' });
  catat(db, llmBalas(item('12rb', 'makan', 'kopi'), item('15rb', 'transport', 'ojek')));
  const r = tangani({ aksi: 'ringkasan' }, db, HARI_INI).ringkasan;
  assert.deepStrictEqual(r.per_kategori.map((k) => [k.kategori, k.total, k.persen]), [['transport', 15000, 56], ['makan', 12000, 44]]);
  assert.strictEqual(r.rata_harian, 3857);
  assert.strictEqual(r.persen_terpakai, 18);
  assert.strictEqual(r.minggu_lalu, null);
});

uji('parse bertanya -> tidak ada yang disimpan', () => {
  const db = buatDbMemori();
  const r = catat(db, () => JSON.stringify({ status: 'tanya', pertanyaan: 'Berapa?' }));
  assert.strictEqual(r.status, 'tanya');
  assert.strictEqual(db.daftarTransaksi().length, 0);
});

uji('LLM error -> ok:false dan tidak ada yang disimpan', () => {
  const db = buatDbMemori();
  const r = catat(db, () => { throw new Error('mati'); });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(db.daftarTransaksi().length, 0);
});

uji('aksi tidak dikenal / saran / permintaan rusak', () => {
  const db = buatDbMemori();
  assert.strictEqual(tangani({ aksi: 'constructor' }, db, HARI_INI).ok, false);
  assert.strictEqual(tangani(null, db, HARI_INI).ok, false);
  assert.strictEqual(tangani('catat', db, HARI_INI).ok, false);
});

const llmSaranBagus = (cacah) => (system) => {
  cacah.n++;
  return JSON.stringify({ ringkasan: 'Sisa kamu {sisa}.', saran: ['Jatah hari ini {jatah_harian}.'] });
};

uji('saran tanpa periode: cadangan, LLM tidak dipanggil', () => {
  const cacah = { n: 0 };
  const r = tangani({ aksi: 'saran' }, buatDbMemori(), HARI_INI, llmSaranBagus(cacah));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sumber, 'aturan');
  assert.strictEqual(r.alasan, 'belum_ada_periode');
  assert.strictEqual(cacah.n, 0);
});

uji('saran: AI menulis, angka disisipkan kode, hasil di-cache', () => {
  const db = buatDbMemori();
  budget(db, { nominal: 150000, tanggal: '2026-11-02', mode: 'baru' });
  db.tambahTransaksi({ tanggal: '2026-11-03', tipe: 'keluar', nominal: 60000, kategori: 'makan', catatan: 'x' });
  const cacah = { n: 0 };
  let kuota = 0;
  const izin = { pakaiLLM: () => { kuota++; return true; } };
  const a = tangani({ aksi: 'saran' }, db, HARI_INI, llmSaranBagus(cacah), izin);
  assert.strictEqual(a.sumber, 'ai');
  assert.strictEqual(a.saran.ringkasan, 'Sisa kamu Rp90.000.');
  assert.strictEqual(a.dari_cache, false);
  const b = tangani({ aksi: 'saran' }, db, HARI_INI, llmSaranBagus(cacah), izin);
  assert.strictEqual(b.dari_cache, true);
  assert.strictEqual(cacah.n, 1);
  assert.strictEqual(kuota, 1);
});

uji('saran: kuota habis / LLM rusak tetap ok:true dengan saran cadangan', () => {
  const db = buatDbMemori();
  budget(db, { nominal: 150000, tanggal: '2026-11-02', mode: 'baru' });
  const a = tangani({ aksi: 'saran' }, db, HARI_INI, llmSaranBagus({ n: 0 }), { pakaiLLM: () => false });
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.alasan, 'batas_harian');
  const b = tangani({ aksi: 'saran' }, db, HARI_INI, () => { throw new Error('mati'); });
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.sumber, 'aturan');
  assert.ok(b.saran.saran.length >= 1);
});

console.log(total + ' tes, ' + (total - gagal) + ' lulus, ' + gagal + ' gagal.');
process.exitCode = gagal === 0 ? 0 : 1;
