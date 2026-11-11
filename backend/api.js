// backend/api.js
// "Otak" semua endpoint. Fungsi tangani() TIDAK tahu soal Google Sheets atau
// HTTP: ia menerima objek permintaan + objek penyimpanan (db) + tanggal hari ini.
// Karena itu bisa dites penuh di Node memakai penyimpanan palsu (di memori).

if (typeof require !== 'undefined') {
  const h = require('./hitung.js');
  const v = require('./validasi.js');
  const p = require('./parse.js');
  const sr = require('./saran.js');
  Object.assign(globalThis, {
    keHari: h.keHari,
    hitungSisaBudget: h.hitungSisaBudget,
    ringkasanPeriode: h.ringkasanPeriode,
    cariPeriode: h.cariPeriode,
    parseNominal: v.parseNominal,
    resolveTanggal: v.resolveTanggal,
    nominalWajar: v.nominalWajar,
    validasiPerubahan: v.validasiPerubahan,
    bersihCatatan: v.bersihCatatan,
    parseTeks: p.parseTeks,
    buatSaran: sr.buatSaran,
  });
}

function galat(pesan) {
  return { ok: false, pesan: pesan };
}

function idValid(id) {
  return typeof id === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(id);
}

function sisaSekarang(db, hariIni) {
  return hitungSisaBudget(db.daftarPeriode(), db.daftarTransaksi(), hariIni);
}

// Router. `aksi` yang tidak dikenal ditolak (switch memakai perbandingan ketat).
// izin (opsional): { pakaiLLM: () => boolean } = penjaga kuota harian untuk saran AI.
function tangani(req, db, hariIni, llm, izin) {
  if (!req || typeof req !== 'object') return galat('Permintaan tidak valid.');
  switch (req.aksi) {
    case 'catat': return aksiCatat(req, db, hariIni, llm);
    case 'budget': return aksiBudget(req, db, hariIni);
    case 'transaksi': return aksiTransaksi(db, hariIni);
    case 'ubah': return aksiUbah(req, db, hariIni);
    case 'hapus': return aksiHapus(req, db, hariIni);
    case 'ringkasan': return { ok: true, ringkasan: ringkasanPeriode(db.daftarPeriode(), db.daftarTransaksi(), hariIni) };
    case 'saran': return aksiSaran(db, hariIni, llm, izin);
    default: return galat('Aksi tidak dikenal.');
  }
}

// POST catat: teks bebas -> parse (LLM) -> validasi -> simpan.
// Uang yang berstatus "uang saku" TIDAK langsung disimpan: perlu konfirmasi dulu,
// karena bisa berarti periode baru atau tambahan untuk periode berjalan.
function aksiCatat(req, db, hariIni, llm) {
  const hasil = parseTeks(req.teks, hariIni, llm);
  if (hasil.status === 'error') return galat(hasil.pesan);
  if (hasil.status === 'tanya') return { ok: true, status: 'tanya', pertanyaan: hasil.pertanyaan };

  const tersimpan = [];
  const perluKonfirmasi = [];
  for (const t of hasil.transaksi) {
    if (t.sebagai_budget) {
      perluKonfirmasi.push({ nominal: t.nominal, tanggal: t.tanggal, sumber: t.catatan });
    } else {
      tersimpan.push(db.tambahTransaksi({
        tanggal: t.tanggal, tipe: t.tipe, nominal: t.nominal, kategori: t.kategori, catatan: t.catatan,
      }));
    }
  }
  return {
    ok: true,
    status: 'ok',
    tersimpan: tersimpan,
    perlu_konfirmasi_budget: perluKonfirmasi,
    sisa: sisaSekarang(db, hariIni),
  };
}

// POST budget: mode "baru" (mulai periode baru) atau "tambah" (top-up periode berjalan).
function aksiBudget(req, db, hariIni) {
  const nominal = parseNominal(req.nominal);
  if (!nominalWajar(nominal)) return galat('Nominal budget tidak valid.');

  if (req.mode !== 'baru' && req.mode !== 'tambah') return galat('Mode harus "baru" atau "tambah".');

  const tanggal = resolveTanggal(req.tanggal, hariIni);
  if (tanggal === null || keHari(tanggal) > keHari(hariIni)) return galat('Tanggal tidak valid.');

  const sumber = bersihCatatan(req.sumber);
  const periode = db.daftarPeriode();
  const aktif = cariPeriode(periode, tanggal);

  let target = null;
  if (req.mode === 'tambah') {
    if (!aktif) return galat('Belum ada periode. Pakai mode "baru".');
    target = aktif;
  } else {
    const sama = periode.find((p) => p.minggu_mulai === tanggal);
    if (sama) target = sama;
    else if (aktif && aktif.status === 'menunggu') target = aktif;
  }

  if (target) {
    // Budget yang "menunggu" diisi (bukan ditambah); yang sudah diterima ditambah.
    const budgetBaru = target.status === 'menunggu' ? nominal : target.budget + nominal;
    db.ubahPeriode(target.id, { budget: budgetBaru, status: 'diterima', sumber: sumber || target.sumber });
  } else {
    db.tambahPeriode({ minggu_mulai: tanggal, budget: nominal, sumber: sumber, status: 'diterima' });
  }
  return { ok: true, status: 'ok', sisa: sisaSekarang(db, hariIni) };
}

// POST transaksi: daftar transaksi periode berjalan (terbaru di atas).
function aksiTransaksi(db, hariIni) {
  const semua = db.daftarTransaksi();
  const aktif = cariPeriode(db.daftarPeriode(), hariIni);
  const daftar = aktif ? semua.filter((t) => keHari(t.tanggal) >= keHari(aktif.minggu_mulai)) : semua;
  daftar.sort(urutTerbaru);
  return { ok: true, transaksi: daftar.slice(0, 200) };
}

function urutTerbaru(a, b) {
  if (a.tanggal !== b.tanggal) return a.tanggal < b.tanggal ? 1 : -1;
  const x = String(a.dibuat_pada);
  const y = String(b.dibuat_pada);
  return x === y ? 0 : x < y ? 1 : -1;
}

function aksiUbah(req, db, hariIni) {
  if (!idValid(req.id)) return galat('ID transaksi tidak valid.');
  const v = validasiPerubahan(req, hariIni);
  if (!v.ok) return galat(v.pesan);
  const baru = db.ubahTransaksi(req.id, v.perubahan);
  if (!baru) return galat('Transaksi tidak ditemukan.');
  return { ok: true, status: 'ok', transaksi: baru, sisa: sisaSekarang(db, hariIni) };
}

// POST saran: ringkasan agregat -> LLM menulis kalimat -> kode memeriksa.
// Gagal / tidak valid / kuota habis -> saran cadangan berbasis aturan (tetap ok:true).
function aksiSaran(db, hariIni, llm, izin) {
  const ring = ringkasanPeriode(db.daftarPeriode(), db.daftarTransaksi(), hariIni);
  const hasil = buatSaran(ring, {
    hariIni: hariIni,
    llm: llm,
    pakaiLLM: izin && izin.pakaiLLM,
    cache: db.ambilCache ? { ambil: db.ambilCache, simpan: db.simpanCache } : null,
  });
  return {
    ok: true,
    status: 'ok',
    saran: hasil.saran,
    sumber: hasil.sumber,
    alasan: hasil.alasan || null,
    dari_cache: !!hasil.dari_cache,
  };
}

function aksiHapus(req, db, hariIni) {
  if (!idValid(req.id)) return galat('ID transaksi tidak valid.');
  if (!db.hapusTransaksi(req.id)) return galat('Transaksi tidak ditemukan.');
  return { ok: true, status: 'ok', sisa: sisaSekarang(db, hariIni) };
}

if (typeof module !== 'undefined') {
  module.exports = { tangani };
}
