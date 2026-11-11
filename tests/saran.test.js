// tests/saran.test.js  ->  jalankan: node tests/saran.test.js
const assert = require('assert');
const { ringkasanPeriode } = require('../backend/hitung.js');
const S = require('../backend/saran.js');

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

const periode = (mulai, budget) => ({ minggu_mulai: mulai, budget: budget, status: 'diterima' });
const kel = (tanggal, nominal, kategori, catatan) => ({ tanggal, tipe: 'keluar', nominal, kategori, catatan: catatan || '' });
const ring = (hariIni, trx, periodes) => ringkasanPeriode(periodes || [periode('2026-11-02', 150000)], trx, hariIni);

// ---------- Tingkat (dihitung kode) ----------
uji('tingkat: awal periode tidak dinilai (aman)', () => {
  assert.strictEqual(S.tingkatPengeluaran(ring('2026-11-02', [kel('2026-11-02', 10000, 'makan')])), 'aman');
});
uji('tingkat: sesuai jalur = aman', () => {
  assert.strictEqual(S.tingkatPengeluaran(ring('2026-11-05', [kel('2026-11-03', 60000, 'makan')])), 'aman');
});
uji('tingkat: lebih cepat sedikit = waspada', () => {
  assert.strictEqual(S.tingkatPengeluaran(ring('2026-11-05', [kel('2026-11-03', 97500, 'makan')])), 'waspada');
});
uji('tingkat: jauh lebih cepat = bahaya', () => {
  assert.strictEqual(S.tingkatPengeluaran(ring('2026-11-05', [kel('2026-11-03', 120000, 'makan')])), 'bahaya');
});
uji('tingkat: sisa minus = bahaya', () => {
  assert.strictEqual(S.tingkatPengeluaran(ring('2026-11-05', [kel('2026-11-03', 160000, 'makan')])), 'bahaya');
});
uji('tingkat: tanpa periode = waspada', () => {
  assert.strictEqual(S.tingkatPengeluaran(ringkasanPeriode([], [], '2026-11-05')), 'waspada');
});

// ---------- Nilai penanda ----------
uji('nilaiPlaceholder: format rupiah, persen, dan sisa negatif', () => {
  const n = S.nilaiPlaceholder(ring('2026-11-05', [kel('2026-11-03', 160000, 'makan')]));
  assert.strictEqual(n.sisa, '-Rp10.000');
  assert.strictEqual(n.pengeluaran, 'Rp160.000');
  assert.strictEqual(n.rata_harian, 'Rp40.000');
  assert.strictEqual(n.jatah_harian, 'Rp0');
  assert.strictEqual(n.persen_terpakai, '107%');
  assert.strictEqual(n.kategori_teratas, 'makan');
  assert.strictEqual(n.persen_kategori_teratas, '100%');
});
uji('nilaiPlaceholder: tanpa pengeluaran tidak ada penanda kategori', () => {
  const n = S.nilaiPlaceholder(ring('2026-11-03', []));
  assert.strictEqual('kategori_teratas' in n, false);
  assert.strictEqual(n.sisa, 'Rp150.000');
});
uji('nilaiPlaceholder: tanpa periode kosong', () => {
  assert.deepStrictEqual(S.nilaiPlaceholder(ringkasanPeriode([], [], '2026-11-05')), {});
});

// ---------- Pemeriksaan jawaban LLM ----------
const nilaiContoh = { sisa: 'Rp50.000', jatah_harian: 'Rp12.500', hari_tersisa: '4' };
const baikJawaban = { ringkasan: 'Sisa kamu {sisa}.', saran: ['Jatah hari ini {jatah_harian}.'] };

uji('validasiSaran: jawaban baik, penanda diganti nilai', () => {
  const v = S.validasiSaran(baikJawaban, nilaiContoh);
  assert.deepStrictEqual(v, { ringkasan: 'Sisa kamu Rp50.000.', saran: ['Jatah hari ini Rp12.500.'] });
});
uji('validasiSaran: LLM menulis angka sendiri ditolak', () => {
  assert.strictEqual(S.validasiSaran({ ringkasan: 'Sisa kamu Rp50.000.', saran: ['Hemat ya'] }, nilaiContoh), null);
  assert.strictEqual(S.validasiSaran({ ringkasan: 'Santai.', saran: ['Sisa cuma 3 hari lagi'] }, nilaiContoh), null);
  assert.strictEqual(S.validasiSaran({ ringkasan: 'Santai.', saran: ['Transfer ke 081234 sekarang'] }, nilaiContoh), null);
});
uji('validasiSaran: penanda tidak dikenal / tidak tersedia ditolak', () => {
  assert.strictEqual(S.validasiSaran({ ringkasan: '{gaji} kamu bagus', saran: ['x'] }, nilaiContoh), null);
  assert.strictEqual(S.validasiSaran({ ringkasan: 'Teratas {kategori_teratas}', saran: ['x'] }, nilaiContoh), null);
  assert.strictEqual(S.validasiSaran({ ringkasan: '{constructor}', saran: ['x'] }, nilaiContoh), null);
});
uji('validasiSaran: bentuk salah ditolak', () => {
  assert.strictEqual(S.validasiSaran(null, nilaiContoh), null);
  assert.strictEqual(S.validasiSaran({ ringkasan: 'a', saran: [] }, nilaiContoh), null);
  assert.strictEqual(S.validasiSaran({ ringkasan: 'a', saran: ['a', 'b', 'c', 'd'] }, nilaiContoh), null);
  assert.strictEqual(S.validasiSaran({ ringkasan: 'a', saran: 'bukan array' }, nilaiContoh), null);
  assert.strictEqual(S.validasiSaran({ ringkasan: '  ', saran: ['a'] }, nilaiContoh), null);
  assert.strictEqual(S.validasiSaran({ ringkasan: 'a', saran: [5] }, nilaiContoh), null);
  assert.strictEqual(S.validasiSaran({ ringkasan: 'a'.repeat(201), saran: ['a'] }, nilaiContoh), null);
});
uji('validasiSaran: tautan, markup, dan kurung sisa ditolak', () => {
  assert.strictEqual(S.validasiSaran({ ringkasan: 'Lihat https://jahat.id', saran: ['x'] }, nilaiContoh), null);
  assert.strictEqual(S.validasiSaran({ ringkasan: 'Buka www.jahat.id', saran: ['x'] }, nilaiContoh), null);
  assert.strictEqual(S.validasiSaran({ ringkasan: 'Halo <b>kamu</b>', saran: ['x'] }, nilaiContoh), null);
  assert.strictEqual(S.validasiSaran({ ringkasan: 'Sisa {sisa', saran: ['x'] }, nilaiContoh), null);
});
uji('validasiSaran: karakter kontrol dibersihkan', () => {
  const v = S.validasiSaran({ ringkasan: 'Halo\u0007 {sisa}', saran: ['x'] }, nilaiContoh);
  assert.ok(!/[\u0000-\u001f]/.test(v.ringkasan));
});

// ---------- Saran cadangan (tanpa AI) ----------
uji('cadangan: tanpa periode', () => {
  const r = ringkasanPeriode([], [], '2026-11-05');
  const c = S.saranCadangan(r, S.nilaiPlaceholder(r));
  assert.ok(c.saran[0].includes('Isi budget'));
});
uji('cadangan: sisa minus', () => {
  const r = ring('2026-11-05', [kel('2026-11-03', 160000, 'makan')]);
  const c = S.saranCadangan(r, S.nilaiPlaceholder(r));
  assert.ok(c.ringkasan.includes('-Rp10.000'));
  assert.ok(c.saran[0].includes('Tahan pengeluaran'));
  assert.strictEqual(c.tingkat, 'bahaya');
});
uji('cadangan: aman memberi jatah harian', () => {
  const r = ring('2026-11-05', [kel('2026-11-03', 60000, 'makan'), kel('2026-11-04', 10000, 'transport')]);
  const c = S.saranCadangan(r, S.nilaiPlaceholder(r));
  assert.ok(c.ringkasan.includes('masih sesuai jalur'));
  assert.ok(c.saran.some((t) => t.startsWith('Jatah aman hari ini Rp')));
});
uji('cadangan: satu kategori mendominasi', () => {
  const r = ring('2026-11-05', [kel('2026-11-03', 120000, 'hiburan')]);
  const c = S.saranCadangan(r, S.nilaiPlaceholder(r));
  assert.ok(c.saran.some((t) => t.includes('hiburan') && t.includes('100%')));
});
uji('cadangan: hari terakhir periode', () => {
  const r = ring('2026-11-08', [kel('2026-11-03', 60000, 'makan')]);
  const c = S.saranCadangan(r, S.nilaiPlaceholder(r));
  assert.ok(c.saran.some((t) => t.includes('Hari terakhir periode')));
});
uji('cadangan: periode lewat jadwal', () => {
  const r = ring('2026-11-12', [kel('2026-11-03', 60000, 'makan')]);
  const c = S.saranCadangan(r, S.nilaiPlaceholder(r));
  assert.ok(c.saran[0].includes('Isi budget minggu baru'));
});
uji('cadangan: perbandingan dengan minggu lalu', () => {
  const r = ring('2026-11-10', [kel('2026-11-04', 100000, 'makan'), kel('2026-11-10', 5000, 'makan')],
    [periode('2026-11-02', 150000), periode('2026-11-09', 200000)]);
  const c = S.saranCadangan(r, S.nilaiPlaceholder(r));
  assert.ok(c.saran.some((t) => t.includes('lebih rendah dari minggu lalu')));
});
uji('cadangan: tidak pernah ada penanda sisa atau saran kosong', () => {
  const skenario = [
    ring('2026-11-02', []), ring('2026-11-05', [kel('2026-11-03', 97500, 'makan')]),
    ring('2026-11-05', [kel('2026-11-03', 160000, 'kuliah')]), ring('2026-11-12', []),
    ring('2026-11-08', [kel('2026-11-08', 1000, 'lain-lain')]), ringkasanPeriode([], [], '2026-11-05'),
  ];
  for (const r of skenario) {
    const c = S.saranCadangan(r, S.nilaiPlaceholder(r));
    for (const t of [c.ringkasan].concat(c.saran)) {
      assert.ok(t.trim() !== '' && !/[{}]/.test(t), 'bermasalah: ' + t);
    }
    assert.ok(c.saran.length >= 1 && c.saran.length <= 3);
  }
});

// ---------- Privasi: apa yang dikirim ke LLM ----------
uji('agregat untuk LLM tidak memuat nominal, catatan, atau tanggal transaksi', () => {
  const r = ring('2026-11-05', [kel('2026-11-03', 97500, 'makan', 'rahasia-xyz')]);
  const agregat = S.ringkasanUntukLLM(r, S.nilaiPlaceholder(r));
  const p = S.buatPromptSaran(agregat);
  assert.ok(!p.user.includes('rahasia-xyz'));
  assert.ok(!p.user.includes('97500') && !p.user.includes('Rp'));
  assert.ok(!p.user.includes('2026-11-03'));
  assert.deepStrictEqual(Object.keys(agregat).sort(), [
    'ada_periode', 'hari_berjalan', 'hari_tersisa', 'kategori', 'lebih_hemat_dari_minggu_lalu',
    'peringatan', 'persen_terpakai', 'persen_waktu_berjalan', 'placeholder_tersedia', 'sisa_negatif', 'tingkat',
  ]);
});

// ---------- Orkestrasi buatSaran ----------
const llmBagus = (cacah) => () => {
  if (cacah) cacah.n++;
  // "tingkat" palsu dari LLM harus diabaikan
  return JSON.stringify({ ringkasan: 'Sisa kamu {sisa}, santai ya.', saran: ['Jatah hari ini {jatah_harian}.'], tingkat: 'bahaya' });
};
const buatCache = () => {
  const m = new Map();
  return { ambil: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), simpan: (k, v) => m.set(k, JSON.stringify(v)) };
};
const rAman = () => ring('2026-11-05', [kel('2026-11-03', 60000, 'makan')]);

uji('buatSaran: sukses, tingkat dari kode (bukan dari LLM)', () => {
  const h = S.buatSaran(rAman(), { hariIni: '2026-11-05', llm: llmBagus() });
  assert.strictEqual(h.sumber, 'ai');
  assert.strictEqual(h.saran.tingkat, 'aman');
  assert.ok(h.saran.ringkasan.includes('Rp90.000'));
  assert.strictEqual(h.dari_cache, false);
});
uji('buatSaran: data sama -> cache, LLM dan kuota tidak dipakai lagi', () => {
  const cacah = { n: 0 };
  let kuota = 0;
  const opsi = { hariIni: '2026-11-05', llm: llmBagus(cacah), cache: buatCache(), pakaiLLM: () => { kuota++; return true; } };
  S.buatSaran(rAman(), opsi);
  const kedua = S.buatSaran(rAman(), opsi);
  assert.strictEqual(cacah.n, 1);
  assert.strictEqual(kuota, 1);
  assert.strictEqual(kedua.dari_cache, true);
  assert.strictEqual(kedua.sumber, 'ai');
});
uji('buatSaran: data berubah -> LLM dipanggil lagi', () => {
  const cacah = { n: 0 };
  const opsi = { hariIni: '2026-11-05', llm: llmBagus(cacah), cache: buatCache() };
  S.buatSaran(rAman(), opsi);
  S.buatSaran(ring('2026-11-05', [kel('2026-11-03', 60000, 'makan'), kel('2026-11-05', 40000, 'hiburan')]), opsi);
  assert.strictEqual(cacah.n, 2);
});
uji('buatSaran: LLM error -> cadangan, dan tidak di-cache', () => {
  let panggilan = 0;
  const opsi = { hariIni: '2026-11-05', cache: buatCache(), llm: () => { panggilan++; throw new Error('mati'); } };
  const h = S.buatSaran(rAman(), opsi);
  assert.strictEqual(h.sumber, 'aturan');
  assert.strictEqual(h.alasan, 'ai_gagal');
  S.buatSaran(rAman(), opsi);
  assert.strictEqual(panggilan, 2);
});
uji('buatSaran: bukan JSON / ada angka -> cadangan "tidak_valid"', () => {
  const a = S.buatSaran(rAman(), { hariIni: '2026-11-05', llm: () => 'Maaf, aku tidak bisa.' });
  const b = S.buatSaran(rAman(), { hariIni: '2026-11-05', llm: () => JSON.stringify({ ringkasan: 'Sisa Rp90.000', saran: ['x'] }) });
  assert.strictEqual(a.alasan, 'tidak_valid');
  assert.strictEqual(b.alasan, 'tidak_valid');
  assert.strictEqual(b.sumber, 'aturan');
});
uji('buatSaran: JSON dibungkus ```json tetap terbaca', () => {
  const llm = () => '```json\n' + JSON.stringify({ ringkasan: 'Sisa {sisa}.', saran: ['Santai ya'] }) + '\n```';
  assert.strictEqual(S.buatSaran(rAman(), { hariIni: '2026-11-05', llm }).sumber, 'ai');
});
uji('buatSaran: kuota habis -> cadangan, LLM tidak dipanggil', () => {
  const cacah = { n: 0 };
  const h = S.buatSaran(rAman(), { hariIni: '2026-11-05', llm: llmBagus(cacah), pakaiLLM: () => false });
  assert.strictEqual(h.alasan, 'batas_harian');
  assert.strictEqual(cacah.n, 0);
});
uji('buatSaran: tanpa periode tidak memanggil LLM', () => {
  const cacah = { n: 0 };
  const h = S.buatSaran(ringkasanPeriode([], [], '2026-11-05'), { hariIni: '2026-11-05', llm: llmBagus(cacah) });
  assert.strictEqual(h.alasan, 'belum_ada_periode');
  assert.strictEqual(cacah.n, 0);
});
uji('buatSaran: tanpa LLM sama sekali -> cadangan', () => {
  assert.strictEqual(S.buatSaran(rAman(), { hariIni: '2026-11-05' }).alasan, 'ai_gagal');
});

console.log(total + ' tes, ' + (total - gagal) + ' lulus, ' + gagal + ' gagal.');
process.exitCode = gagal === 0 ? 0 : 1;
