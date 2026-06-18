// engine.js - Tam ve Temiz Sürüm
// Localhost yerine artık internetteki sunucuna bağlanacak
const socket = io("https://senin-oyunun-backend.onrender.com"); 

// Akıcı ve Kilitlenmeyen Bildirim Sistemi
window.gosterBildirim = function(mesaj, tur) {
    const container = document.getElementById('notification-container');
    const bildirim = document.createElement('div');
    bildirim.className = 'toast';
    
    // Zaferse yeşil, kayıpsa kırmızı tema
    bildirim.style.backgroundColor = (tur === 'zafer') ? "#27ae60" : "#c0392b";
    bildirim.innerText = mesaj;

    container.appendChild(bildirim);

    // 1.5 Saniye sonra yumuşakça kaybolsun
    setTimeout(() => {
        bildirim.style.opacity = "0";
        setTimeout(() => bildirim.remove(), 500);
    }, 1500);
};

const app = new PIXI.Application({
    view: document.getElementById('gameCanvas'),
    resizeTo: window,
    backgroundColor: 0x051014, 
    antialias: true
});

const mapContainer = new PIXI.Container();
app.stage.addChild(mapContainer);

let eyaletlerMap = new Map();
let seciliEyaletId = null;
let sunucuEyaletVerileri = {};
window.benimUlkem = null; 

const ulkeRenkleri = {
    "Turkey": 0xcc2929, "Republic of Türkiye": 0xcc2929,
    "Greece": 0x297acc, "Bulgaria": 0x29cc7a, "Syria": 0xd35400,
    "Iraq": 0x27ae60, "Iran": 0x16a085, "Russia": 0x8e44ad,
    "Germany": 0x34495e, "France": 0xf1c40f, "United Kingdom": 0x2c3e50,
    "Italy": 0x27ae60, "United States of America": 0x2980b9, "China": 0xc0392b,
    "Default": 0x1a252f 
};

function rastgeleSabitRenk(str) {
    if (ulkeRenkleri[str]) return ulkeRenkleri[str];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return parseInt("0x" + "00000".substring(0, 6 - c.length) + c);
}

const minX = -180, maxX = 180, minY = -90, maxY = 90;
function koordinatDonustur(lon, lat) {
    const x = (lon - minX) * (app.screen.width / (maxX - minX));
    const y = (maxY - lat) * (app.screen.height / (maxY - minY));
    return [x, y];
}

// Sınırları hesaplayarak çizen poligon fonksiyonu
// 1. POLİGON ÇİZİM FONKSİYONU (BEYAZ BAZLI)
function poligonCizVeSinirBul(graphics, coords, sinirlar) { 
    if (!coords || coords.length === 0) return;
    
    // SİHİRLİ DOKUNUŞ: PIXI.js'de tint (renk değiştirme) yapabilmek için baz renk BEYAZ olmalı!
    graphics.beginFill(0xFFFFFF); 
    graphics.lineStyle(0.3, 0x000000, 0.5); 
    
    let first = true;
    for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        if (!c || c.length < 2) continue;
        const [x, y] = koordinatDonustur(c[0], c[1]);
        
        if (x < sinirlar.minX) sinirlar.minX = x;
        if (x > sinirlar.maxX) sinirlar.maxX = x;
        if (y < sinirlar.minY) sinirlar.minY = y;
        if (y > sinirlar.maxY) sinirlar.maxY = y;

        if (first) { graphics.moveTo(x, y); first = false; }
        else { graphics.lineTo(x, y); }
    }
    graphics.endFill();
}

// 2. HARİTA YÜKLEME VE İLK RENK ATAMASI
async function haritayiYukleVeKur() {
    try {
        const response = await fetch('admin1.json');
        const geoData = await response.json();
        const totalFeatures = geoData.features.length;
        let index = 0;

        function yukle() {
            const batchSize = 100; 
            for (let j = 0; j < batchSize && index < totalFeatures; j++, index++) {
                const feature = geoData.features[index];
                if (!feature.geometry) continue;

                let id = feature.properties.id || feature.properties.cartodb_id || `e-${index}`;
                let isim = feature.properties.name || feature.properties.name_en || `Bölge ${index}`;
                let ulkeSahibi = feature.properties.admin || feature.properties.sovereignt || "Nötr";
                let eyaletRengi = rastgeleSabitRenk(ulkeSahibi);

                let sinirlar = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
                const g = new PIXI.Graphics();
                
                // ŞEKLİN İLK RENGİNİ BURADA FİLTRE (TINT) OLARAK VERİYORUZ!
                g.tint = eyaletRengi;

                if (feature.geometry.type === "Polygon") {
                    // renk parametresini çıkardık
                    feature.geometry.coordinates.forEach(coords => poligonCizVeSinirBul(g, coords, sinirlar));
                } else if (feature.geometry.type === "MultiPolygon") {
                    feature.geometry.coordinates.forEach(poly => poly.forEach(coords => poligonCizVeSinirBul(g, coords, sinirlar)));
                }

                g.eventMode = 'static';
                g.cursor = 'pointer';
                g.on('pointerdown', (e) => { e.stopPropagation(); eyaletSec(id, g); });

                eyaletlerMap.set(id, { 
                    isim: isim, 
                    sahibi: ulkeSahibi, 
                    varsayilanRenk: eyaletRengi, 
                    graphicsRef: g,
                    sinirlar: sinirlar
                });
                
                mapContainer.addChild(g);
            }

            if (index < totalFeatures) {
                requestAnimationFrame(yukle);
            } else {
                kameraSisteminiKur();
                mapContainer.scale.set(1);
                mapContainer.position.set(0, 0);
            }
        }
        yukle();
    } catch (e) { console.error(e); }
}

// KOMŞULUK ALGORİTMASI
window.sinirKomsusuMu = function(hedefId) {
    const hedefEyalet = eyaletlerMap.get(hedefId);
    if (!hedefEyalet || !hedefEyalet.sinirlar) return true; // Hata olmasın diye varsayılan true

    const h = hedefEyalet.sinirlar;
    const padding = 20; // Kaç piksel yakınındaysa komşu sayılsın toleransı

    for (let [id, eyalet] of eyaletlerMap) {
        // Sadece kendi ülkemizin sınır kutularını (Bounding Box) kontrol et
        if (eyalet.sahibi === window.benimUlkem && eyalet.sinirlar) {
            const e = eyalet.sinirlar;
            
            // İki kutu kesişiyor veya birbirine 'padding' kadar yakın mı?
            const kesisiyorMu = !(
                h.maxX < e.minX - padding || 
                h.minX > e.maxX + padding || 
                h.maxY < e.minY - padding || 
                h.minY > e.maxY + padding
            );
            
            if (kesisiyorMu) return true; // Sınırda!
        }
    }
    return false; // Hiçbir toprağına temas etmiyor
};  
// 3. EYALET SEÇİMİ VE RENK SIFIRLAMA
function eyaletSec(id, graphicsObj) {
    // Önceki seçili eyaleti KENDİ GERÇEK NET RENGİNE döndür
    if (seciliEyaletId && eyaletlerMap.has(seciliEyaletId)) {
        let eskiEyalet = eyaletlerMap.get(seciliEyaletId);
        if (eskiEyalet.graphicsRef) {
            // Eğer bizim ülkemizse bizim rengimiz, değilse orijinal rengi
            if (window.benimUlkem && eskiEyalet.sahibi === window.benimUlkem) {
                eskiEyalet.graphicsRef.tint = ulkeRenkleri[window.benimUlkem] || 0xcc2929;
            } else {
                eskiEyalet.graphicsRef.tint = rastgeleSabitRenk(eskiEyalet.sahibi);
            }
        }
    }

    seciliEyaletId = id;
    graphicsObj.tint = 0xf1c40f; // Seçileni tam parlak Sarı yap

    const sabitVeri = eyaletlerMap.get(id);
    if (sunucuEyaletVerileri[id]) {
        sabitVeri.sahibi = sunucuEyaletVerileri[id].sahibi;
    }
    const sunucuVerisi = sunucuEyaletVerileri[id] || { sivil: 0, askeri: 0, ordu: 1 };

    document.getElementById('panel-name').innerText = sabitVeri.isim;
    document.getElementById('panel-owner').innerText = sabitVeri.sahibi;

    if (!window.benimUlkem) {
        document.getElementById('select-country-action').style.display = "block";
        document.getElementById('my-actions').style.display = "none";
        document.getElementById('enemy-actions').style.display = "none";
    } else if (sabitVeri.sahibi === window.benimUlkem) {
        document.getElementById('select-country-action').style.display = "none";
        document.getElementById('my-actions').style.display = "block";
        document.getElementById('enemy-actions').style.display = "none";
        
        document.getElementById('panel-sivil').innerText = sunucuVerisi.sivil;
        document.getElementById('panel-askeri').innerText = sunucuVerisi.askeri;
        document.getElementById('panel-ordu').innerText = sunucuVerisi.ordu;
    } else {
        document.getElementById('select-country-action').style.display = "none";
        document.getElementById('my-actions').style.display = "none";
        document.getElementById('enemy-actions').style.display = "block";
        
        const saldiriAlani = document.getElementById('enemy-actions');
        
        if (window.sinirKomsusuMu(id)) {
            saldiriAlani.innerHTML = `
                <div class="stat">🛡️ Düşman Ordusu: <span id="panel-ordu-enemy" style="color:#e74c3c; font-weight:bold;">${sunucuVerisi.ordu}</span></div>
                <hr>
                <button class="btn btn-saldiri" onclick="window.eyaleteSaldir()">⚔️ SAVAŞ AÇ / SALDIR!</button>
            `;
        } else {
            saldiriAlani.innerHTML = `
                <div class="stat">🛡️ Düşman Ordusu: <span id="panel-ordu-enemy" style="color:#e74c3c; font-weight:bold;">${sunucuVerisi.ordu}</span></div>
                <hr>
                <div class="stat" style="color:#7f8c8d; text-align:center; font-size:13px;">❌ Sınır Komşusu Değil.<br>Saldırı Yapılamaz.</div>
            `;
        }
    }
    document.getElementById('detail-panel').style.display = "block";
}

window.secilenUlkeyiYonet = function() {
    if (!seciliEyaletId) return;
    const sabitVeri = eyaletlerMap.get(seciliEyaletId);
    socket.emit('ulkeSec', sabitVeri.sahibi);
};

window.eyaletIslem = function(tur) {
    if (!seciliEyaletId) return;
    const sabitVeri = eyaletlerMap.get(seciliEyaletId);
    socket.emit('islemYap', { eyaletId: seciliEyaletId, tur: tur, sahibi: sabitVeri.sahibi });
};

// 2. window.eyaleteSaldir fonksiyonunu eski sahibini de gönderecek şekilde güncelle:
window.eyaleteSaldir = function() {
    if (!seciliEyaletId) return;
    const sabitVeri = eyaletlerMap.get(seciliEyaletId);
    // Eski sahibini de sunucuya yolluyoruz ki Başkent düşerse kimin yıkılacağını bilsin
    socket.emit('saldiri', { id: seciliEyaletId, isim: sabitVeri.isim, eskiSahibi: sabitVeri.sahibi });
};

function kameraSisteminiKur() {
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    let surukleniyor = false;
    let baslangicPozisyonu = { x: 0, y: 0 };

    app.view.addEventListener('wheel', (e) => {
        e.preventDefault();
        const mouseX = e.offsetX;
        const mouseY = e.offsetY;
        const localX = (mouseX - mapContainer.x) / mapContainer.scale.x;
        const localY = (mouseY - mapContainer.y) / mapContainer.scale.y;

        const zoomHizi = 0.05;
        let yeniScale = e.deltaY < 0 ? mapContainer.scale.x * (1 + zoomHizi) : mapContainer.scale.x * (1 - zoomHizi);

        if (yeniScale < 0.3) yeniScale = 0.3;
        if (yeniScale > 15) yeniScale = 15;

        mapContainer.scale.set(yeniScale);
        mapContainer.x = mouseX - localX * yeniScale;
        mapContainer.y = mouseY - localY * yeniScale;
    });

    app.stage.on('pointerdown', (e) => {
        surukleniyor = true;
        baslangicPozisyonu = { x: e.global.x - mapContainer.x, y: e.global.y - mapContainer.y };
    });
    app.stage.on('pointermove', (e) => {
        if (!surukleniyor) return;
        mapContainer.x = e.global.x - baslangicPozisyonu.x;
        mapContainer.y = e.global.y - baslangicPozisyonu.y;
    });
    app.stage.on('pointerup', () => surukleniyor = false);
    app.stage.on('pointerupoutside', () => surukleniyor = false);
}

socket.on('init', (serverState) => {
    document.getElementById('day-counter').innerText = serverState.gun;
});

socket.on('ulkeSecildi', (ulkeAdi) => {
    window.benimUlkem = ulkeAdi;
    document.getElementById('my-country').innerText = window.benimUlkem;
    if(seciliEyaletId) {
        eyaletSec(seciliEyaletId, eyaletlerMap.get(seciliEyaletId).graphicsRef);
    }
});

socket.on('hataMesaji', (mesaj) => {
    window.gosterBildirim(mesaj, 'kayip'); 
});

// 1. STATE GUNCELLE DİNLEYİCİSİ (Arayüz Kilitleme Hatası Düzeltildi)
socket.on('stateGuncelle', (serverState) => {
    document.getElementById('day-counter').innerText = serverState.gun;
    sunucuEyaletVerileri = serverState.eyaletler;

    const oyuncum = serverState.oyuncular[socket.id];
    if(oyuncum) document.getElementById('my-gold').innerText = oyuncum.para;

    // Harita Renklerini ve Sahiplerini Güncelle
    for (let [id, eyalet] of eyaletlerMap) {
        if (sunucuEyaletVerileri[id]) {
            let yeniSahibi = sunucuEyaletVerileri[id].sahibi;
            
            // Hafızadaki sahibi güncelle
            eyalet.sahibi = yeniSahibi;

            if (eyalet.graphicsRef) {
                // Eğer bu eyalet şu an SEÇİLİ OLAN eyalet DEĞİLSE normal rengine boya
                if (id !== seciliEyaletId) {
                    if (window.benimUlkem && yeniSahibi === window.benimUlkem) {
                        eyalet.graphicsRef.tint = ulkeRenkleri[window.benimUlkem] || 0xcc2929;
                    } else {
                        eyalet.graphicsRef.tint = rastgeleSabitRenk(yeniSahibi);
                    }
                }
            }
        }
    }

    // PANELİ GÜNCELLEME SADECE OYUNCU ÜLKE SEÇTİYSE TETİKLENSİN!
    // Bu sayede ülke seçmeye çalışırken panel kendi kendine "Saldır" moduna dönmeyecek.
    if (window.benimUlkem && seciliEyaletId && eyaletlerMap.has(seciliEyaletId)) {
        const sabitVeri = eyaletlerMap.get(seciliEyaletId);
        
        if (sunucuEyaletVerileri[seciliEyaletId]) {
            sabitVeri.sahibi = sunucuEyaletVerileri[seciliEyaletId].sahibi;
        }

        document.getElementById('panel-owner').innerText = sabitVeri.sahibi;

        if (sabitVeri.sahibi === window.benimUlkem) {
            document.getElementById('select-country-action').style.display = "none";
            document.getElementById('my-actions').style.display = "block";
            document.getElementById('enemy-actions').style.display = "none";
            
            const v = sunucuEyaletVerileri[seciliEyaletId];
            document.getElementById('panel-sivil').innerText = v.sivil || 0;
            document.getElementById('panel-askeri').innerText = v.askeri || 0;
            document.getElementById('panel-ordu').innerText = v.ordu || 1;
        } else {
            document.getElementById('select-country-action').style.display = "none";
            document.getElementById('my-actions').style.display = "none";
            document.getElementById('enemy-actions').style.display = "block";
            document.getElementById('panel-ordu-enemy').innerText = sunucuEyaletVerileri[seciliEyaletId].ordu || 1;
        }
    }
});

socket.on('savasSonucu', (data) => {
    const tur = data.kazanan ? 'zafer' : 'kayip';
    window.gosterBildirim(data.mesaj, tur);
});

haritayiYukleVeKur();

// İLHAK (ANNEXATION) DİNLEYİCİSİ
socket.on('ulkeIlhakEdildi', (data) => {
    window.gosterBildirim(data.mesaj, 'zafer');
    
    // Haritadaki o ülkeye ait HER ŞEYİ yeni sahibine geçir
    for (let [id, eyalet] of eyaletlerMap) {
        if (eyalet.sahibi === data.kaybeden) {
            eyalet.sahibi = data.kazanan;
            if (eyalet.graphicsRef) {
                // Biz kazandıysak ana rengimize, başka biriyse rastgele renge boyansın
                if (window.benimUlkem === data.kazanan) {
                    eyalet.graphicsRef.tint = ulkeRenkleri[window.benimUlkem] || 0xcc2929;
                } else {
                    eyalet.graphicsRef.tint = rastgeleSabitRenk(data.kazanan);
                }
            }
        }
    }
    // Seçili bir yer varsa paneli anlık yenile
    if (seciliEyaletId) eyaletSec(seciliEyaletId, eyaletlerMap.get(seciliEyaletId).graphicsRef);
});