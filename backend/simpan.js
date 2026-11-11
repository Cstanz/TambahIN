// backend/simpan.js
// Satu-satunya file yang menyentuh Google Sheets. Hanya jalan di Apps Script.
// Menyediakan objek "db" dengan bentuk yang sama seperti penyimpanan palsu di tes.

const SKEMA_TRANSAKSI = {
  nama: 'transaksi',
  kolom: ['id', 'tanggal', 'tipe', 'nominal', 'kategori', 'catatan', 'dibuat_pada'],
  angka: ['nominal'],
};
const SKEMA_PERIODE = {
  nama: 'periode',
  kolom: ['id', 'minggu_mulai', 'budget', 'sumber', 'status', 'dibuat_pada'],
  angka: ['budget'],
};

// Jalankan SEKALI dari editor Apps Script (tombol Run) untuk menyiapkan Sheet.
// Semua kolom non-angka diformat "Plain text" supaya:
//  - tanggal '2026-11-08' tidak diubah Sheets jadi objek tanggal,
//  - id seperti '12e45678' tidak dibaca sebagai bilangan ilmiah,
//  - catatan berawalan '=' tidak pernah dijalankan sebagai rumus.
function siapkanSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [SKEMA_TRANSAKSI, SKEMA_PERIODE].forEach(function (s) {
    const sheet = ss.getSheetByName(s.nama) || ss.insertSheet(s.nama);
    s.kolom.forEach(function (k, i) {
      if (s.angka.indexOf(k) < 0) sheet.getRange(1, i + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
    });
    sheet.getRange(1, 1, 1, s.kolom.length).setValues([s.kolom]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  });
}

function teksDariSel(kolom, v) {
  if (v instanceof Date) {
    return kolom === 'dibuat_pada' ? v.toISOString() : Utilities.formatDate(v, 'Asia/Jakarta', 'yyyy-MM-dd');
  }
  return String(v);
}

// Pembungkus satu sheet sebagai "tabel": baca, tambah, ubah, hapus.
function buatTabel(sheet, skema) {
  const kolom = skema.kolom;

  function baca() {
    const n = sheet.getLastRow() - 1; // baris 1 = header
    if (n < 1) return [];
    return sheet.getRange(2, 1, n, kolom.length).getValues().map(function (baris) {
      const o = {};
      kolom.forEach(function (k, i) {
        o[k] = skema.angka.indexOf(k) >= 0 ? Number(baris[i]) : teksDariSel(k, baris[i]);
      });
      return o;
    });
  }

  function tulisBaris(nomor, obj) {
    if (nomor > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
    const rentang = sheet.getRange(nomor, 1, 1, kolom.length);
    // Pastikan formatnya sebelum nilai ditulis
    rentang.setNumberFormats([kolom.map(function (k) { return skema.angka.indexOf(k) >= 0 ? '0' : '@'; })]);
    rentang.setValues([kolom.map(function (k) { return obj[k]; })]);
  }

  return {
    baca: baca,
    tambah: function (obj) {
      const baru = Object.assign({ id: Utilities.getUuid().slice(0, 8), dibuat_pada: new Date().toISOString() }, obj);
      tulisBaris(sheet.getLastRow() + 1, baru);
      return baru;
    },
    ubah: function (id, perubahan) {
      const semua = baca();
      const i = semua.findIndex(function (r) { return r.id === id; });
      if (i < 0) return null;
      const gabungan = Object.assign({}, semua[i], perubahan);
      tulisBaris(i + 2, gabungan);
      return gabungan;
    },
    hapus: function (id) {
      const semua = baca();
      const i = semua.findIndex(function (r) { return r.id === id; });
      if (i < 0) return false;
      sheet.deleteRow(i + 2);
      return true;
    },
  };
}

function hashKunci(kunci) {
  return 'saran_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, kunci));
}

function buatPenyimpananSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shT = ss.getSheetByName(SKEMA_TRANSAKSI.nama);
  const shP = ss.getSheetByName(SKEMA_PERIODE.nama);
  if (!shT || !shP) throw new Error('Sheet belum disiapkan. Jalankan siapkanSheet() sekali.');

  const transaksi = buatTabel(shT, SKEMA_TRANSAKSI);
  const periode = buatTabel(shP, SKEMA_PERIODE);
  return {
    daftarTransaksi: transaksi.baca,
    tambahTransaksi: transaksi.tambah,
    ubahTransaksi: transaksi.ubah,
    hapusTransaksi: transaksi.hapus,
    // Cache saran AI: CacheService (maks. 6 jam). Kunci di-hash karena maksimal 250 karakter.
    ambilCache: function (kunci) {
      const v = CacheService.getScriptCache().get(hashKunci(kunci));
      return v ? JSON.parse(v) : null;
    },
    simpanCache: function (kunci, nilai) {
      CacheService.getScriptCache().put(hashKunci(kunci), JSON.stringify(nilai), 21600);
    },
    daftarPeriode: periode.baca,
    tambahPeriode: periode.tambah,
    ubahPeriode: periode.ubah,
  };
}
