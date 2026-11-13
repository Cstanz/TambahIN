'use strict';
// frontend/app.js
// Tugas frontend: MENAMPILKAN data dan MENGIRIM permintaan. Semua keputusan
// (parsing, validasi, hitung sisa) dilakukan backend. Teks dari server/pengguna
// selalu dimasukkan sebagai TEKS (textContent / append), tidak pernah sebagai HTML.

const KATEGORI = ['makan', 'transport', 'kuliah', 'hiburan', 'lain-lain'];
const KUNCI_PENGATURAN = 'pengaturan-catatan-uang';
const KUNCI_SARAN = 'saran-terakhir';
const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

let daftarTerakhir = []; // salinan daftar untuk membatalkan mode ubah tanpa memanggil server

const $ = (id) => document.getElementById(id);
const teks = (id, isi) => { $(id).textContent = isi; };

// ---------- Pembantu tampilan ----------
function el(tag, props, ...anak) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  e.append(...anak.filter((a) => a !== null && a !== undefined && a !== false)); // string dijadikan node teks: aman dari injeksi HTML
  return e;
}

function rupiah(n) {
  return 'Rp' + String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function bagianTanggal(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d, hari: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

function tanggalPendek(iso) {
  const t = bagianTanggal(iso);
  return HARI[t.hari] + ' ' + t.d + ' ' + BULAN[t.m - 1];
}

function rentang(a, b) {
  return bagianTanggal(a).d + ' ' + BULAN[bagianTanggal(a).m - 1] + ' sampai ' + bagianTanggal(b).d + ' ' + BULAN[bagianTanggal(b).m - 1];
}

function tampilPesan(isi, jenis) {
  const p = $('pesan');
  p.textContent = isi;
  p.className = 'konfirmasi' + (jenis && jenis !== 'ok' ? ' ' + jenis : '');
  p.hidden = false;
}

function sibuk(ya) {
  const t = $('tombol-catat');
  t.disabled = ya;
  t.textContent = ya ? 'Memproses...' : 'Catat';
}

// ---------- Pengaturan (disimpan di browser ini saja) ----------
function bacaPengaturan() {
  try { return JSON.parse(localStorage.getItem(KUNCI_PENGATURAN) || '{}'); } catch (e) { return {}; }
}
function simpanPengaturan(p) {
  try { localStorage.setItem(KUNCI_PENGATURAN, JSON.stringify(p)); return true; } catch (e) { return false; }
}

// Kode akses hanya boleh dikirim lewat https (atau ke komputer sendiri untuk pengembangan)
function urlAman(teksUrl) {
  try {
    const u = new URL(teksUrl);
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
  } catch (e) {
    return false;
  }
}

// ---------- Komunikasi dengan backend ----------
// Content-Type text/plain = "permintaan sederhana", jadi browser tidak perlu
// preflight CORS (Apps Script tidak bisa menjawab preflight).
async function kirim(aksi, data) {
  const p = bacaPengaturan();
  if (!p.url || !p.kode) return { ok: false, pesan: 'Isi alamat API dan kode akses di Pengaturan dulu.' };

  const kendali = new AbortController();
  const timer = setTimeout(() => kendali.abort(), 25000);
  try {
    const res = await fetch(p.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ ...data, aksi: aksi, kode: p.kode }), // aksi & kode tidak bisa ditimpa oleh data
      signal: kendali.signal,
    });
    return await res.json();
  } catch (e) {
    return { ok: false, pesan: e && e.name === 'AbortError' ? 'Server terlalu lama menjawab.' : 'Tidak bisa terhubung ke server.' };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Render ----------
function isiBar(persen) {
  const p = Math.max(0, Math.min(100, persen));
  $('b-isi').style.width = p + '%';
  $('b-bar').classList.toggle('kosong', p === 0);
  $('b-bar').setAttribute('aria-label', 'Terpakai ' + Math.round(p) + ' persen');
}

// s = objek "sisa" dari server, atau null kalau belum terhubung
function renderBudget(s) {
  const kartu = $('kartu-budget');
  kartu.classList.remove('minus');
  renderPeringatan(s);
  aturModeBudget(s);

  if (s === null || !s.ada_periode) {
    teks('b-label', s === null ? 'Belum terhubung ke server' : 'Belum ada budget aktif');
    teks('b-angka', '—');
    isiBar(0);
    teks('b-terpakai', '');
    teks('b-jatah', '');
    teks('b-asal', s === null ? 'Buka "Pengingat dan koneksi" di bagian bawah untuk mengisi alamat API.' : 'Isi budget lewat tombol di atas.');
    return;
  }

  const dana = s.bawaan + s.budget + s.pemasukan_lain;
  const minus = s.sisa < 0;
  const persenTerpakai = dana > 0 ? Math.round((s.pengeluaran * 100) / dana) : 0;
  kartu.classList.toggle('minus', minus);

  teks('b-label', minus ? 'Kelebihan budget minggu ini' : 'Sisa budget minggu ini');
  teks('b-angka', (minus ? '-' : '') + rupiah(s.sisa));
  isiBar(minus ? 100 : persenTerpakai); // bar = bagian yang sudah terpakai
  teks('b-terpakai', 'Terpakai ' + persenTerpakai + '% · sisa ' + s.hari_tersisa + ' hari');
  teks('b-jatah', 'Boleh dipakai hari ini: ' + rupiah(s.jatah_harian));

  let asal = rentang(s.minggu_mulai, s.akhir_rencana) + '. Budget ' + rupiah(s.budget) + ' + sisa minggu lalu ' + (s.bawaan < 0 ? '-' : '') + rupiah(s.bawaan);
  if (s.pemasukan_lain > 0) asal += ' + pemasukan lain ' + rupiah(s.pemasukan_lain);
  teks('b-asal', asal);
}

// Banner muncul berdasarkan kode "peringatan" dari backend (hitung.js), bukan tebakan frontend
function renderPeringatan(s) {
  const kode = s ? s.peringatan : null;
  let pesan = '';
  if (kode === 'belum_ada_periode') pesan = 'Budget minggu ini belum diisi.';
  else if (kode === 'budget_menunggu') pesan = 'Budget minggu ini masih menunggu. Isi kalau uangnya sudah masuk.';
  else if (kode === 'periode_lewat') pesan = 'Periode budget berakhir ' + tanggalPendek(s.akhir_rencana) + '. Budget minggu baru belum diisi.';
  $('peringatan').hidden = pesan === '';
  teks('peringatan-teks', pesan);
}

// "Tambahan minggu ini" hanya masuk akal kalau sudah ada periode
function aturModeBudget(s) {
  const tambah = document.querySelector('input[name="bg-mode"][value="tambah"]');
  const baru = document.querySelector('input[name="bg-mode"][value="baru"]');
  const adaPeriode = !!(s && s.ada_periode);
  tambah.disabled = !adaPeriode;
  if (!adaPeriode) baru.checked = true;
}

function hariIniLokal() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function setTanggalDefault() {
  const t = hariIniLokal();
  $('bg-tanggal').value = t;
  $('bg-tanggal').max = t; // uang tidak bisa diterima di masa depan
}

function renderDaftar(daftar) {
  daftarTerakhir = daftar;
  const wadah = $('daftar');
  wadah.replaceChildren();
  $('kosong').hidden = daftar.length > 0;

  // Kelompokkan per tanggal. Daftar dari server sudah terurut: terbaru di atas.
  let tanggalSaatIni = null;
  let ul = null;
  for (const t of daftar) {
    if (t.tanggal !== tanggalSaatIni) {
      tanggalSaatIni = t.tanggal;
      wadah.appendChild(el('h3', { class: 'hari' }, labelHari(t.tanggal)));
      ul = el('ul', { class: 'baris-trx' });
      wadah.appendChild(ul);
    }
    ul.appendChild(barisTransaksi(t));
  }
}

// LATIHAN (T4): sekarang hanya mengenali "Hari ini". Tambahkan "Kemarin" dengan caramu sendiri.
// Petunjuk: tanggal kemarin = hari ini dikurangi 1 hari. Jangan mengurangi string 'YYYY-MM-DD';
// pakai Date.UTC seperti di bagianTanggal() dan ics.js.
function labelHari(iso) {
  if (iso === hariIniLokal()) return 'Hari ini';
  return tanggalPendek(iso);
}

// Satu baris ringkas. Ketuk barisnya untuk membuka tombol Ubah dan Hapus.
function barisTransaksi(t) {
  const masuk = t.tipe === 'masuk';
  const aksi = el('div', { class: 'aksi', hidden: '' },
    el('button', { class: 'tombol kecil', type: 'button', onclick: (ev) => bukaFormUbah(t, ev.currentTarget.closest('li')) }, 'Ubah'),
    el('button', { class: 'tombol kecil pink', type: 'button', onclick: () => hapusTransaksi(t) }, 'Hapus')
  );
  const baris = el('button', {
    class: 'trx-baris',
    type: 'button',
    'aria-expanded': 'false',
    onclick: (ev) => {
      const akanBuka = aksi.hidden;
      aksi.hidden = !akanBuka;
      ev.currentTarget.setAttribute('aria-expanded', String(akanBuka));
    },
  },
    el('span', { class: 'trx-teks' },
      el('span', { class: 'trx-nama' }, t.catatan || t.kategori),
      t.catatan ? el('span', { class: 'chip' }, t.kategori) : null
    ),
    el('span', { class: 'nominal' + (masuk ? ' masuk' : '') }, (masuk ? '+' : '') + rupiah(t.nominal))
  );
  return el('li', { class: 'trx' }, baris, aksi);
}

// ---------- Aksi ----------
async function muatDaftar() {
  const r = await kirim('transaksi');
  if (!r.ok) return tampilPesan(r.pesan, 'galat');
  renderDaftar(r.transaksi);
}

async function muat() {
  const p = bacaPengaturan();
  if (!p.url || !p.kode) {
    renderBudget(null);
    renderDaftar([]);
    $('pengaturan').open = true;
    return;
  }
  const [ringkasan, transaksi] = await Promise.all([kirim('ringkasan'), kirim('transaksi')]);
  if (!ringkasan.ok) { renderBudget(null); return tampilPesan(ringkasan.pesan, 'galat'); }
  renderBudget(ringkasan.ringkasan);
  if (!transaksi.ok) return tampilPesan(transaksi.pesan, 'galat');
  renderDaftar(transaksi.transaksi);
}

async function kirimCatatan(ev) {
  ev.preventDefault();
  const isi = $('chat').value.trim();
  if (!isi) return;

  sibuk(true);
  const r = await kirim('catat', { teks: isi });
  sibuk(false);

  if (!r.ok) return tampilPesan(r.pesan, 'galat');
  if (r.status === 'tanya') return tampilPesan(r.pertanyaan, 'tanya'); // teks tetap di kolom supaya bisa diperbaiki

  $('chat').value = '';
  const baris = r.tersimpan.map((t) => (t.tipe === 'masuk' ? 'Pemasukan: ' : 'Dicatat: ') + rupiah(t.nominal) + ', ' + t.kategori + '.');
  if (r.perlu_konfirmasi_budget.length) baris.push('Uang saku terdeteksi. Pilih tujuannya di bawah.');
  tampilPesan(baris.join('\n'), r.perlu_konfirmasi_budget.length ? 'tanya' : 'ok');
  tampilKonfirmasiBudget(r.perlu_konfirmasi_budget, r.sisa);
  renderBudget(r.sisa);
  muatDaftar();
}

// Uang saku BELUM disimpan sampai kamu memilih: minggu baru atau tambahan.
// Kalau belum ada periode sama sekali, "tambahan" tidak ditawarkan.
function tampilKonfirmasiBudget(daftar, sisa) {
  const wadah = $('konfirmasi-budget');
  for (const b of daftar) {
    const tombol = [];
    const kotak = el('div', { class: 'konfirmasi tanya' },
      el('p', {}, 'Uang saku ' + rupiah(b.nominal) + (b.sumber ? ' (' + b.sumber + ')' : '') + ', ' + tanggalPendek(b.tanggal) + '. Ini untuk apa?'),
      el('div', { class: 'aksi' },
        ...[['baru', 'Minggu baru'], ...(sisa && sisa.ada_periode ? [['tambah', 'Tambahan minggu ini']] : [])].map(([mode, label]) => {
          const t = el('button', { class: 'tombol kecil', type: 'button', onclick: () => simpanBudgetKonfirmasi(b, mode, kotak, tombol) }, label);
          tombol.push(t);
          return t;
        })
      )
    );
    wadah.appendChild(kotak);
  }
}

async function simpanBudgetKonfirmasi(b, mode, kotak, tombol) {
  tombol.forEach((t) => { t.disabled = true; });
  const r = await kirim('budget', { nominal: b.nominal, tanggal: b.tanggal, sumber: b.sumber, mode: mode });
  if (!r.ok) {
    tombol.forEach((t) => { t.disabled = false; });
    return tampilPesan(r.pesan, 'galat');
  }
  kotak.remove();
  tampilPesan('Budget tersimpan.', 'ok');
  renderBudget(r.sisa);
  muatDaftar();
}

async function kirimBudget(ev) {
  ev.preventDefault();
  const mode = document.querySelector('input[name="bg-mode"]:checked').value;
  const tombol = $('tombol-budget');
  tombol.disabled = true;
  const r = await kirim('budget', { nominal: $('bg-nominal').value, tanggal: $('bg-tanggal').value, sumber: $('bg-sumber').value, mode: mode });
  tombol.disabled = false;
  if (!r.ok) return tampilPesan(r.pesan, 'galat');

  $('form-budget').reset();
  setTanggalDefault();
  $('isi-budget').open = false;
  tampilPesan('Budget tersimpan.', 'ok');
  renderBudget(r.sisa);
  muatDaftar();
}

function fokusBudget() {
  const d = $('isi-budget');
  d.open = true;
  if (typeof d.scrollIntoView === 'function') d.scrollIntoView();
  $('bg-nominal').focus();
}

// Tautan di kalender memakai #isi-budget; membukanya langsung menampilkan formnya
function bukaFormBudgetBilaPerlu() {
  if (location.hash === '#isi-budget') fokusBudget();
}

function unduhPengingat(ev) {
  ev.preventDefault();
  const [jam, menit] = $('pg-jam').value.split(':').map(Number);
  const url = location.href.split('#')[0] + '#isi-budget';

  let isi;
  try {
    isi = ICS.buatICS({ hariMinggu: Number($('pg-hari').value), jam: jam, menit: menit, url: url, hariIni: hariIniLokal() });
  } catch (e) {
    return tampilPesan('Pengingat belum bisa dibuat: ' + e.message, 'galat');
  }

  const href = URL.createObjectURL(new Blob([isi], { type: 'text/calendar;charset=utf-8' }));
  const a = el('a', { href: href, download: 'pengingat-budget.ics' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);

  const lokal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  tampilPesan(
    'File pengingat diunduh. Buka file itu untuk menambahkannya ke kalender.' +
      (lokal ? '\nCatatan: tautannya menunjuk ke alamat lokal. Unduh lagi dari situs yang sudah online.' : ''),
    lokal ? 'tanya' : 'ok'
  );
}

async function hapusTransaksi(t) {
  if (!window.confirm('Hapus ' + rupiah(t.nominal) + ' (' + t.kategori + ')?')) return;
  const r = await kirim('hapus', { id: t.id });
  if (!r.ok) return tampilPesan(r.pesan, 'galat');
  tampilPesan('Dihapus.', 'ok');
  renderBudget(r.sisa);
  muatDaftar();
}

function bukaFormUbah(t, li) {
  const nominal = el('input', { type: 'text', id: 'u-nominal', value: String(t.nominal), inputmode: 'numeric' });
  const kategori = el('select', { id: 'u-kategori' },
    ...KATEGORI.map((k) => { const o = el('option', { value: k }, k); o.selected = k === t.kategori; return o; })
  );
  const catatan = el('input', { type: 'text', id: 'u-catatan', value: t.catatan || '', maxlength: '60' });

  const form = el('form', {
    class: 'form-ubah',
    onsubmit: async (ev) => {
      ev.preventDefault();
      const r = await kirim('ubah', { id: t.id, nominal: nominal.value, kategori: kategori.value, catatan: catatan.value });
      if (!r.ok) return tampilPesan(r.pesan, 'galat');
      tampilPesan('Diubah.', 'ok');
      renderBudget(r.sisa);
      muatDaftar();
    },
  },
    el('label', { for: 'u-nominal' }, 'Nominal'), nominal,
    el('label', { for: 'u-kategori' }, 'Kategori'), kategori,
    el('label', { for: 'u-catatan' }, 'Catatan'), catatan,
    el('div', { class: 'aksi' },
      el('button', { class: 'tombol kecil', type: 'submit' }, 'Simpan'),
      el('button', { class: 'tombol kecil pink', type: 'button', onclick: () => renderDaftar(daftarTerakhir) }, 'Batal')
    )
  );
  li.replaceChildren(form);
  nominal.focus();
}

// ---------- Saran (di-cache di browser, tidak diminta otomatis supaya kuota AI hemat) ----------
const ALASAN = {
  batas_harian: 'Batas permintaan AI hari ini sudah habis.',
  ai_gagal: 'AI sedang bermasalah.',
  tidak_valid: 'Jawaban AI tidak lolos pemeriksaan.',
  belum_ada_periode: 'Belum ada budget aktif.',
};

function bacaSaranCache() {
  try { return JSON.parse(localStorage.getItem(KUNCI_SARAN) || 'null'); } catch (e) { return null; }
}
function simpanSaranCache(data) {
  try { localStorage.setItem(KUNCI_SARAN, JSON.stringify(data)); } catch (e) { /* abaikan */ }
}

function renderSaran(data) {
  const ada = !!(data && data.saran);
  $('saran-kosong').hidden = ada;
  $('saran-isi').hidden = !ada;
  if (!ada) return;

  const tingkat = ['aman', 'waspada', 'bahaya'].includes(data.saran.tingkat) ? data.saran.tingkat : 'waspada';
  const chip = $('saran-tingkat');
  chip.textContent = 'Tingkat: ' + tingkat; // kata, bukan hanya warna
  chip.className = 'chip tingkat-' + tingkat;
  teks('saran-ringkasan', data.saran.ringkasan);
  $('saran-daftar').replaceChildren(...data.saran.saran.map((t) => el('li', {}, t)));

  const dibuat = data.tanggal ? ' Dibuat ' + tanggalPendek(data.tanggal) + '.' : '';
  if (data.sumber === 'ai') {
    teks('saran-sumber', (data.dari_cache ? 'Ditulis AI. Datamu belum berubah sejak saran terakhir.' : 'Ditulis AI dari ringkasan angkamu.') + dibuat);
  } else {
    teks('saran-sumber', 'Saran otomatis tanpa AI. ' + (ALASAN[data.alasan] || '') + dibuat);
  }
}

async function mintaSaran() {
  const tombol = $('tombol-saran');
  tombol.disabled = true;
  tombol.textContent = 'Menyiapkan saran...';
  const r = await kirim('saran');
  tombol.disabled = false;
  tombol.textContent = 'Minta saran baru';
  if (!r.ok) return tampilPesan(r.pesan, 'galat');

  const data = { saran: r.saran, sumber: r.sumber, alasan: r.alasan, dari_cache: r.dari_cache, tanggal: hariIniLokal() };
  simpanSaranCache(data);
  renderSaran(data);
  if (r.batas_saran) teks('saran-batas', 'Permintaan AI hari ini: ' + r.batas_saran.dipakai + ' dari ' + r.batas_saran.maks + '.');
}

function simpanFormPengaturan(ev) {
  ev.preventDefault();
  const lama = bacaPengaturan();
  const url = $('p-url').value.trim();
  const kode = $('p-kode').value || lama.kode; // kosong = pakai kode yang tersimpan
  if (!urlAman(url)) return tampilPesan('Alamat API harus diawali https:// (atau http://localhost untuk server lokal).', 'galat');
  if (!kode) return tampilPesan('Kode akses belum diisi.', 'galat');
  if (!simpanPengaturan({ url: url, kode: kode })) return tampilPesan('Browser menolak menyimpan pengaturan.', 'galat');
  $('p-kode').value = '';
  $('pengaturan').open = false;
  tampilPesan('Pengaturan tersimpan.', 'ok');
  muat();
}

// ---------- Mulai ----------
$('form-chat').addEventListener('submit', kirimCatatan);
$('form-pengaturan').addEventListener('submit', simpanFormPengaturan);
$('form-budget').addEventListener('submit', kirimBudget);
$('form-pengingat').addEventListener('submit', unduhPengingat);
$('tombol-isi-budget').addEventListener('click', fokusBudget);
$('tombol-saran').addEventListener('click', mintaSaran);
window.addEventListener('hashchange', bukaFormBudgetBilaPerlu);
$('p-url').value = bacaPengaturan().url || '';
setTanggalDefault();
renderSaran(bacaSaranCache());
muat();
bukaFormBudgetBilaPerlu();