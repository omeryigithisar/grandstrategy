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

const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, { cors: { origin: "*" } });

if (!gameState || !gameState.gun) {
    gameState = {
        gun: 1,
        eyaletler: {},
        oyuncular: {}
    };
}

const baskentler = {
    "Turkey": "Ankara",
    "Syria": "Hasaka (Al Haksa)",
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
            socket.emit('hataMesaji', 'Bu ülke zaten seçilmiş!');
            return;
        }

        gameState.oyuncular[socket.id] = {
            ulke: ulkeAdi,
            para: 500,
            baskent: baskentler[ulkeAdi] || "Bilinmiyor"
        };

        // İstemci 'ulkeSecildi' bekliyor
        socket.emit('ulkeSecildi', ulkeAdi);
        io.emit('stateGuncelle', gameState); // guncelleme -> stateGuncelle yapıldı
    });

    // 2. EYALET İŞLEMLERİ (ASKER ÜRETİMİ / FABRİKA KURUMU)
    socket.on('islemYap', (data) => { // eyaletIslem -> islemYap yapıldı
        const oyuncu = gameState.oyuncular[socket.id];
        if (!oyuncu) return;

        const { eyaletId, tur } = data; // tip -> tur yapıldı
        
        if (!gameState.eyaletler[eyaletId]) {
            gameState.eyaletler[eyaletId] = { sahibi: oyuncu.ulke, ordu: 1, sivil: 0, askeri: 0 };
        }

        const eyalet = gameState.eyaletler[eyaletId];

        if (eyalet.sahibi !== oyuncu.ulke) {
            socket.emit('hataMesaji', 'Bu eyalet senin değil!');
            return;
        }

        if (tur === 'ordu') {
            if (oyuncu.para >= 100) {
                oyuncu.para -= 100;
                eyalet.ordu = (eyalet.ordu || 0) + 1;
            } else {
                socket.emit('hataMesaji', 'Yetersiz altın!');
            }
        } else if (tur === 'sivil') {
            if (oyuncu.para >= 300) {
                oyuncu.para -= 300;
                eyalet.sivil = (eyalet.sivil || 0) + 1;
            } else {
                socket.emit('hataMesaji', 'Yetersiz altın!');
            }
        }

        io.emit('stateGuncelle', gameState);
    });

    // 3. SAVAŞ VE SALDIRI SİSTEMİ (ÖMER İÇİN ÖZEL DÜZELTİLDİ)
    socket.on('saldiri', (data) => { // savasAc -> saldiri yapıldı
        const oyuncu = gameState.oyuncular[socket.id];
        if (!oyuncu) return;

        const savunanId = data.id;
        const savunanEyalet = gameState.eyaletler[savunanId];

        // Savunan eyalet geçerli değilse veya zaten bizimse iptal et
        if (!savunanEyalet || savunanEyalet.sahibi === oyuncu.ulke) return;

        // Kendi eyaletlerinden en çok ordusu olanı otomatik "saldıran" olarak seç
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
            socket.emit('hataMesaji', 'Saldıracak sınır ordun bulunamadı!');
            return;
        }

        const saldiranEyalet = gameState.eyaletler[saldiranId];

        // Basit Zar/Güç Mekaniği
        let saldiranGucu = (saldiranEyalet.ordu || 1) * (Math.random() * 0.4 + 0.8);
        let savunanGucu = (savunanEyalet.ordu || 1) * (Math.random() * 0.4 + 0.9); 

        if (saldiranGucu > savunanGucu) {
            // Saldıran kazandı
            const eskiSahibi = savunanEyalet.sahibi;
            savunanEyalet.sahibi = oyuncu.ulke;
            savunanEyalet.ordu = Math.max(1, Math.floor(saldiranEyalet.ordu * 0.4));
            saldiranEyalet.ordu = Math.max(1, Math.floor(saldiranEyalet.ordu * 0.3));

            socket.emit('savasSonucu', { kazanan: true, mesaj: 'Zafer! Eyalet ele geçirildi!' });
            
            // İlhak (Annexation) Sistemi
            let kalanEyaletSayisi = Object.values(gameState.eyaletler).filter(e => e.sahibi === eskiSahibi).length;
            if (kalanEyaletSayisi === 0 && eskiSahibi && eskiSahibi !== "Nötr") {
                io.emit('ulkeIlhakEdildi', { kazanan: oyuncu.ulke, kaybeden: eskiSahibi, mesaj: `${eskiSahibi} devleti tamamen ilhak edildi!` });
            }
        } else {
            // Savunan kazandı
            saldiranEyalet.ordu = Math.max(1, Math.floor(saldiranEyalet.ordu * 0.2));
            savunanEyalet.ordu = Math.max(1, Math.floor(savunanEyalet.ordu * 0.5));
            socket.emit('savasSonucu', { kazanan: false, mesaj: 'Saldırı başarısız oldu, ordumuz eridi!' });
        }

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
            let eyalet = gameState.eyaletler[eyaletId];
            if (eyalet.sahibi === oyuncu.ulke) {
                toplamSivilFabrika += (eyalet.sivil || 0);
            }
        });

        let fabrikaGeliri = toplamSivilFabrika * 2;
        let toplamKazanc = 50 + fabrikaGeliri;

        oyuncu.para += toplamKazanc;
    });

    io.emit('stateGuncelle', gameState);
}, 20000); 

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda başarıyla çalışıyor...`);
});