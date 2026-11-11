// backend/hitung.js
// Fungsi hitung MURNI: tidak membaca Sheet, tidak memanggil LLM, tidak
// memanggil new Date() sendiri. Tanggal hari ini selalu dikirim dari luar.
// Aman dipakai di Node (untuk tes) dan di Google Apps Script (V8).

const DURASI_DEFAULT = 7; // rencana lama periode (hari), dipakai untuk jatah harian
const MS_HARI = 86400000;

// ---------- Tanggal (string 'YYYY-MM-DD' <-> nomor hari) ----------
// Pakai UTC supaya tidak terpengaruh zona waktu / DST.

function keHari(tgl) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(tgl));
  if (!m) throw new Error('Format tanggal harus YYYY-MM-DD: ' + tgl);
  const y = +m[1], mo = +m[2], d = +m[3];
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new Error('Tanggal tidak valid: ' + tgl);
  }
  return ms / MS_HARI;
}

function dariHari(n) {
  return new Date(n * MS_HARI).toISOString().slice(0, 10);
}

// ---------- Validasi data mentah (dari Sheet) ----------

function cekTransaksi(t) {
  if (!Number.isInteger(t.nominal) || t.nominal <= 0) {
    throw new Error('Nominal harus bilangan bulat positif: ' + t.nominal);
  }
  if (t.tipe !== 'masuk' && t.tipe !== 'keluar') {
    throw new Error('Tipe harus "masuk" atau "keluar": ' + t.tipe);
  }
  keHari(t.tanggal); // lempar error kalau tanggal tidak valid
}

function cekPeriode(p) {
  if (!Number.isInteger(p.budget) || p.budget < 0) {
    throw new Error('Budget harus bilangan bulat >= 0: ' + p.budget);
  }
  if (p.status !== 'menunggu' && p.status !== 'diterima') {
    throw new Error('Status harus "menunggu" atau "diterima": ' + p.status);
  }
  keHari(p.minggu_mulai);
}

// ---------- Ringkasan semua periode (termasuk sisa yang dibawa) ----------

function ringkasSemuaPeriode(periode, transaksi, durasi = DURASI_DEFAULT) {
  periode.forEach(cekPeriode);
  transaksi.forEach(cekTransaksi);

  const urut = [...periode].sort((a, b) => keHari(a.minggu_mulai) - keHari(b.minggu_mulai));
  let bawaan = 0; // sisa periode sebelumnya (boleh negatif)

  return urut.map((p, i) => {
    const mulai = keHari(p.minggu_mulai);
    const berikut = i + 1 < urut.length ? keHari(urut[i + 1].minggu_mulai) : Infinity;
    if (berikut === mulai) throw new Error('Ada dua periode dengan tanggal mulai sama: ' + p.minggu_mulai);

    let masuk = 0, keluar = 0;
    for (const t of transaksi) {
      const h = keHari(t.tanggal);
      if (h < mulai || h >= berikut) continue; // bukan milik periode ini
      if (t.tipe === 'masuk') masuk += t.nominal;
      else keluar += t.nominal;
    }

    // Budget yang masih "menunggu" belum dihitung sebagai uang
    const budget = p.status === 'diterima' ? p.budget : 0;
    const sisa = bawaan + budget + masuk - keluar;

    const hasil = {
      minggu_mulai: p.minggu_mulai,
      akhir_rencana: dariHari(Math.min(mulai + durasi - 1, berikut - 1)),
      status: p.status,
      budget: budget,
      bawaan: bawaan,
      pemasukan_lain: masuk,
      pengeluaran: keluar,
      sisa: sisa,
    };
    bawaan = sisa;
    return hasil;
  });
}

// ---------- Kondisi periode yang sedang berjalan ----------

function hitungSisaBudget(periode, transaksi, hariIni, durasi = DURASI_DEFAULT) {
  const ringkas = ringkasSemuaPeriode(periode, transaksi, durasi);
  const h = keHari(hariIni);

  let aktif = null;
  for (const r of ringkas) {
    if (keHari(r.minggu_mulai) <= h) aktif = r;
  }
  if (!aktif) return { ada_periode: false, peringatan: 'belum_ada_periode' };

  const lewatJadwal = h > keHari(aktif.akhir_rencana);
  const hariTersisa = lewatJadwal ? 1 : keHari(aktif.akhir_rencana) - h + 1; // termasuk hari ini
  const jatahHarian = aktif.sisa > 0 ? Math.floor(aktif.sisa / hariTersisa) : 0;

  let peringatan = null;
  if (aktif.status === 'menunggu') peringatan = 'budget_menunggu';
  else if (lewatJadwal) peringatan = 'periode_lewat';

  return {
    ada_periode: true,
    ...aktif,
    hari_tersisa: hariTersisa,
    jatah_harian: jatahHarian,
    peringatan: peringatan,
  };
}

// ---------- Periode yang berlaku pada sebuah tanggal ----------
// Mengembalikan periode MENTAH (apa adanya dari Sheet) dengan minggu_mulai
// terbesar yang masih <= tanggal, atau null kalau belum ada.
function cariPeriode(periode, tanggal) {
  const h = keHari(tanggal);
  let hasil = null;
  for (const p of periode) {
    const mulai = keHari(p.minggu_mulai);
    if (mulai <= h && (hasil === null || mulai > keHari(hasil.minggu_mulai))) hasil = p;
  }
  return hasil;
}

// ---------- Ringkasan untuk GET /ringkasan ----------
function ringkasanPeriode(periode, transaksi, hariIni, durasi = DURASI_DEFAULT) {
  const sisa = hitungSisaBudget(periode, transaksi, hariIni, durasi);
  if (!sisa.ada_periode) return sisa;

  const ringkas = ringkasSemuaPeriode(periode, transaksi, durasi);
  const idx = ringkas.findIndex((r) => r.minggu_mulai === sisa.minggu_mulai);
  const mulai = keHari(sisa.minggu_mulai);
  const hariBerjalan = keHari(hariIni) - mulai + 1;

  const total = Object.create(null); // tanpa prototype: aman untuk kunci apa pun
  for (const t of transaksi) {
    if (t.tipe !== 'keluar' || keHari(t.tanggal) < mulai) continue;
    total[t.kategori] = (total[t.kategori] || 0) + t.nominal;
  }
  const perKategori = Object.keys(total)
    .map((k) => ({
      kategori: k,
      total: total[k],
      persen: sisa.pengeluaran > 0 ? Math.round((total[k] * 100) / sisa.pengeluaran) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const rataHarian = Math.floor(sisa.pengeluaran / hariBerjalan);
  const dana = sisa.bawaan + sisa.budget + sisa.pemasukan_lain;

  let mingguLalu = null;
  if (idx > 0) {
    const p = ringkas[idx - 1];
    const hariP = keHari(p.akhir_rencana) - keHari(p.minggu_mulai) + 1;
    const rataP = Math.floor(p.pengeluaran / hariP);
    mingguLalu = {
      minggu_mulai: p.minggu_mulai,
      pengeluaran: p.pengeluaran,
      rata_harian: rataP,
      selisih_rata_harian: rataHarian - rataP, // negatif = lebih hemat dari minggu lalu
    };
  }

  return {
    ...sisa,
    hari_berjalan: hariBerjalan,
    rata_harian: rataHarian,
    persen_terpakai: dana > 0 ? Math.round((sisa.pengeluaran * 100) / dana) : null,
    per_kategori: perKategori,
    minggu_lalu: mingguLalu,
  };
}

// Agar bisa di-require di Node; di Apps Script baris ini diabaikan.
if (typeof module !== 'undefined') {
  module.exports = {
    keHari, dariHari, ringkasSemuaPeriode, hitungSisaBudget,
    cariPeriode, ringkasanPeriode, DURASI_DEFAULT,
  };
}
