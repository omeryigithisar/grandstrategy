const fs = require('fs');
const SAVE_FILE = 'oyun_kaydi.json';

// Oyun verisini yükle veya oluştur
function oyunVerisiniYukle() {
    if (fs.existsSync(SAVE_FILE)) {
        return JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    }
    return { gun: 1, eyaletler: {}, oyuncular: {} };
}

let gameState = oyunVerisiniYukle();

// Her 10 saniyede bir veriyi otomatik kaydet
setInterval(() => {
    fs.writeFileSync(SAVE_FILE, JSON.stringify(gameState, null, 2));
    console.log("Oyun durumu kaydedildi.");
}, 10000);

// server.js - Tam Sürüm
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

let gameState = {
    gun: 1,
    eyaletler: {}, 
    oyuncular: {} 
};
// OYUNUN BAŞKENTLERİ (Haritadaki 'name' verisiyle aynı olmalı)
const baskentler = {
    "Turkey": "Ankara",
    "Syria": "Hasaka (Al Haksa)", // Test edebilmen için Hasakah yaptım, sonra "Damascus" yaparsın.
    "Iraq": "Baghdad",
    "Greece": "Attica",
    "Iran": "Tehran"
};
io.on('connection', (socket) => {
    socket.emit('init', gameState);

    // 1. ÜLKE SEÇME SİSTEMİ
    socket.on('ulkeSec', (ulkeAdi) => {
        let ulkeDoluMu = Object.values(gameState.oyuncular).some(p => p.ulke === ulkeAdi);

        if (ulkeDoluMu) {
            socket.emit('hataMesaji', `Bu ülke (${ulkeAdi}) şu anda başka bir oyuncu tarafından yönetiliyor!`);
        } else {
            gameState.oyuncular[socket.id] = { ulke: ulkeAdi, para: 1000 };
            socket.emit('ulkeSecildi', ulkeAdi); 
            io.emit('stateGuncelle', gameState); 
        }
    });

    // 2. ÜRETİM SİSTEMİ
    socket.on('islemYap', (data) => {
        const oyuncu = gameState.oyuncular[socket.id];
        if (!oyuncu) return;

        if (!gameState.eyaletler[data.eyaletId]) {
            gameState.eyaletler[data.eyaletId] = { sivil: 0, askeri: 0, ordu: 1, sahibi: data.sahibi };
        }

        let eyalet = gameState.eyaletler[data.eyaletId];

        if (data.tur === 'ordu' && oyuncu.para >= 100) {
            oyuncu.para -= 100;
            eyalet.ordu += 1;
        } else if (data.tur === 'sivil' && oyuncu.para >= 300) {
            oyuncu.para -= 300;
            eyalet.sivil += 1;
        }
        io.emit('stateGuncelle', gameState);
    });

 // YENİ SALDIRI VE İLHAK SİSTEMİ
socket.on('saldiri', (data) => {
    const saldirgan = gameState.oyuncular[socket.id];
    if (!saldirgan) return;

    let hedefEyaletId = data.id;
    let eyaletIsmi = data.isim || "Bilinmeyen Eyalet";
    // İstemciden gelen asıl sahibini kullanıyoruz ki sunucu ilk defa görüyorsa bilsin
    let eskiSahibi = data.eskiSahibi || "Nötr"; 

    if (!gameState.eyaletler[hedefEyaletId]) {
        gameState.eyaletler[hedefEyaletId] = { sivil: 0, askeri: 0, ordu: 1, sahibi: eskiSahibi };
    }

    let hedef = gameState.eyaletler[hedefEyaletId];
    let basariliMi = Math.random() > 0.4; // %60 kazanma şansı

    if (basariliMi) {
        hedef.sahibi = saldirgan.ulke;

        // 🔥 BAŞKENT KONTROLÜ (Eğer düşen yer başkent ise)
        if (baskentler[eskiSahibi] && baskentler[eskiSahibi] === eyaletIsmi) {
            // Sunucunun bildiği tüm eski toprakları yeni sahibine devret
            Object.values(gameState.eyaletler).forEach(e => {
                if (e.sahibi === eskiSahibi) e.sahibi = saldirgan.ulke;
            });

            let mesaj = `🔥 BÜYÜK ZAFER! ${saldirgan.ulke}, ${eskiSahibi} başkenti ${eyaletIsmi}'ni düşürdü ve tüm ülkeyi İLHAK ETTİ!`;
            
            // Tüm oyunculara özel 'İlhak' eventi gönderiyoruz ki harita anında boyansın
            io.emit('ulkeIlhakEdildi', { kaybeden: eskiSahibi, kazanan: saldirgan.ulke, mesaj: mesaj });
        } else {
            // Normal Eyalet İşgali
            let mesajSaldiran = `${saldirgan.ulke}, ${eskiSahibi} toprağı olan ${eyaletIsmi} eyaletini işgal etti!`;
            socket.emit('savasSonucu', { kazanan: true, mesaj: mesajSaldiran });

            let savunanSoketId = Object.keys(gameState.oyuncular).find(id => gameState.oyuncular[id].ulke === eskiSahibi);
            if (savunanSoketId) {
                io.to(savunanSoketId).emit('savasSonucu', { kazanan: false, mesaj: `DÜŞMAN GELDİ! ${saldirgan.ulke}, senin ${eyaletIsmi} eyaletini işgal etti!` });
            }
        }
    } else {
        socket.emit('savasSonucu', { kazanan: false, mesaj: `${eyaletIsmi} saldırısı başarısız oldu!` });
    }
    io.emit('stateGuncelle', gameState);
});

    socket.on('disconnect', () => {
        delete gameState.oyuncular[socket.id];
    });
});

// Gün Sayacı ve Maaş
// Gün Sayacı ve Dinamik Maaş Sistemi (Sivil Fabrika Odaklı)
setInterval(() => {
    gameState.gun++;
    
    Object.keys(gameState.oyuncular).forEach(socketId => {
        const oyuncu = gameState.oyuncular[socketId];
        
        // 1. Oyuncunun dünyada sahip olduğu tüm eyaletlerdeki sivil fabrikaları topla
        let toplamSivilFabrika = 0;
        
        Object.keys(gameState.eyaletler).forEach(eyaletId => {
            let eyalet = gameState.eyaletler[eyaletId];
            // Eğer eyaletin sahibi bu oyuncunun ülkesi ise fabrikalarını hesaba kat
            if (eyalet.sahibi === oyuncu.ulke) {
                toplamSivilFabrika += (eyalet.sivil || 0);
            }
        });

        // 2. Gelir Hesaplama: Temel Gelir (50) + (Fabrika Sayısı * 2)
        let fabrikaGeliri = toplamSivilFabrika * 2;
        let toplamKazanc = 50 + fabrikaGeliri;

        // 3. Parayı oyuncunun hazinesine ekle
        oyuncu.para += toplamKazanc;
        
        // Konsoldan takip etmek istersen (Log)
        console.log(`💰 ${oyuncu.ulke} oyuncusu ${toplamSivilFabrika} fabrikadan +${fabrikaGeliri} altın aldı. Toplam yeni gelir: +${toplamKazanc}`);
    });
    
    io.emit('stateGuncelle', gameState);
}, 1500);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});