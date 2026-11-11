// tests/db-memori.js
// Penyimpanan palsu (array di memori) dengan bentuk yang sama seperti
// buatPenyimpananSheet() di backend/simpan.js. Dipakai tes dan server lokal.
function buatDbMemori() {
  let urut = 0;
  const T = [];
  const P = [];
  const salin = (x) => ({ ...x });
  const cache = new Map();
  return {
    daftarTransaksi: () => T.map(salin),
    tambahTransaksi: (t) => { const r = { id: 't' + ++urut, ...t, dibuat_pada: 'x' + urut }; T.push(r); return salin(r); },
    ubahTransaksi: (id, p) => { const r = T.find((x) => x.id === id); if (!r) return null; Object.assign(r, p); return salin(r); },
    hapusTransaksi: (id) => { const i = T.findIndex((x) => x.id === id); if (i < 0) return false; T.splice(i, 1); return true; },
    ambilCache: (k) => (cache.has(k) ? JSON.parse(cache.get(k)) : null),
    simpanCache: (k, v) => { cache.set(k, JSON.stringify(v)); },
    daftarPeriode: () => P.map(salin),
    tambahPeriode: (p) => { const r = { id: 'p' + ++urut, ...p, dibuat_pada: 'x' + urut }; P.push(r); return salin(r); },
    ubahPeriode: (id, p) => { const r = P.find((x) => x.id === id); if (!r) return null; Object.assign(r, p); return salin(r); },
  };
}

module.exports = { buatDbMemori };
