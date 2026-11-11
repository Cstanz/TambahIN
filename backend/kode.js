// backend/kode.js
// Pintu masuk web app Apps Script. Sengaja tipis: periksa kunci, kunci akses
// tulis, lalu serahkan ke tangani() di api.js. Hanya jalan di Apps Script.

const BATAS_CATAT_PER_HARI = 100; // melindungi kuota LLM gratis
const BATAS_SARAN_PER_HARI = 5;   // permintaan saran ke LLM per hari (cache tidak dihitung)
const BATAS_SALAH_KODE = 10;      // setelah ini, semua permintaan ditolak 15 menit

function keluaranJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// GET hanya untuk cek hidup. Data TIDAK pernah dikirim lewat GET, karena
// parameter di URL ikut tercatat di riwayat browser dan log.
function doGet() {
  return keluaranJSON({ ok: true, pesan: 'API aktif.' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents); // frontend kirim text/plain berisi JSON
  } catch (err) {
    return keluaranJSON({ ok: false, pesan: 'Format permintaan salah.' });
  }
  if (!req || typeof req !== 'object') return keluaranJSON({ ok: false, pesan: 'Format permintaan salah.' });

  if (!kodeAksesBenar(req.kode)) return keluaranJSON({ ok: false, pesan: 'Kode akses salah.' });

  // Satu permintaan menulis pada satu waktu (mencegah dua tulisan saling menimpa)
  const kunci = LockService.getScriptLock();
  try {
    kunci.waitLock(10000);
  } catch (err) {
    return keluaranJSON({ ok: false, pesan: 'Server sibuk, coba lagi.' });
  }

  try {
    const hariIni = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
    if (req.aksi === 'catat' && !pakaiKuota('pakai_llm', hariIni, BATAS_CATAT_PER_HARI)) {
      return keluaranJSON({ ok: false, pesan: 'Batas pemakaian AI hari ini tercapai. Coba lagi besok.' });
    }
    // Untuk saran, kuota dipakai HANYA kalau benar-benar akan memanggil LLM (bukan saat cache kena)
    const izin = { pakaiLLM: function () { return pakaiKuota('pakai_saran', hariIni, BATAS_SARAN_PER_HARI); } };
    const hasil = tangani(req, buatPenyimpananSheet(), hariIni, undefined, izin);
    if (req.aksi === 'saran' && hasil.ok) {
      hasil.batas_saran = { dipakai: bacaKuota('pakai_saran', hariIni), maks: BATAS_SARAN_PER_HARI };
    }
    return keluaranJSON(hasil);
  } catch (err) {
    console.error(err); // detail hanya di log Apps Script
    return keluaranJSON({ ok: false, pesan: 'Terjadi kesalahan di server.' });
  } finally {
    kunci.releaseLock();
  }
}

function kodeAksesBenar(kode) {
  const cache = CacheService.getScriptCache();
  const gagal = Number(cache.get('gagal_akses') || 0);
  if (gagal >= BATAS_SALAH_KODE) return false;

  const asli = PropertiesService.getScriptProperties().getProperty('KODE_AKSES');
  const benar = !!asli && typeof kode === 'string' && kode === asli;
  if (!benar) cache.put('gagal_akses', String(gagal + 1), 900); // 900 detik
  return benar;
}

// Pencatat kuota harian: disimpan sebagai "tanggal:jumlah" di Script Properties.
function bacaKuota(nama, hariIni) {
  const simpanan = (PropertiesService.getScriptProperties().getProperty(nama) || '').split(':');
  return simpanan[0] === hariIni ? Number(simpanan[1]) : 0;
}

function pakaiKuota(nama, hariIni, maks) {
  const jumlah = bacaKuota(nama, hariIni);
  if (jumlah >= maks) return false;
  PropertiesService.getScriptProperties().setProperty(nama, hariIni + ':' + (jumlah + 1));
  return true;
}

// Untuk uji dari editor Apps Script (tombol Run), tanpa lewat internet.
function ujiDariEditor() {
  const hariIni = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  const hasil = tangani({ aksi: 'catat', teks: 'kopi 12rb' }, buatPenyimpananSheet(), hariIni);
  console.log(JSON.stringify(hasil, null, 2));
}
