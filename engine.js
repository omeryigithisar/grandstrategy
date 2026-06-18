const socket = io("https://grandstrategy-1.onrender.com"); 

window.gosterBildirim = function(mesaj, tur) {
    const container = document.getElementById('notification-container');
    const bildirim = document.createElement('div');
    bildirim.className = 'toast';
    bildirim.style.backgroundColor = (tur === 'zafer') ? "#27ae60" : (tur === 'nuke' ? "#8e44ad" : "#c0392b");
    bildirim.innerText = mesaj;
    container.appendChild(bildirim);
    setTimeout(() => {
        bildirim.style.opacity = "0";
        setTimeout(() => bildirim.remove(), 500);
    }, 2500);
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
window.teknolojilerim = {};

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

function poligonCizVeSinirBul(graphics, coords, sinirlar) { 
    if (!coords || coords.length === 0) return;
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
                g.tint = eyaletRengi;

                if (feature.geometry.type === "Polygon") {
                    feature.geometry.coordinates.forEach(coords => poligonCizVeSinirBul(g, coords, sinirlar));
                } else if (feature.geometry.type === "MultiPolygon") {
                    feature.geometry.coordinates.forEach(poly => poly.forEach(coords => poligonCizVeSinirBul(g, coords, sinirlar)));
                }

                g.eventMode = 'static';
                g.cursor = 'pointer';
                g.on('pointerdown', (e) => { e.stopPropagation(); eyaletSec(id, g); });

                eyaletlerMap.set(id, { 
                    isim: isim, sahibi: ulkeSahibi, varsayilanRenk: eyaletRengi, graphicsRef: g, sinirlar: sinirlar
                });
                mapContainer.addChild(g);
            }

            if (index < totalFeatures) {
                requestAnimationFrame(yukle);
            } else {
                kameraSisteminiKur();
                mapContainer.scale.set(1);
                mapContainer.position.set(0, 0);
                teknolojiArayuzunuGelistir();

                // YENİ: Harita yüklenmesi bitince sunucuya tüm eyalet ID'lerini bildir.
                // Sunucu eğer veritabanı boşsa (oyun yeni başlıyorsa) bunlara random asker basacak.
                let eyaletListesi = [];
                for (let [id, eyalet] of eyaletlerMap) {
                    eyaletListesi.push({ id: id, sahibi: eyalet.sahibi });
                }
                socket.emit('haritaBilgisiGonder', eyaletListesi);
            }
        }
        yukle();
    } catch (e) { console.error(e); }
}

function teknolojiArayuzunuGelistir() {
    const techModal = document.getElementById('tech-modal');
    if (!techModal) return;
    const flexContainer = techModal.querySelector('div');
    if (!flexContainer) return;

    const tumAğacTeknolojileri = [
        { id: 'piyade', name: '⚔️ Piyade Ekipmanları', desc: 'Saldırı gücünü %30 arttırır.', cost: 200, req: null, color: '#00ffff' },
        { id: 'tank', name: '🚜 Zırhlı Birlikler (Tank)', desc: 'Ordunuza tanklar ekler, saldırı gücünü %60 arttırır.', cost: 450, req: 'piyade', color: '#3498db' },
        { id: 'hava_kuvvetleri', name: '✈️ Hava Kuvvetleri', desc: 'Hava üstünlüğü kurar, Saldırıya %40, Savunmaya %20 bonus sağlar.', cost: 550, req: 'piyade', color: '#9b59b6' },
        { id: 'hayalet_ucak', name: '🛸 Hayalet Uçak Filosu', desc: 'Radara yakalanmayan uçaklar, devasa %50 Saldırı bonusu verir.', cost: 900, req: 'hava_kuvvetleri', color: '#8e44ad' },
        { id: 'taktik', name: '🧠 Askeri Doktrin & Taktik', desc: 'Savunma gücünü %40 arttırır.', cost: 400, req: null, color: '#f39c12' },
        { id: 'tahkimat', name: '🛡️ Bölgesel Tahkimat Sınırları', desc: 'Savunma gücüne ekstra %20 bonus sağlar.', cost: 350, req: 'taktik', color: '#e67e22' },
        { id: 'fuze', name: '🚀 Balistik Füze Teknolojisi', desc: 'Ağır füze sanayisini başlatır. (ICBM için ön şart)', cost: 600, req: 'taktik', color: '#e74c3c' },
        { id: 'icbm', name: '☢️ ICBM Kıtalararası Füze', desc: 'Sınır bağımsız eyaletlerin ordusunu %90 yok eder.', cost: 1200, req: 'fuze', color: '#c0392b' },
        { id: 'uzay_savunma', name: '🛰️ Lazerli Uzay Savunma Ağı', desc: 'Düşman ICBM nükleer füzelerini havada imha eder! (Anti-Nuke)', cost: 1800, req: 'icbm', color: '#ff0055' },
        { id: 'gemi_gucu', name: '⚓ Deniz Hakimiyeti (Donanma)', desc: 'Tüm savaşlara %25 deniz ateş desteği sağlar.', cost: 300, req: null, color: '#1abc9c' },
        { id: 'denizalti', name: '🦈 Nükleer Denizaltılar', desc: 'Donanma gücünü katlar, ekstra %30 saldırı gücü sağlar.', cost: 600, req: 'gemi_gucu', color: '#16a085' },
        { id: 'endustri', name: '⚙️ Endüstriyel Altyapı', desc: 'Sivil fabrikaların günlük gelirini 2 altından 5 altına yükseltir.', cost: 500, req: null, color: '#f1c40f' },
        { id: 'maliyet_dusurme', name: '💰 Seri Üretim Hattı', desc: 'Asker üretim maliyetini 100 altından 65 altına düşürür.', cost: 600, req: 'endustri', color: '#2ecc71' },
        { id: 'mega_fabrikalar', name: '🏭 Mega Endüstriyel Kompleks', desc: 'Sivil fabrika gelirini 5 altından 10 altına çıkarır.', cost: 1000, req: 'maliyet_dusurme', color: '#27ae60' },
        { id: 'istihbarat', name: '🕵️ Gizli Servis & İstihbarat', desc: 'Düşman zafiyetlerini bulur. Hem saldırıya hem savunmaya %15 bonus.', cost: 450, req: null, color: '#34495e' }
    ];

    let htmlIcerik = "";
    tumAğacTeknolojileri.forEach(tech => {
        const arastirildiMi = window.teknolojilerim[tech.id];
        const kilitliMi = tech.req ? !window.teknolojilerim[tech.req] : false;
        
        let butonMetni = `${tech.cost} 💰 Araştır`;
        let butonStili = "width: 140px; margin: 0;";
        let disabledAttr = "";

        if (arastirildiMi) {
            butonMetni = "✓ Araştırıldı";
            butonStili += " background: #27ae60 !important; color: white; cursor: not-allowed;";
            disabledAttr = "disabled";
        } else if (kilitliMi) {
            butonMetni = `🔒 Kilitli`;
            butonStili += " background: #7f8c8d !important; opacity: 0.6; cursor: not-allowed;";
            disabledAttr = "disabled";
        }

        const reqGosterge = tech.req ? `<br><span style="font-size: 11px; color: #e74c3c;">⚠️ Önşart: ${tech.req.toUpperCase()}</span>` : '';

        htmlIcerik += `
            <div style="background: rgba(15, 35, 40, 0.85); padding: 14px; margin-bottom: 8px; border: 1px solid #004d40; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                <div style="max-width: 65%;">
                    <strong style="color: ${tech.color}; font-size: 15px;">${tech.name}</strong>${reqGosterge}
                    <div style="font-size: 12px; color: #bdc3c7; margin-top: 4px;">${tech.desc}</div>
                </div>
                <button id="tech-${tech.id}" class="btn" style="${butonStili}" ${disabledAttr} onclick="window.teknolojiArastir('${tech.id}')">${butonMetni}</button>
            </div>
        `;
    });

    flexContainer.innerHTML = htmlIcerik;
}

window.sinirKomsusuMu = function(hedefId) {
    const hedefEyalet = eyaletlerMap.get(hedefId);
    if (!hedefEyalet || !hedefEyalet.sinirlar) return true; 
    const h = hedefEyalet.sinirlar;
    const padding = 20; 
    for (let [id, eyalet] of eyaletlerMap) {
        if (eyalet.sahibi === window.benimUlkem && eyalet.sinirlar) {
            const e = eyalet.sinirlar;
            const kesisiyorMu = !(
                h.maxX < e.minX - padding || h.minX > e.maxX + padding || 
                h.maxY < e.minY - padding || h.minY > e.maxY + padding
            );
            if (kesisiyorMu) return true;
        }
    }
    return false;
};  

function eyaletSec(id, graphicsObj) {
    if (seciliEyaletId && eyaletlerMap.has(seciliEyaletId)) {
        let eskiEyalet = eyaletlerMap.get(seciliEyaletId);
        if (eskiEyalet.graphicsRef) {
            if (window.benimUlkem && eskiEyalet.sahibi === window.benimUlkem) {
                eskiEyalet.graphicsRef.tint = ulkeRenkleri[window.benimUlkem] || 0xcc2929;
            } else {
                eskiEyalet.graphicsRef.tint = rastgeleSabitRenk(eskiEyalet.sahibi);
            }
        }
    }

    seciliEyaletId = id;
    graphicsObj.tint = 0xf1c40f; 

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
        document.getElementById('panel-ordu-enemy').innerText = sunucuVerisi.ordu || 1;
        
        const saldiriAlani = document.getElementById('saldiri-alani');
        let htmlIcerik = "";

        if (window.sinirKomsusuMu(id)) {
            htmlIcerik += `<button class="btn btn-saldiri" onclick="window.eyaleteSaldir()">⚔️ SAVAŞ AÇ / SALDIR!</button>`;
        } else {
            htmlIcerik += `<div class="stat" style="color:#7f8c8d; text-align:center; font-size:13px;">❌ Sınır Komşusu Değil.</div>`;
        }

        if (window.teknolojilerim.icbm) {
            htmlIcerik += `<button class="btn" style="background:#d35400; border-color:#e67e22; margin-top:8px;" onclick="window.icbmFirlat()">☢️ ICBM FIRLAT (500 💰)</button>`;
        }

        saldiriAlani.innerHTML = htmlIcerik;
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

window.eyaleteSaldir = function() {
    if (!seciliEyaletId) return;
    const sabitVeri = eyaletlerMap.get(seciliEyaletId);
    socket.emit('saldiri', { id: seciliEyaletId, isim: sabitVeri.isim, eskiSahibi: sabitVeri.sahibi });
};

window.teknolojiPaneliniAc = function() {
    document.getElementById('tech-modal').style.display = "block";
    teknolojiArayuzunuGelistir(); 
};

window.teknolojiArastir = function(techId) {
    socket.emit('teknolojiArastir', techId);
};

window.icbmFirlat = function() {
    if (!seciliEyaletId) return;
    const sabitVeri = eyaletlerMap.get(seciliEyaletId);
    if(confirm(`${sabitVeri.isim} eyaletine NÜKLEER FÜZE fırlatılsın mı? (500 Altın)`)) {
        socket.emit('icbmFirlat', { id: seciliEyaletId, isim: sabitVeri.isim, eskiSahibi: sabitVeri.sahibi });
    }
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

socket.on('stateGuncelle', (serverState) => {
    document.getElementById('day-counter').innerText = serverState.gun;
    sunucuEyaletVerileri = serverState.eyaletler;

    const aktifOyuncu = serverState.oyuncular[socket.id];
    if (aktifOyuncu) {
        document.getElementById('my-gold').innerText = aktifOyuncu.para;
        
        if (aktifOyuncu.teknolojiler) {
            window.teknolojilerim = aktifOyuncu.teknolojiler;
            if(document.getElementById('tech-modal').style.display === "block") {
                teknolojiArayuzunuGelistir();
            }
        }
    }

    for (let [id, eyalet] of eyaletlerMap) {
        if (sunucuEyaletVerileri[id]) {
            let yeniSahibi = sunucuEyaletVerileri[id].sahibi;
            eyalet.sahibi = yeniSahibi;
            if (eyalet.graphicsRef && id !== seciliEyaletId) {
                if (window.benimUlkem && yeniSahibi === window.benimUlkem) {
                    eyalet.graphicsRef.tint = ulkeRenkleri[window.benimUlkem] || 0xcc2929;
                } else {
                    eyalet.graphicsRef.tint = rastgeleSabitRenk(yeniSahibi);
                }
            }
        }
    }

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
            
            const saldiriAlani = document.getElementById('saldiri-alani');
            if(saldiriAlani) {
                let htmlIcerik = "";
                if (window.sinirKomsusuMu(seciliEyaletId)) {
                    htmlIcerik += `<button class="btn btn-saldiri" onclick="window.eyaleteSaldir()">⚔️ SAVAŞ AÇ / SALDIR!</button>`;
                } else {
                    htmlIcerik += `<div class="stat" style="color:#7f8c8d; text-align:center; font-size:13px;">❌ Sınır Komşusu Değil.</div>`;
                }
                if (window.teknolojilerim.icbm) {
                    htmlIcerik += `<button class="btn" style="background:#d35400; border-color:#e67e22; margin-top:8px;" onclick="window.icbmFirlat()">☢️ ICBM FIRLAT (500 💰)</button>`;
                }
                saldiriAlani.innerHTML = htmlIcerik;
            }
        }
    }
});

socket.on('savasSonucu', (data) => {
    const tur = data.kazanan ? 'zafer' : 'kayip';
    window.gosterBildirim(data.mesaj, tur);
});

haritayiYukleVeKur();

socket.on('nukleerBildirim', (data) => {
    window.gosterBildirim(data.mesaj, 'nuke');
});

socket.on('ulkeIlhakEdildi', (data) => {
    window.gosterBildirim(data.mesaj, 'zafer');
});
