// frontend/ics.js
// Membuat isi file kalender (.ics) berulang mingguan. Fungsi MURNI: tidak
// menyentuh halaman, tidak membaca jam sistem kecuali stempel/uid tidak diberikan.
// Aturan formatnya (RFC 5545): baris diakhiri CRLF, maksimal 75 byte per baris
// (sisanya "dilipat" ke baris berikutnya diawali spasi), teks harus di-escape.
(function () {
  'use strict';

  const KODE_HARI = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']; // urutan sama dengan getUTCDay()
  const pad = (n) => String(n).padStart(2, '0');

  // Tanggal pertama (>= hariIni) yang jatuh pada hari tertentu. hariMinggu: 0=Minggu ... 6=Sabtu
  function tanggalPertama(hariIni, hariMinggu) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(hariIni));
    if (!m) throw new Error('Tanggal hari ini tidak valid.');
    const y = Number(m[1]);
    const bln = Number(m[2]) - 1;
    const d = Number(m[3]);
    const dasar = new Date(Date.UTC(y, bln, d));
    if (dasar.toISOString().slice(0, 10) !== hariIni) throw new Error('Tanggal hari ini tidak valid.');
    const selisih = (hariMinggu - dasar.getUTCDay() + 7) % 7;
    return new Date(Date.UTC(y, bln, d + selisih)).toISOString().slice(0, 10);
  }

  function escapeTeks(s) {
    return String(s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  // Lipat baris panjang. Batasnya dihitung dalam BYTE UTF-8, bukan jumlah huruf.
  function lipat(baris) {
    const enc = new TextEncoder();
    let hasil = '';
    let saatIni = '';
    let byte = 0;
    for (const ch of baris) { // for..of berjalan per karakter utuh, bukan per setengah emoji
      const b = enc.encode(ch).length;
      if (byte + b > 75) {
        hasil += saatIni + '\r\n';
        saatIni = ' '; // baris lanjutan diawali satu spasi (ikut dihitung)
        byte = 1;
      }
      saatIni += ch;
      byte += b;
    }
    return hasil + saatIni;
  }

  // opsi: { hariMinggu, jam, menit, url, hariIni, [stempel], [uid] }
  function buatICS(o) {
    if (!Number.isInteger(o.hariMinggu) || o.hariMinggu < 0 || o.hariMinggu > 6) throw new Error('Hari tidak valid.');
    if (!Number.isInteger(o.jam) || o.jam < 0 || o.jam > 23) throw new Error('Jam tidak valid.');
    if (!Number.isInteger(o.menit) || o.menit < 0 || o.menit > 59) throw new Error('Menit tidak valid.');
    // Tanpa spasi/baris baru di URL: mencegah penyelipan baris ICS lain
    if (typeof o.url !== 'string' || !/^https?:\/\/\S+$/.test(o.url)) {
      throw new Error('Alamat halaman harus diawali http:// atau https:// (unduh dari situs yang sudah online).');
    }
    const uid = o.uid || 'budget-' + Math.random().toString(36).slice(2, 12) + '@catatan-uang';
    if (!/^[\w.@-]+$/.test(uid)) throw new Error('UID tidak valid.');
    const stempel = o.stempel || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

    const mulai = tanggalPertama(o.hariIni, o.hariMinggu).replace(/-/g, '') + 'T' + pad(o.jam) + pad(o.menit) + '00';
    const judul = 'Isi budget mingguan';
    const deskripsi = 'Cek apakah uang saku sudah masuk, lalu isi budget minggu ini:\n' + o.url;

    const baris = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Catatan Uang//Pengingat Budget//ID',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + stempel,
      'DTSTART:' + mulai, // waktu "mengambang": ikut zona waktu kalender pemakainya
      'DURATION:PT15M',
      'RRULE:FREQ=WEEKLY;BYDAY=' + KODE_HARI[o.hariMinggu],
      'SUMMARY:' + escapeTeks(judul),
      'DESCRIPTION:' + escapeTeks(deskripsi),
      'URL:' + o.url, // tipe URI: tidak di-escape
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + escapeTeks(judul),
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    return baris.map(lipat).join('\r\n') + '\r\n';
  }

  const api = { buatICS: buatICS, tanggalPertama: tanggalPertama };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node (tes)
  else globalThis.ICS = api;                                                  // browser
})();
