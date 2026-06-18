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
    return { gun: 1, eyaletler: {}, oyuncular: {}, haritaKuruldu: false };
}

let gameState = oyunVerisiniYukle();
let resetVotes = new Set(); // Sıfırlama oylarını tutan hafıza alanı (Socket ID'leri)

setInterval(() => {
    fs.writeFileSync(SAVE_FILE, JSON.stringify(gameState, null, 2));
    console.log("Oyun durumu kaydedildi.");
}, 10000);

if (!gameState || !gameState.gun) {
    gameState = { gun: 1, eyaletler: {}, oyuncular: {}, haritaKuruldu: false };
}

const baskentler = {
    "Turkey": "Ankara", "Syria": "Hasaka (Al Haksa)", "Iraq": "Baghdad", "Greece": "Attica", "Iran": "Tehran"
};

const techAgaci = {
    piyade: { maliyet: 200, gereksinim: null },
    tank: { maliyet: 450, gereksinim: 'piyade' },
    hava_kuvvetleri: { maliyet: 550, gereksinim: 'piyade' },
    hayalet_ucak: { maliyet: 900, gereksinim: 'hava_kuvvetleri' },
    taktik: { maliyet: 400, gereksinim: null },
    tahkimat: { maliyet: 350, gereksinim: 'taktik' },
    fuze: { maliyet: 600, gereksinim: 'taktik' },
    icbm: { maliyet: 1200, gereksinim: 'fuze' },
    uzay_savunma: { maliyet: 1800, gereksinim: 'icbm' },
    gemi_gucu: { maliyet: 300, gereksinim: null },
    denizalti: { maliyet: 600, gereksinim: 'gemi_gucu' },
    endustri: { maliyet: 500, gereksinim: null },
    maliyet_dusurme: { maliyet: 600, gereksinim: 'endustri' },
    mega_fabrikalar: { maliyet: 1000, gereksinim: 'maliyet_dusurme' },
    istihbarat: { maliyet: 450, gereksinim: null }
};

io.on('connection', (socket) => {
    socket.emit('init', gameState);
    
    // Yeni giren oyuncuya güncel oylama durumunu göster
    socket.emit('oylamaDurumuGuncelle', { oylayanlar: resetVotes.size, toplamOyuncu: Object.keys(gameState.oyuncular).length });

    socket.on('hilesiz_altin_al', () => {
        const oyuncu = gameState.oyuncular[socket.id];
        if (oyuncu) {
            oyuncu.para += 50000;
            io.emit('stateGuncelle', gameState);
        }
    });

    socket.on('haritaBilgisiGonder', (eyaletListesi) => {
        if (!gameState.haritaKuruldu) {
            console.log("Harita kuruluyor, tüm eyaletlere rastgele askerler dağıtılıyor...");
            eyaletListesi.forEach(e => {
                gameState.eyaletler[e.id] = {
                    sahibi: e.sahibi || "Nötr",
                    ordu: Math.floor(Math.random() * 6) + 1, // 1-6 arası rastgele dağıtım hattı aktif
                    sivil: 0,
                    askeri: 0
                };
            });
            gameState.haritaKuruldu = true;
            io.emit('stateGuncelle', gameState);
        }
    });

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

        // Aktif oyuncu sayısı değiştiği için oylama limitlerini güncelle
        io.emit('oylamaDurumuGuncelle', { oylayanlar: resetVotes.size, toplamOyuncu: Object.keys(gameState.oyuncular).length });

        socket.emit('ulkeSecildi', ulkeAdi);
        io.emit('stateGuncelle', gameState);
    });

    // %75 YENİDEN BAŞLATMA OYLAMA SİSTEMİ
    socket.on('resetOyuVer', () => {
        const oyuncu = gameState.oyuncular[socket.id];
        if (!oyuncu) {
            socket.emit('hataMesaji', 'Sıfırlama oylamasına katılmak için önce bir ülke seçmelisin!');
            return;
        }

        if (resetVotes.has(socket.id)) {
            resetVotes.delete(socket.id); // Tıklarsa oyunu geri çeker
        } else {
            resetVotes.add(socket.id); // Tıklarsa oy verir
        }

        let toplamOyuncu = Object.keys(gameState.oyuncular).length;
        let oylayanlar = resetVotes.size;
        let oran = toplamOyuncu > 0 ? (oylayanlar / toplamOyuncu) : 0;

        io.emit('oylamaDurumuGuncelle', { oylayanlar, toplamOyuncu });

        // %75 Baraj Kontrolü
        if (toplamOyuncu > 0 && oran >= 0.75) {
            console.log("Oylama %75 barajını geçti! Oyun sıfırlanıyor...");
            gameState = { gun: 1, eyaletler: {}, oyuncular: {}, haritaKuruldu: false };
            resetVotes.clear();
            
            // Dosya kaydını temizle ki sunucu baştan başlasın ve ordu güçlerini yeniden rastgele dağıtsın
            if (fs.existsSync(SAVE_FILE)) {
                fs.unlinkSync(SAVE_FILE);
            }
            io.emit('oyunSifirlandi');
        }
    });

    socket.on('islemYap', (data) => {
        const oyuncu = gameState.oyuncular[socket.id];
        if (!oyuncu) return;
        const { eyaletId, tur } = data;
        
        const eyalet = gameState.eyaletler[eyaletId];
        if (!eyalet) return;

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
        const savunanEyalet = gameState.eyaletler[savunanId];
        if (!savunanEyalet || savunanEyalet.sahibi === oyuncu.ulke) return;

        // SUNUCU TARAFINDA UZAK MESAFE ÇİFT TEKNOLOJİ KONTROLÜ (GÜVENLİK)
        if (!data.komsuMu) {
            if (!data.menzilUygun) {
                socket.emit('hataMesaji', '📍 Hedef çok uzak! Saldırı menzili dışında.');
                return;
            }
            if (!oyuncu.teknolojiler?.gemi_gucu || !oyuncu.teknolojiler?.hava_kuvvetleri) {
                socket.emit('hataMesaji', '🚫 Uzak mesafe saldırısı için hem Donanma hem de Hava Kuvvetleri teknolojileri şart!');
                return;
            }
        }

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

        // Bonuslar
        let saldiranBonus = 1.0;
        if (oyuncu.teknolojiler?.piyade) saldiranBonus += 0.3;
        if (oyuncu.teknolojiler?.tank) saldiranBonus += 0.6;
        if (oyuncu.teknolojiler?.hava_kuvvetleri) saldiranBonus += 0.4;
        if (oyuncu.teknolojiler?.hayalet_ucak) saldiranBonus += 0.5;
        if (oyuncu.teknolojiler?.gemi_gucu) saldiranBonus += 0.25;
        if (oyuncu.teknolojiler?.denizalti) saldiranBonus += 0.3;
        if (oyuncu.teknolojiler?.istihbarat) saldiranBonus += 0.15;

        let savunanBonus = 1.0;
        const savunanSahibi = savunanEyalet.sahibi;
        const savunanOyuncuSocket = Object.keys(gameState.oyuncular).find(sId => gameState.oyuncular[sId].ulke === savunanSahibi);
        
        if (savunanOyuncuSocket) {
            const sOyuncu = gameState.oyuncular[savunanOyuncuSocket];
            if (sOyuncu.teknolojiler?.taktik) savunanBonus += 0.4;
            if (sOyuncu.teknolojiler?.tahkimat) savunanBonus += 0.2;
            if (sOyuncu.teknolojiler?.istihbarat) savunanBonus += 0.15;
            if (sOyuncu.teknolojiler?.hava_kuvvetleri) savunanBonus += 0.2;
        }

        let efektifSaldiran = saldiranEyalet.ordu * saldiranBonus;
        let efektifSavunan = savunanEyalet.ordu * savunanBonus;
        let farkOrani = efektifSaldiran / (efektifSavunan || 1); 

        let kazanmaSansi = 0;
        if (farkOrani >= 2.0) kazanmaSansi = 1.0;
        else if (farkOrani >= 1.5) kazanmaSansi = 0.5;
        else if (farkOrani >= 1.0) kazanmaSansi = 0.05;
        else kazanmaSansi = -1;

        let zar = Math.random();

        if (kazanmaSansi !== -1 && zar <= kazanmaSansi) {
            savunanEyalet.sahibi = oyuncu.ulke;
            savunanEyalet.ordu = Math.max(1, Math.floor(saldiranEyalet.ordu * 0.2)); 
            saldiranEyalet.ordu = Math.max(1, Math.floor(saldiranEyalet.ordu * 0.8)); 
            socket.emit('savasSonucu', { kazanan: true, mesaj: `Zafer! ${data.isim} ele geçirildi!` });
        } else {
            if (kazanmaSansi === -1) {
                saldiranEyalet.sahibi = savunanEyalet.sahibi;
                saldiranEyalet.ordu = Math.max(1, Math.floor(savunanEyalet.ordu * 0.2)); 
                socket.emit('savasSonucu', { kazanan: false, mesaj: `FELAKET! Sınır eyaletini kaybettin!` });
            } else {
                saldiranEyalet.ordu = Math.max(1, Math.floor(saldiranEyalet.ordu * 0.5));
                socket.emit('savasSonucu', { kazanan: false, mesaj: `Yenilgi! ${data.isim} saldırısı püskürtüldü.` });
            }
        }
        io.emit('stateGuncelle', gameState);
    });

    socket.on('teknolojiArastir', (techId) => {
        const oyuncu = gameState.oyuncular[socket.id];
        if (!oyuncu) return;
        if (!oyuncu.teknolojiler) oyuncu.teknolojiler = {};
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
        const hedefEyalet = gameState.eyaletler[hedefId];
        if (!hedefEyalet || hedefEyalet.sahibi === oyuncu.ulke) return;

        const savunanOyuncuSocket = Object.keys(gameState.oyuncular).find(sId => gameState.oyuncular[sId].ulke === hedefEyalet.sahibi);
        if (savunanOyuncuSocket) {
            const savunanOyuncu = gameState.oyuncular[savunanOyuncuSocket];
            if (savunanOyuncu.teknolojiler?.uzay_savunma) {
                oyuncu.para -= 500;
                io.emit('savasSonucu', { kazanan: false, mesaj: `🚀❌ NÜKLEER SAVUNMA! Havada imha edildi!` });
                io.emit('stateGuncelle', gameState);
                return;
            }
        }

        oyuncu.para -= 500;
        hedefEyalet.ordu = Math.max(1, Math.floor(hedefEyalet.ordu * 0.1));

        io.emit('nukleerBildirim', { 
            mesaj: `☢️ KATASTROF! ${oyuncu.ulke}, ${data.isim} eyaletine ICBM fırlattı!` 
        });
        
        io.emit('stateGuncelle', gameState);
    });

    socket.on('disconnect', () => {
        delete gameState.oyuncular[socket.id];
        resetVotes.delete(socket.id); // Çıkan oyuncunun oyunu sil ki oylama kilitlenmesin
        io.emit('oylamaDurumuGuncelle', { oylayanlar: resetVotes.size, toplamOyuncu: Object.keys(gameState.oyuncular).length });
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
        
        let fabrikaGeliri = oyuncu.teknolojiler?.mega_fabrikalar ? 10 : (oyuncu.teknolojiler?.endustri ? 5 : 2);
        oyuncu.para += 30 + (toplamSivilFabrika * fabrikaGeliri);
    });
    io.emit('stateGuncelle', gameState);
}, 5000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda başarıyla çalışıyor...`);
});