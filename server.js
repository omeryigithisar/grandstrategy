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

// server.js - Tam ve Düzeltilmiş Sürüm
const express = require('express');
const app = express();
// Hata buradaydı: İsmini 'server' yaptık ki en alttaki server.listen ile tam eşleşsin!
const server = require('http').createServer(app);
const io = require('socket.io')(server, { cors: { origin: "*" } });

if (!gameState || !gameState.gun) {
    gameState = {
        gun: 1,
        eyaletler: {},
        oyuncular: {}
    };
}

// OYUNUN BAŞKENTLERİ (Haritadaki 'name' verisiyle aynı olmalı)
const baskentler = {
    "Turkey": "Ankara",
    "Syria": "Hasaka (Al Haksa)", // Test edebilmen için Hasakah yaptım, sonra "Damascus" yaparsın
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
            socket.emit('hata', 'Bu ülke zaten seçilmiş!');
            return;
        }

        // Oyuncuyu kaydet
        gameState.oyuncular[socket.id] = {
            ulke: ulkeAdi,
            para: 500,
            baskent: baskentler[ulkeAdi] || "Bilinmiyor"
        };

        // Eğer haritada bu ülkenin eyaletleri henüz oluşturulmadıysa ilk kurulumu yap
        // Not: Gerçek harita verilerine göre (admin1.json) eyalet ID'lerini eşitlemelisin.
        
        socket.emit('ulkeOnay', gameState.oyuncular[socket.id]);
        io.emit('guncelleme', gameState);
    });

    // 2. EYALET İŞLEMLERİ (ASKER ÜRETİMİ / FABRİKA KURUMU)
    socket.on('eyaletIslem', (data) => {
        const oyuncu = gameState.oyuncular[socket.id];
        if (!oyuncu) return;

        const { eyaletId, tip } = data;
        
        // Eyalet haritada yoksa önce oluştur
        if (!gameState.eyaletler[eyaletId]) {
            gameState.eyaletler[eyaletId] = { sahibi: oyuncu.ulke, ordu: 1, sivil: 0, askeri: 0 };
        }

        const eyalet = gameState.eyaletler[eyaletId];

        if (eyalet.sahibi !== oyuncu.ulke) {
            socket.emit('hata', 'Bu eyalet senin değil!');
            return;
        }

        if (tip === 'ordu') {
            if (oyuncu.para >= 100) {
                oyuncu.para -= 100;
                eyalet.ordu = (eyalet.ordu || 0) + 1;
            } else {
                socket.emit('hata', 'Yetersiz altın!');
            }
        } else if (tip === 'sivil') {
            if (oyuncu.para >= 300) {
                oyuncu.para -= 300;
                eyalet.sivil = (eyalet.sivil || 0) + 1;
            } else {
                socket.emit('hata', 'Yetersiz altın!');
            }
        }

        io.emit('guncelleme', gameState);
    });

    // 3. SAVAŞ VE SALDIRI SİSTEMİ
    socket.on('savasAc', (data) => {
        const oyuncu = gameState.oyuncular[socket.id];
        if (!oyuncu) return;

        const { saldiranId, savunanId } = data;
        const saldiranEyalet = gameState.eyaletler[saldiranId];
        const savunanEyalet = gameState.eyaletler[savunanId];

        if (!saldiranEyalet || saldiranEyalet.sahibi !== oyuncu.ulke) return;
        if (!savunanEyalet || savunanEyalet.sahibi === oyuncu.ulke) return;

        // Basit Zar/Güç Mekaniği
        let saldiranGucu = saldiranEyalet.ordu * (Math.random() * 0.4 + 0.8);
        let savunanGucu = (savunanEyalet.ordu || 1) * (Math.random() * 0.4 + 0.9); // Savunma avantajı

        if (saldiranGucu > savunanGucu) {
            // Saldıran kazandı
            const eskiSahibi = savunanEyalet.sahibi;
            savunanEyalet.sahibi = oyuncu.ulke;
            savunanEyalet.ordu = Math.max(1, Math.floor(saldiranEyalet.ordu * 0.4));
            saldiranEyalet.ordu = Math.max(1, Math.floor(saldiranEyalet.ordu * 0.3));

            socket.emit('savasSonucu', { kazanan: true, mesaj: 'Zafer! Eyalet ele geçirildi!' });
            
            // Eğer savunma yapanın hiç eyaleti kalmadıysa İlhak (Annexation) tetikle
            let kalanEyaletSayisi = Object.values(gameState.eyaletler).filter(e => e.sahibi === eskiSahibi).length;
            if (kalanEyaletSayisi === 0 && eskiSahibi) {
                io.emit('ulkeIlhakEdildi', { kazanan: oyuncu.ulke, kaybeden: eskiSahibi, mesaj: `${eskiSahibi} devleti tamamen ilhak edildi!` });
            }
        } else {
            // Savunan kazandı
            saldiranEyalet.ordu = Math.max(1, Math.floor(saldiranEyalet.ordu * 0.2));
            savunanEyalet.ordu = Math.max(1, Math.floor(savunanEyalet.ordu * 0.5));
            socket.emit('savasSonucu', { kazanan: false, mesaj: 'Saldırı başarısız oldu, ordumuz eridi!' });
        }

        io.emit('guncelleme', gameState);
    });

    socket.on('disconnect', () => {
        delete gameState.oyuncular[socket.id];
    });
});

// Gün Sayacı ve Dinamik Maaş Sistemi (Sivil Fabrika Odaklı)
setInterval(() => {
    gameState.gun++;
    
    Object.keys(gameState.oyuncular).forEach(socketId => {
        const oyuncu = gameState.oyuncular[socketId];
        
        // Oyuncunun dünyada sahip olduğu tüm eyaletlerdeki sivil fabrikaları topla
        let toplamSivilFabrika = 0;
        
        Object.keys(gameState.eyaletler).forEach(eyaletId => {
            let eyalet = gameState.eyaletler[eyaletId];
            if (eyalet.sahibi === oyuncu.ulke) {
                toplamSivilFabrika += (eyalet.sivil || 0);
            }
        });

        // Gelir Hesaplama: Temel Gelir (50) + (Fabrika Sayısı * 2)
        let fabrikaGeliri = toplamSivilFabrika * 2;
        let toplamKazanc = 50 + fabrikaGeliri;

        oyuncu.para += toplamKazanc;
    });

    io.emit('guncelleme', gameState);
}, 20000); // Her 20 saniyede bir gün döner ve para eklenir

// Render ve Yerel Port Ayarı
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda başarıyla çalışıyor...`);
});