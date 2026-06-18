const fs = require('fs');
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, { cors: { origin: "*" } });

const SAVE_FILE = 'oyun_kaydi.json';

function oyunVerisiniYukle() {
    if (fs.existsSync(SAVE_FILE)) {
        return JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    }
    return { gun: 1, eyaletler: {}, oyuncular: {} };
}

let gameState = oyunVerisiniYukle();

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

// DEVASA TEKNOLOJİ AĞACI KONFİGÜRASYONU
const techAgaci = {
    // Piyade Dalı
    piyade: { maliyet: 200, gereksinim: null },
    tank: { maliyet: 450, gereksinim: 'piyade' },
    // Hava Kuvvetleri Dalı
    hava_kuvvetleri: { maliyet: 550, gereksinim: 'piyade' },
    hayalet_ucak: { maliyet: 900, gereksinim: 'hava_kuvvetleri' },
    // Taktik & Savunma Dalı
    taktik: { maliyet: 400, gereksinim: null },
    tahkimat: { maliyet: 350, gereksinim: 'taktik' },
    // Nükleer Dal
    fuze: { maliyet: 600, gereksinim: 'taktik' },
    icbm: { maliyet: 1200, gereksinim: 'fuze' },
    uzay_savunma: { maliyet: 1800, gereksinim: 'icbm' }, // Anti-Nuke
    // Deniz Dalı
    gemi_gucu: { maliyet: 300, gereksinim: null },
    denizalti: { maliyet: 600, gereksinim: 'gemi_gucu' },
    // Ekonomi Dalı
    endustri: { maliyet: 500, gereksinim: null },
    maliyet_dusurme: { maliyet: 600, gereksinim: 'endustri' },
    mega_fabrikalar: { maliyet: 1000, gereksinim: 'maliyet_dusurme' },
    // İstihbarat Dalı
    istihbarat: { maliyet: 450, gereksinim: null }
};

function eyaletOlusturSifirdan(eyaletId, varsayilanSahibi) {
    const rastgeleOrdu = Math.floor(Math.random() * 6) + 1;
    return {
        sahibi: varsayilanSahibi || "Nötr",
        ordu: rastgeleOrdu,
        sivil: 0,
        askeri: 0
    };
}

io.on('connection', (socket) => {
    socket.emit('init', gameState);

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
            teknolojiler: { 
                piyade: false, tank: false, hava_kuvvetleri: false, hayalet_ucak: false,
                taktik: false, tahkimat: false, fuze: false, icbm: false, uzay_savunma: false,
                gemi_gucu: false, denizalti: false,
                endustri: false, maliyet_dusurme: false, mega_fabrikalar: false,
                istihbarat: false
            }
        };

        socket.emit('ulkeSecildi', ulkeAdi);
        io.emit('stateGuncelle', gameState);
    });

    socket.on('islemYap', (data) => {
        const oyuncu = gameState.oyuncular[socket.id];
        if (!oyuncu) return;
        const { eyaletId, tur } = data;
        
        if (!gameState.eyaletler[eyaletId]) {
            gameState.eyaletler[eyaletId] = eyaletOlusturSifirdan(eyaletId, oyuncu.ulke);
        }

        const eyalet = gameState.eyaletler[eyaletId];

        if (eyalet.sahibi !== oyuncu.ulke) {
            socket.emit('hataMesaji', 'Bu eyalet senin değil!');
            return;
        }

        if (tur === 'ordu') {
            const askerMaliyeti = oyuncu.teknolojiler?.maliyet_dusurme ? 65 : 100;
            if (oyuncu.para >= askerMaliyeti) { 
                oyuncu.para -= askerMaliyeti; 
                eyalet.ordu = (eyalet.ordu || 0) + 1; 
            } else { 
                socket.emit('hataMesaji', `Yetersiz altın! Gerekli: ${askerMaliyeti} 💰`); 
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

    socket.on('saldiri', (data) => {
        const oyuncu = gameState.oyuncular[socket.id];
        if (!oyuncu) return;

        const savunanId = data.id;

        if (!gameState.eyaletler[savunanId]) {
            gameState.eyaletler[savunanId] = eyaletOlusturSifirdan(savunanId, data.eskiSahibi);
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

        // GENİŞLETİLMİŞ SALDIRI ÇARPANLARI
        let saldiranBonus = 1.0;
        if (oyuncu.teknolojiler?.piyade) saldiranBonus += 0.3;
        if (oyuncu.teknolojiler?.tank) saldiranBonus += 0.6;
        if (oyuncu.teknolojiler?.hava_kuvvetleri) saldiranBonus += 0.4;
        if (oyuncu.teknolojiler?.hayalet_ucak) saldiranBonus += 0.5;
        if (oyuncu.teknolojiler?.gemi_gucu) saldiranBonus += 0.25;
        if (oyuncu.teknolojiler?.denizalti) saldiranBonus += 0.3;
        if (oyuncu.teknolojiler?.istihbarat) saldiranBonus += 0.15;

        // GENİŞLETİLMİŞ SAVUNMA ÇARPANLARI
        let savunanBonus = 1.0;
        const savunanSahibi = savunanEyalet.sahibi;
        const savunanOyuncuSocket = Object.keys(gameState.oyuncular).find(sId => gameState.oyuncular[sId].ulke === savunanSahibi);
        
        if (savunanOyuncuSocket) {
            const sOyuncu = gameState.oyuncular[savunanOyuncuSocket];
            if (sOyuncu.teknolojiler?.taktik) savunanBonus += 0.4;
            if (sOyuncu.teknolojiler?.tahkimat) savunanBonus += 0.2;
            if (sOyuncu.teknolojiler?.istihbarat) savunanBonus += 0.15;
            // Hava Kuvvetleri savunmada da biraz işe yarar
            if (sOyuncu.teknolojiler?.hava_kuvvetleri) savunanBonus += 0.2;
        }

        let saldiranGucu = saldiranEyalet.ordu * (Math.random() * 0.4 + 0.8) * saldiranBonus;
        let savunanGucu = savunanEyalet.ordu * (Math.random() * 0.4 + 0.9) * savunanBonus;

        if (saldiranGucu > savunanGucu) {
            savunanEyalet.sahibi = oyuncu.ulke;
            savunanEyalet.ordu = Math.max(1, Math.floor(saldiranEyalet.ordu * 0.4));
            saldiranEyalet.ordu = Math.max(1, Math.floor(saldiranEyalet.ordu * 0.3));
            socket.emit('savasSonucu', { kazanan: true, mesaj: `Zafer! ${data.isim} ele geçirildi!` });
        } else {
            saldiranEyalet.ordu = Math.max(1, Math.floor(saldiranEyalet.ordu * 0.2));
            savunanEyalet.ordu = Math.max(1, Math.floor(savunanEyalet.ordu * 0.6));
            socket.emit('savasSonucu', { kazanan: false, mesaj: `Yenilgi! ${data.isim} saldırısı başarısız oldu.` });
        }
        io.emit('stateGuncelle', gameState);
    });

    socket.on('teknolojiArastir', (techId) => {
        const oyuncu = gameState.oyuncular[socket.id];
        if (!oyuncu) return;
        
        if (!oyuncu.teknolojiler) {
            oyuncu.teknolojiler = {};
        }

        if (oyuncu.teknolojiler[techId]) {
            socket.emit('hataMesaji', 'Bu teknoloji zaten araştırıldı!');
            return;
        }

        const techConfig = techAgaci[techId];
        if (!techConfig) return;

        if (techConfig.gereksinim && !oyuncu.teknolojiler[techConfig.gereksinim]) {
            socket.emit('hataMesaji', `Kilitli! Önce ${techConfig.gereksinim.toUpperCase()} teknolojisini açmalısın.`);
            return;
        }

        if (oyuncu.para >= techConfig.maliyet) {
            oyuncu.para -= techConfig.maliyet;
            oyuncu.teknolojiler[techId] = true;
            socket.emit('savasSonucu', { kazanan: true, mesaj: `🔬 BAŞARILI: ${techId.toUpperCase()} Aktif Edildi!` });
            io.emit('stateGuncelle', gameState);
        } else {
            socket.emit('hataMesaji', `Yetersiz altın! ${techConfig.maliyet} 💰 gerekiyor.`);
        }
    });

    // BUG FIX: ICBM Sistemi Düzeltildi
    socket.on('icbmFirlat', (data) => {
        const oyuncu = gameState.oyuncular[socket.id];
        if (!oyuncu || !oyuncu.teknolojiler?.icbm) {
            socket.emit('hataMesaji', 'Ağaçta ICBM teknolojisini tamamlamadın!');
            return;
        }
        if (oyuncu.para < 500) {
            socket.emit('hataMesaji', 'Füze ateşleme maliyeti olan 500 altına ihtiyacın var!');
            return;
        }

        const hedefId = data.id;
        if (!gameState.eyaletler[hedefId]) {
            gameState.eyaletler[hedefId] = eyaletOlusturSifirdan(hedefId, data.eskiSahibi);
        }
        const hedefEyalet = gameState.eyaletler[hedefId];
        if (hedefEyalet.sahibi === oyuncu.ulke) return;

        // Anti-Nuke (Uzay Savunma) Kontrolü
        const savunanOyuncuSocket = Object.keys(gameState.oyuncular).find(sId => gameState.oyuncular[sId].ulke === hedefEyalet.sahibi);
        if (savunanOyuncuSocket) {
            const savunanOyuncu = gameState.oyuncular[savunanOyuncuSocket];
            if (savunanOyuncu.teknolojiler?.uzay_savunma) {
                oyuncu.para -= 500;
                // Savunan tarafta Uzay Savunma varsa füze havada patlar, zarar vermez
                io.emit('savasSonucu', { kazanan: false, mesaj: `🚀❌ NÜKLEER SAVUNMA! ${hedefEyalet.sahibi} 'Uzay Savunma Ağı' ile füzenizi havada imha etti!` });
                io.emit('stateGuncelle', gameState);
                return;
            }
        }

        oyuncu.para -= 500;
        // Sadece hedef eyaletin ordusu yok edilir. Sahiplik DEĞİŞMEZ, diğer şehirler ETKİLENMEZ.
        hedefEyalet.ordu = Math.max(1, Math.floor(hedefEyalet.ordu * 0.1));

        // Eski bug'a sebep olan "ulkeIlhakEdildi" eventi yerine, güvenli bir bildirim eventi kullanıyoruz.
        io.emit('nukleerBildirim', { 
            mesaj: `☢️ KATASTROF! ${oyuncu.ulke}, ${data.isim} eyaletine ICBM fırlattı! Bölgedeki askeri güçler buharlaştı!` 
        });
        
        io.emit('stateGuncelle', gameState);
    });

    socket.on('disconnect', () => {
        delete gameState.oyuncular[socket.id];
    });
});

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
        
        // Mega Fabrika 10 Altın, Endüstri 5 Altın, Yoksa 2 Altın
        let fabrikaGeliri = oyuncu.teknolojiler?.mega_fabrikalar ? 10 : (oyuncu.teknolojiler?.endustri ? 5 : 2);
        oyuncu.para += 30 + (toplamSivilFabrika * fabrikaGeliri);
    });
    io.emit('stateGuncelle', gameState);
}, 5000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda başarıyla çalışıyor...`);
});
