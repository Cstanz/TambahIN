// backend/validasi.js
// Semua keputusan "ini valid atau tidak" ada di sini, di KODE, bukan di LLM.
// LLM hanya mengusulkan; file ini yang memutuskan.

// Jembatan Node <-> Apps Script: di Node kita impor hitung.js, di Apps Script
// semua file otomatis berbagi fungsi global, jadi blok ini dilewati.
if (typeof require !== 'undefined') {
  const h = require('./hitung.js');
  globalThis.keHari = h.keHari;
  globalThis.dariHari = h.dariHari;
}

const KATEGORI = ['makan', 'transport', 'kuliah', 'hiburan', 'lain-lain'];
const MAKS_PANJANG_INPUT = 200;
const MAKS_ITEM = 10;
const MAKS_NOMINAL = 100000000; // Rp100 juta; di atas ini kita tanya ulang
const MAKS_HARI_MUNDUR = 90;

const SLANG_NOMINAL = { seceng: 1000, goceng: 5000, ceban: 10000, goban: 50000, cepek: 100000 };
const KATA_ANGKA = { satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9 };
const SUFIKS = { rb: 1000, ribu: 1000, k: 1000, jt: 1000000, juta: 1000000 };

// Aman dipakai pada kunci dari input pengguna (mencegah "constructor", dll.)
function punya(obj, kunci) {
  return Object.prototype.hasOwnProperty.call(obj, kunci);
}

function formatRupiah(n) {
  return 'Rp' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ---------- 1. Bersihkan input pengguna ----------
function bersihkanInput(teks) {
  if (typeof teks !== 'string') return { ok: false, pesan: 'Tulis dulu catatannya, contoh: "kopi 12rb".' };
  const t = teks
    .replace(/[\u0000-\u001f\u007f]/g, ' ') // karakter kontrol
    .replace(/[<>]/g, ' ')                  // cegah merusak tag <catatan> di prompt
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return { ok: false, pesan: 'Tulis dulu catatannya, contoh: "kopi 12rb".' };
  if (t.length > MAKS_PANJANG_INPUT) {
    return { ok: false, pesan: 'Terlalu panjang (maksimal ' + MAKS_PANJANG_INPUT + ' karakter). Pecah jadi beberapa catatan ya.' };
  }
  return { ok: true, teks: t };
}

// ---------- 2. Nominal: teks -> angka bulat (atau null kalau tidak jelas) ----------
function parseNominal(teks) {
  if (teks === null || teks === undefined) return null;
  const t = String(teks).toLowerCase().replace(/rupiah|rp\.?/g, '').trim();
  if (!t) return null;
  const rapat = t.replace(/\s+/g, '');

  // a) angka + sufiks: 20rb, 20k, 1,5jt
  const m = /^(\d+(?:[.,]\d+)?)(rb|ribu|k|jt|juta)$/.exec(rapat);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * SUFIKS[m[2]]);

  // b) angka polos: 12500, 20.000, 20,000
  if (/^\d+$/.test(rapat)) return Number(rapat);
  if (/^\d{1,3}([.,]\d{3})+$/.test(rapat)) return Number(rapat.replace(/[.,]/g, ''));

  // c) slang: goceng, ceban, ...
  if (punya(SLANG_NOMINAL, rapat)) return SLANG_NOMINAL[rapat];

 
  return parseAngkaKata(t.split(/\s+/));
}

function parseAngkaKata(tokens) {
  let total = 0;  
  let grup = 0;   
  let satuan = 0; 
  for (const k of tokens) {
    if (punya(KATA_ANGKA, k)) satuan = KATA_ANGKA[k];
    else if (k === 'sepuluh') grup += 10;
    else if (k === 'sebelas') grup += 11;
    else if (k === 'seratus') grup += 100;
    else if (k === 'seribu') total += 1000;
    else if (k === 'sejuta') total += 1000000;
    else if (k === 'belas') { grup += satuan + 10; satuan = 0; }
    else if (k === 'puluh') { grup += (satuan || 1) * 10; satuan = 0; }
    else if (k === 'ratus') { grup += (satuan || 1) * 100; satuan = 0; }
    else if (k === 'ribu') { total += (grup + satuan || 1) * 1000; grup = 0; satuan = 0; }
    else if (k === 'juta') { total += (grup + satuan || 1) * 1000000; grup = 0; satuan = 0; }
    else return null; 
  }
  return total + grup + satuan || null;
}


function resolveTanggal(kapan, hariIni) {
  const h = keHari(hariIni);
  const k = String(kapan === null || kapan === undefined ? '' : kapan).toLowerCase().trim();

  if (k === '' || k === 'null' || /^(hari ini|tadi|barusan|sekarang|tadi (pagi|siang|sore))$/.test(k)) return hariIni;
  if (/^(kemarin|kemaren|semalam)$/.test(k)) return dariHari(h - 1);
  if (/^(kemarin lusa|kemarin dulu)$/.test(k)) return dariHari(h - 2);

  let m = /^(\d{1,3}) hari (?:yang )?lalu$/.exec(k);
  if (m) return dariHari(h - Number(m[1]));

  m = /^(?:tgl|tanggal)\.? ?(\d{1,2})$/.exec(k);
  if (m) {
    let tahun = Number(hariIni.slice(0, 4));
    let bulan = Number(hariIni.slice(5, 7));
    const hari = Number(m[1]);
    // "tgl 25" padahal hari ini tanggal 8 -> maksudnya bulan lalu
    if (hari > Number(hariIni.slice(8, 10))) {
      bulan -= 1;
      if (bulan === 0) { bulan = 12; tahun -= 1; }
    }
    const tgl = tahun + '-' + String(bulan).padStart(2, '0') + '-' + String(hari).padStart(2, '0');
    try { keHari(tgl); return tgl; } catch (e) { return null; }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(k)) {
    try { keHari(k); return k; } catch (e) { return null; }
  }
  return null;
}

// ---------- 4. Validasi keluaran LLM ----------
function tanya(pesan) {
  return { status: 'tanya', pertanyaan: String(pesan).slice(0, 150) };
}

function bersihCatatan(c) {
  if (typeof c !== 'string') return '';
  // Buang awalan = + - @ supaya tidak dibaca sebagai RUMUS oleh Google Sheets
  return c.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/^[=+\-@\s]+/, '').trim().slice(0, 60);
}

function validasiHasilLLM(obj, hariIni) {
  if (!obj || typeof obj !== 'object') return tanya('Aku belum paham. Coba tulis ulang, contoh: "kopi 12rb".');
  if (obj.status === 'tanya') return tanya(obj.pertanyaan || 'Bisa diperjelas? Contoh: "kopi 12rb".');
  if (!Array.isArray(obj.transaksi) || obj.transaksi.length === 0) {
    return tanya('Aku belum menemukan transaksinya. Coba tulis ulang, contoh: "kopi 12rb".');
  }
  if (obj.transaksi.length > MAKS_ITEM) return tanya('Terlalu banyak sekaligus (maksimal ' + MAKS_ITEM + '). Pecah dulu ya.');

  const hasil = [];
  for (let i = 0; i < obj.transaksi.length; i++) {
    const it = obj.transaksi[i];
    const label = obj.transaksi.length > 1 ? ' (item ' + (i + 1) + ')' : '';
    if (!it || typeof it !== 'object') return tanya('Aku belum paham' + label + '. Coba tulis ulang.');

    if (it.tipe !== 'keluar' && it.tipe !== 'masuk') return tanya('Ini pemasukan atau pengeluaran?' + label);

    const nominal = parseNominal(it.nominal_teks);
    if (nominal === null || !Number.isInteger(nominal) || nominal <= 0) return tanya('Nominalnya berapa?' + label);
    if (nominal > MAKS_NOMINAL) return tanya('Nominalnya ' + formatRupiah(nominal) + '. Benar segitu?' + label);

    if (!KATEGORI.includes(it.kategori)) return tanya('Kategorinya apa? (' + KATEGORI.join(', ') + ')' + label);

    const tanggal = resolveTanggal(it.kapan, hariIni);
    if (tanggal === null) return tanya('Tanggalnya kapan?' + label);
    const selisih = keHari(hariIni) - keHari(tanggal);
    if (selisih < 0) return tanya('Tanggalnya di masa depan. Maksudnya kapan?' + label);
    if (selisih > MAKS_HARI_MUNDUR) return tanya('Tanggalnya sudah lama sekali. Benar?' + label);

    hasil.push({
      tipe: it.tipe,
      nominal: nominal,
      kategori: it.kategori,
      catatan: bersihCatatan(it.catatan),
      tanggal: tanggal,
      sebagai_budget: it.tipe === 'masuk' && it.uang_saku === true,
    });
  }
  return { status: 'ok', transaksi: hasil };
}

// ---------- 5. Pembantu untuk endpoint /budget dan /ubah ----------
function nominalWajar(n) {
  return Number.isInteger(n) && n > 0 && n <= MAKS_NOMINAL;
}

// Hanya 4 field ini yang boleh diubah. Field lain di permintaan DIABAIKAN
// (supaya pengirim tidak bisa menyelipkan id/tipe/dibuat_pada sembarangan).
function validasiPerubahan(p, hariIni) {
  const hasil = {};

  if (p.nominal !== undefined) {
    const n = parseNominal(p.nominal);
    if (!nominalWajar(n)) return { ok: false, pesan: 'Nominal tidak valid.' };
    hasil.nominal = n;
  }
  if (p.kategori !== undefined) {
    if (!KATEGORI.includes(p.kategori)) return { ok: false, pesan: 'Kategori harus salah satu dari: ' + KATEGORI.join(', ') + '.' };
    hasil.kategori = p.kategori;
  }
  if (p.catatan !== undefined) {
    hasil.catatan = bersihCatatan(p.catatan);
  }
  if (p.tanggal !== undefined) {
    if (typeof p.tanggal !== 'string' || p.tanggal.trim() === '') return { ok: false, pesan: 'Tanggal tidak valid.' };
    const t = resolveTanggal(p.tanggal, hariIni);
    if (t === null) return { ok: false, pesan: 'Tanggal tidak valid.' };
    const selisih = keHari(hariIni) - keHari(t);
    if (selisih < 0 || selisih > MAKS_HARI_MUNDUR) return { ok: false, pesan: 'Tanggal di luar rentang yang wajar.' };
    hasil.tanggal = t;
  }

  if (Object.keys(hasil).length === 0) return { ok: false, pesan: 'Tidak ada yang diubah.' };
  return { ok: true, perubahan: hasil };
}

if (typeof module !== 'undefined') {
  module.exports = {
    bersihkanInput, parseNominal, resolveTanggal, validasiHasilLLM,
    nominalWajar, validasiPerubahan, bersihCatatan, formatRupiah, punya, KATEGORI,
  };
}
