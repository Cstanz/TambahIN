// tests/server-lokal.js  ->  jalankan: node tests/server-lokal.js
// ALAT BANTU KHUSUS PENGEMBANGAN. Menjalankan API yang sama (tangani() di api.js)
// di komputermu, dengan penyimpanan di memori dan "LLM palsu" berbasis kata kunci.
// Tujuan: mencoba frontend tanpa Apps Script dan tanpa API key.
// Data hilang tiap server dimatikan. JANGAN dipakai sebagai backend sungguhan.
const http = require('http');
const { tangani } = require('../backend/api.js');
const { dariHari, keHari } = require('../backend/hitung.js');
const { buatDbMemori } = require('./db-memori.js');

const PORT = 8787;
const KODE = 'kodelokal';
const hariIni = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

// Data contoh supaya layar tidak kosong
const db = buatDbMemori();
const mulai = dariHari(keHari(hariIni()) - 2);
db.tambahPeriode({ minggu_mulai: mulai, budget: 150000, sumber: 'ortu', status: 'diterima' });
db.tambahTransaksi({ tanggal: mulai, tipe: 'keluar', nominal: 17000, kategori: 'makan', catatan: 'nasi + es teh' });
db.tambahTransaksi({ tanggal: dariHari(keHari(mulai) + 1), tipe: 'keluar', nominal: 15000, kategori: 'transport', catatan: 'ojek ke kampus' });

// LLM palsu: bukan AI, cuma kata kunci. Hanya untuk mencoba tampilan.
const KATA = {
  makan: ['nasi', 'kopi', 'teh', 'makan', 'ayam', 'bakso', 'minum', 'sarapan', 'mie', 'roti'],
  transport: ['ojek', 'bensin', 'parkir', 'gojek', 'grab', 'angkot', 'bus', 'tol'],
  kuliah: ['buku', 'fotokopi', 'print', 'ukt', 'tugas', 'pulpen'],
  hiburan: ['nonton', 'game', 'netflix', 'spotify', 'bioskop'],
};
const NOMINAL = /(\d+(?:[.,]\d+)?\s?(?:rb|ribu|k|jt|juta)\b|\b\d{4,}\b|goceng|ceban|seceng|cepek)/;
const KAPAN = /(kemarin lusa|kemarin|kemaren|semalam|\d+ hari lalu|tgl \d{1,2}|tanggal \d{1,2})/;

function llmPalsu(system, user) {
  // Permintaan saran: balas kalimat dengan penanda {..}. Jalankan dengan SARAN=gagal
  // (mis. `SARAN=gagal node tests/server-lokal.js`) untuk mencoba saran cadangan.
  if (system.includes('penulis saran keuangan')) {
    if (process.env.SARAN === 'gagal') throw new Error('LLM palsu sengaja gagal');
    const d = JSON.parse(user.replace(/<\/?data>/g, ''));
    const saran = ['Jatah aman hari ini {jatah_harian}.'];
    if (d.placeholder_tersedia.includes('kategori_teratas')) saran.push('Pengeluaran terbesar ada di {kategori_teratas} ({persen_kategori_teratas}).');
    return JSON.stringify({ ringkasan: 'Contoh dari LLM palsu: sisa kamu {sisa} untuk {hari_tersisa} hari.', saran: saran });
  }
  const teks = user.replace(/<\/?catatan>/g, '').toLowerCase();
  const transaksi = [];
  for (const b of teks.split(',').map((s) => s.trim()).filter(Boolean)) {
    const n = NOMINAL.exec(b);
    if (!n) return JSON.stringify({ status: 'tanya', pertanyaan: 'Nominalnya berapa? (LLM palsu)' });
    const k = KAPAN.exec(b);
    const masuk = /\b(dapat|terima|gaji|jual)\b/.test(b);
    let kategori = 'lain-lain';
    for (const nama of Object.keys(KATA)) if (KATA[nama].some((w) => b.includes(w))) { kategori = nama; break; }
    transaksi.push({
      tipe: masuk ? 'masuk' : 'keluar',
      nominal_teks: n[1],
      kategori: masuk ? 'lain-lain' : kategori,
      catatan: b.replace(n[1], '').replace(k ? k[1] : '', '').replace(/\b(dapat|beli|bayar)\b/g, '').replace(/\s+/g, ' ').trim(),
      kapan: k ? k[1] : null,
      uang_saku: masuk && /ortu|orang tua|beasiswa|saku|kiriman/.test(b),
    });
  }
  return JSON.stringify({ status: 'ok', transaksi: transaksi });
}

// Kuota saran harian (meniru kode.js)
let pakaiSaran = 0;
const BATAS_SARAN = 5;
const izin = { pakaiLLM: () => { if (pakaiSaran >= BATAS_SARAN) return false; pakaiSaran++; return true; } };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method !== 'POST') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, pesan: 'API lokal aktif.' }));
  }
  let isi = '';
  req.on('data', (c) => { isi += c; if (isi.length > 10000) req.destroy(); });
  req.on('end', () => {
    let hasil;
    try {
      const r = JSON.parse(isi);
      hasil = r.kode !== KODE ? { ok: false, pesan: 'Kode akses salah.' } : tangani(r, db, hariIni(), llmPalsu, izin);
      if (hasil.ok && r.aksi === 'saran') hasil.batas_saran = { dipakai: pakaiSaran, maks: BATAS_SARAN };
    } catch (e) {
      hasil = { ok: false, pesan: 'Format permintaan salah.' };
    }
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(hasil));
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log('API lokal jalan di http://127.0.0.1:' + PORT + '  (kode akses: ' + KODE + ')');
});
