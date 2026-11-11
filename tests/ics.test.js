// tests/ics.test.js  ->  jalankan: node tests/ics.test.js
const assert = require('assert');
const { buatICS, tanggalPertama } = require('../frontend/ics.js');

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

const dasar = {
  hariMinggu: 5, jam: 19, menit: 0, hariIni: '2026-11-09',
  url: 'https://contoh.github.io/catatan/#isi-budget',
  stempel: '20261109T050000Z', uid: 'tes-1@catatan-uang',
};
// Lepas lipatan baris: CRLF + spasi dihapus
const lepas = (s) => s.replace(/\r\n /g, '');

uji('tanggalPertama: hari yang sama dihitung hari ini', () => {
  assert.strictEqual(tanggalPertama('2026-11-09', 1), '2026-11-09'); // Senin
});
uji('tanggalPertama: Jumat berikutnya', () => {
  assert.strictEqual(tanggalPertama('2026-11-09', 5), '2026-11-13');
});
uji('tanggalPertama: Minggu (0)', () => {
  assert.strictEqual(tanggalPertama('2026-11-09', 0), '2026-11-15');
});
uji('tanggalPertama: lintas bulan', () => {
  assert.strictEqual(tanggalPertama('2026-11-28', 1), '2026-11-30');
});
uji('tanggalPertama: lintas tahun', () => {
  assert.strictEqual(tanggalPertama('2026-12-30', 1), '2027-01-04');
});
uji('tanggalPertama: tanggal tidak valid ditolak', () => {
  assert.throws(() => tanggalPertama('2026-02-30', 1));
  assert.throws(() => tanggalPertama('besok', 1));
});

uji('struktur dasar dan akhiran CRLF', () => {
  const s = buatICS(dasar);
  assert.ok(s.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(s.endsWith('END:VCALENDAR\r\n'));
  assert.strictEqual(s.replace(/\r\n/g, '').includes('\n'), false); // tidak ada LF telanjang
});
uji('berulang tiap minggu pada hari yang dipilih', () => {
  const s = buatICS(dasar);
  assert.ok(s.includes('RRULE:FREQ=WEEKLY;BYDAY=FR\r\n'));
  assert.ok(s.includes('DTSTART:20261113T190000\r\n'));
  assert.ok(s.includes('DURATION:PT15M\r\n'));
  assert.ok(s.includes('DTSTAMP:20261109T050000Z\r\n'));
});
uji('menaut ke halaman input budget', () => {
  const s = lepas(buatICS(dasar));
  assert.ok(s.includes('URL:' + dasar.url + '\r\n'));
});
uji('tidak ada baris lebih dari 75 byte', () => {
  const panjang = 'https://contoh.github.io/' + 'a'.repeat(200) + '/#isi-budget';
  const s = buatICS({ ...dasar, url: panjang });
  for (const baris of s.split('\r\n')) assert.ok(Buffer.byteLength(baris) <= 75, 'terlalu panjang: ' + baris.length);
  assert.ok(lepas(s).includes('URL:' + panjang)); // setelah dilepas, isinya utuh
});
uji('koma dan titik koma di-escape pada teks, tidak pada URL', () => {
  const url = 'https://x.id/a,b;c/#isi-budget';
  const s = lepas(buatICS({ ...dasar, url }));
  assert.ok(s.includes('URL:' + url + '\r\n'));
  assert.ok(s.includes('a\\,b\\;c'));
});
uji('jam dan menit diberi nol di depan', () => {
  assert.ok(buatICS({ ...dasar, jam: 7, menit: 5 }).includes('DTSTART:20261113T070500\r\n'));
});

uji('masukan tidak valid ditolak', () => {
  assert.throws(() => buatICS({ ...dasar, hariMinggu: 7 }));
  assert.throws(() => buatICS({ ...dasar, jam: 24 }));
  assert.throws(() => buatICS({ ...dasar, menit: 60 }));
  assert.throws(() => buatICS({ ...dasar, jam: 'x' }));
  assert.throws(() => buatICS({ ...dasar, url: '' }));
  assert.throws(() => buatICS({ ...dasar, url: 'file:///C:/tes/index.html' }));
  assert.throws(() => buatICS({ ...dasar, hariIni: 'kemarin' }));
});
uji('penyelipan baris lewat URL ditolak', () => {
  assert.throws(() => buatICS({ ...dasar, url: 'https://x.id/\r\nATTENDEE:jahat@x.id' }));
  assert.throws(() => buatICS({ ...dasar, url: 'https://x.id/ BEGIN:VEVENT' }));
});

console.log(total + ' tes, ' + (total - gagal) + ' lulus, ' + gagal + ' gagal.');
process.exitCode = gagal === 0 ? 0 : 1;
