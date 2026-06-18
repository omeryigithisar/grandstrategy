const fs = require('fs');
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, { cors: { origin: "*" } });

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

if (!gameState || !gameState.gun) {
    gameState = { gun: 1, eyaletler: {}, oyuncular: {} };
}

const baskentler = {
    "Turkey": "Ankara", "Syria": "Hasaka (Al Haksa)", "Iraq": "Baghdad", "Greece": "Attica", "Iran": "Tehran"
};

io.on('connection', (socket) => {
    socket.emit('init', gameState);

    // 1. ÜLKE SEÇME SİSTEMİ
    socket.on('ulkeSec', (ulkeAdi) => {
        let ulkeDoluMu = Object.values(gameState.oyuncular).some(p => p.ulke === ulkeAdi);
        if (ulkeDoluMu) {
            socket.emit('hataMesaji', 'Bu ülke zaten seçilmiş!');
            return;
        }

        gameState.oyuncular[socket.id] = {
            ulke: ulkeAdi,
            para: 500,
            baskent: baskentler[ulkeAdi] || "Bilinmiyor",
            teknolojiler: { piyade: false, taktik: false, fuze: false, icbm: false } // Teknoloji eklendi
        };

        socket.emit('ulkeSecildi', ulkeAdi);
        io.emit('stateGuncelle', gameState);
    });

    // 2. EYALET İŞLEMLERİ (ASKER ÜRETİMİ / FABRİKA KURUMU)
    socket.on('islemYap', (data) => {
        const oyuncu = gameState.oyuncular[socket.id];
        if (!oyuncu) return;
        const { eyaletId, tur } = data;
        
        if (!gameState.eyaletler[eyaletId]) {
            gameState.eyaletler[eyaletId] = { sahibi: oyuncu.ulke, ordu: 1, sivil: 0, askeri: 0 };
        }

        const eyalet = gameState.eyaletler[eyaletId];

        if (eyalet.sahibi !== oyuncu.ulke) {
            socket.emit('hataMesaji', 'Bu eyalet senin değil!');
            return;
        }

        if (tur === 'ordu') {
            if (oyuncu.para >= 100) { oyuncu.para -= 100; eyalet.ordu = (eyalet.ordu || 0) + 1; } 
            else { socket.emit('hataMesaji', 'Yetersiz altın!'); }
        } else if (tur === 'sivil') {
            if (oyuncu.para >= 300) { oyuncu.para -= 300; eyalet.sivil = (eyalet.sivil || 0) + 1; } 
            else { socket.emit('hataMesaji', 'Yetersiz altın!'); }
        }
        io.emit('stateGuncelle', gameState);
    });

    // 3. SAVAŞ VE SALDIRI SİSTEMİ (HAYALET EYALET VE TEKNOLOJİ DÜZELTMELİ)
    socket.on('saldiri', (data) => {
        const oyuncu = gameState.oyuncular[socket.id];
        if (!oyuncu) return;

        const savunanId = data.id;

        if (!gameState.eyaletler[savunanId]) {
            gameState.eyaletler[savunanId] = {
                sahibi: data.eskiSahibi || "Nötr",
                ordu: 1,
                sivil: 0,
                askeri: 0
            };
        }

        const savunanEyalet = gameState.eyaletler[savunanId];
        if (savunanEyalet.sahibi === oyuncu.ulke) return;

        let saldiranId = null;
        let maxOrdu = -1;
        Object.keys(gameState.eyaletler).forEach(eId => {
            let e = gameState.eyaletler[eId];
            if (e.sahibi === oyuncu.ulke && (e.ordu || 1) > maxOrdu) {
                maxOrdu = (e.ordu || 1);
                saldiranId = eId;
            }
        });

        if (!saldiranId) {
            socket.emit('hataMesaji', 'Orduların toplanmadı! Önce kendi ülkenden bir eyalete asker üret.');
            return;
        }

        const saldiranEyalet = gameState.eyaletler[saldiranId];

        let saldiranBonus = oyuncu.teknolojiler?.piyade ? 1.3 : 1.0;
        let savunanBonus = 1.0;
        const savunanSahibi = savunanEyalet.sahibi;
        const savunanOyuncuSocket = Object.keys(gameState.oyuncular).find(sId => gameState.oyuncular[sId].ulke === savunanSahibi);
        if (savunanOyuncuSocket && gameState.oyuncular[savunanOyuncuSocket].teknolojiler?.taktik) {
            savunanBonus = 1.4;
        }

        let saldiranGucu = saldiranEyalet.ordu * (Math.random() * 0.4 + 0.8) * saldiranBonus;
        let savunanGucu = savunanEyalet.ordu * (Math.random() * 0.4 + 0.9) * savunanBonus;

if (saldiranGucu > savunanGucu) {
            const eskiSahibi = savunanEyalet.sahibi;
            savunanEyalet.sahibi = oyuncu.ulke;
            savunanEyalet.ordu = Math.max(1, Math.floor(saldiranEyalet.ordu * 0.4));
            saldiranEyalet.ordu = Math.max(1, Math.floor(saldiranEyalet.ordu * 0.3));

            socket.emit('savasSonucu', { kazanan: true, mesaj: `Zafer! ${data.isim} ele geçirildi!` });
            
            // ESKİ İLHAK KONTROLÜNÜ BURADAN SİLDİK (Çünkü her başarılı saldırıda 
            // ülkeyi ilhak edip haritayı bozuyordu. Artık sadece eyalet eyalet ilerleyeceksin.)
            
        } else {
            // ... (Aynı kalsın)
        }
        io.emit('stateGuncelle', gameState);
    });

    // 4. TEKNOLOJİ ARAŞTIRMA SİSTEMİ
    const techMaliyetleri = { piyade: 200, taktik: 400, fuze: 600, icbm: 1000 };
    socket.on('teknolojiArastir', (techId) => {
        const oyuncu = gameState.oyuncular[socket.id];
        if (!oyuncu) return;
        if (!oyuncu.teknolojiler) oyuncu.teknolojiler = { piyade: false, taktik: false, fuze: false, icbm: false };

        if (oyuncu.teknolojiler[techId]) {
            socket.emit('hataMesaji', 'Bu teknoloji zaten araştırıldı!');
            return;
        }
        if (techId === 'icbm' && !oyuncu.teknolojiler.fuze) {
            socket.emit('hataMesaji', 'Önce Füze Teknolojisini araştırmalısın!');
            return;
        }

        const maliyet = techMaliyetleri[techId];
        if (oyuncu.para >= maliyet) {
            oyuncu.para -= maliyet;
            oyuncu.teknolojiler[techId] = true;
            socket.emit('savasSonucu', { kazanan: true, mesaj: `🔬 BAŞARILI: ${techId.toUpperCase()} Teknolojisi Geliştirildi!` });
            io.emit('stateGuncelle', gameState);
        } else {
            socket.emit('hataMesaji', 'Teknoloji için yeterli altınınız yok!');
        }
    });

    // 5. ICBM NÜKLEER FIRLATMA SİSTEMİ
    socket.on('icbmFirlat', (data) => {
        const oyuncu = gameState.oyuncular[socket.id];
        if (!oyuncu || !oyuncu.teknolojiler?.icbm) {
            socket.emit('hataMesaji', 'ICBM teknolojisine sahip değilsin!');
            return;
        }
        if (oyuncu.para < 500) {
            socket.emit('hataMesaji', 'Füze fırlatmak için 500 altına ihtiyacın var!');
            return;
        }

        const hedefId = data.id;
        if (!gameState.eyaletler[hedefId]) {
            gameState.eyaletler[hedefId] = { sahibi: data.eskiSahibi || "Nötr", ordu: 1, sivil: 0, askeri: 0 };
        }
        const hedefEyalet = gameState.eyaletler[hedefId];
        if (hedefEyalet.sahibi === oyuncu.ulke) return;

        oyuncu.para -= 500;
        hedefEyalet.ordu = Math.max(1, Math.floor(hedefEyalet.ordu * 0.1));

        io.emit('ulkeIlhakEdildi', { 
            kazanan: oyuncu.ulke, 
            kaybeden: hedefEyalet.sahibi, 
            mesaj: `🚀 NÜKLEER ALARM! ${oyuncu.ulke}, ${data.isim} eyaletine ICBM fırlattı! Düşman ordusu kül oldu!` 
        });
        io.emit('stateGuncelle', gameState);
    });

    socket.on('disconnect', () => {
        delete gameState.oyuncular[socket.id];
    });
});

// Gün Sayacı ve Dinamik Maaş Sistemi
setInterval(() => {
    gameState.gun++;
    Object.keys(gameState.oyuncular).forEach(socketId => {
        const oyuncu = gameState.oyuncular[socketId];
        let toplamSivilFabrika = 0;
        Object.keys(gameState.eyaletler).forEach(eyaletId => {
            if (gameState.eyaletler[eyaletId].sahibi === oyuncu.ulke) {
                toplamSivilFabrika += (gameState.eyaletler[eyaletId].sivil || 0);
            }
        });
        oyuncu.para += 50 + (toplamSivilFabrika * 2);
    });
    io.emit('stateGuncelle', gameState);
}, 1500); 

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda başarıyla çalışıyor...`);
});