// tests/parse.test.js  ->  jalankan: node tests/parse.test.js
// Tes ini TIDAK memanggil LLM asli: kita pakai LLM palsu yang membalas jawaban
// yang sudah kita tentukan di cases.json. Jadi gratis, cepat, dan hasilnya selalu sama.
const assert = require('assert');
const cases = require('./cases.json');
const { parseNominal, resolveTanggal } = require('../backend/validasi.js');
const { parseTeks } = require('../backend/parse.js');

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

// LLM palsu: mengembalikan teks JSON sesuai isi kasus
function buatLLMPalsu(c) {
  return function () {
    if (c.llm_error) throw new Error('API mati');
    if (c.llm_mentah !== undefined) return c.llm_mentah;
    if (c.llm_ulang) {
      return JSON.stringify({ status: 'ok', transaksi: Array(c.llm_ulang.kali).fill(c.llm_ulang.item) });
    }
    if (c.llm !== undefined) return JSON.stringify(c.llm);
    throw new Error('LLM seharusnya tidak dipanggil untuk kasus ini');
  };
}

cases.nominal.forEach(function (c) {
  uji('nominal ' + JSON.stringify(c.teks), function () {
    assert.strictEqual(parseNominal(c.teks), c.hasil);
  });
});

cases.tanggal.forEach(function (c) {
  uji('tanggal ' + JSON.stringify(c.kapan), function () {
    assert.strictEqual(resolveTanggal(c.kapan, cases.hariIni), c.hasil);
  });
});

cases.parse.forEach(function (c) {
  uji('parse: ' + c.nama, function () {
    const teks = c.panjang ? 'a'.repeat(c.panjang) : c.teks;
    const r = parseTeks(teks, cases.hariIni, buatLLMPalsu(c));
    assert.strictEqual(r.status, c.harapan.status);
    if (c.harapan.transaksi) assert.deepStrictEqual(r.transaksi, c.harapan.transaksi);
  });
});

console.log(total + ' tes, ' + (total - gagal) + ' lulus, ' + gagal + ' gagal.');
process.exitCode = gagal === 0 ? 0 : 1;
