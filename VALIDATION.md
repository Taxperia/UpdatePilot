# Doğrulama — 10 Ekim 2026

- Düzenlemeden önce yedek alındı: `backups/UpdatePilot-python-original-20261010-183548.zip`.
- Resmi sürüm düzeltmesinden önce ayrıca Node.js kaynak yedeği alındı: `backups/UpdatePilot-node-before-version-fix-20261010-195455.zip`.
- Arayüz/ayar değişikliğinden önce yedek alındı: `backups/UpdatePilot-before-ui-settings-20261010-201955.zip`.
- Siyah-beyaz görünüm gerçek Electron DOM renkleriyle doğrulandı: bütün görünür arayüz renkleri nötr gri/siyah/beyaz; renkli gradyan yok.
- 48 Node.js işlev testi başarılı. Resmi kaynaklar, sürüm kanalları, tercih kaydı, otomatik kontrol, iki eşzamanlı otomatik indirme, bildirim hataları ve Windows başlangıç yolunun seçimi kapsanır.
- npm bağımlılık denetimi: 0 bilinen güvenlik açığı.
- Gerçek Electron arayüz testi ve paketlenmiş EXE testi başarılı; renderer konsol hatası yok. Renderer içinde `require` erişimi kapalı.
- Geliştirme sırasında hazırlanan taşınabilir EXE doğrudan açılarak da test edildi; sonuç başarılı. İlk GitHub sürümü `v1.0.0` olarak numaralandırılır.
- Başlatıcıdaki Windows gizli pencere bayrağı kaldırıldı. `npm.cmd start` ile görünür `UpdatePilot — Güncelleme Merkezi` penceresi ve ikinci çalıştırmada aynı pencerenin öne gelmesi doğrulandı.
- İngilizce varsayılan; Almanca, Fransızca ve Türkçe gerçek ayar kontrollerinden değiştirilerek ve diske kaydedilerek doğrulandı. Paylaşılan sözlükte 221 anahtarın dört dil karşılığı bulunur.
- Ayarlar modal olarak açıldı; alttaki sayfa korunuyor. Altı ayar bölümü, Escape ile kapanma, klavye odağı, anında kayıt ve siyah/beyaz tema geçişi test edildi. GitHub/veri/klasör bölümleri modalda bulunmuyor.
- Windows başlangıcı UpdatePilot QA adına gerçek kayıtla etkinleştirildi ve test sonunda eski kapalı durumuna döndürüldü. Gerçek test bildirimi Windows tarafından `show` olayıyla doğrulandı.
- Son gerçek tarama: **115 uygulama kaydı, 36 güncelleme, 33 kaynağa göre güncel, 39 eşleşmeyen kayıt, 0 kontrol hatası**. Eski katalog kayıtları ayrıca işaretlenir. Sayılar test anındaki kurulu uygulama ve kaynak durumunu gösterir.
- Node.js kurulu **22.22.2** için resmi kaynak sonuçları: **26.11.1 genel**, **24.21.0 LTS**, **22.23.3 kurulu seri güncellemesi**. Üç seçenek gerçek Electron detay panelinde doğrulandı.
- Cursor kurulu **3.22.12** için resmi API **3.24.12** döndürdü. VS Code resmi API sonucu **1.141.0**. Eski katalog sürümlerine bağlı kalınmadığı doğrulandı.
- Güncelleme düğmeleri üzerinden Node.js **26.11.1** ve **22.23.3** resmi MSI dosyaları ayrı ayrı indirildi; resmi SHA-256 listeleriyle eşleşti. Kurulum yapılmadı.
- Güncelle düğmesi üzerinden GitHub CLI **2.96.0 → 2.102.0** MSI paketi indirildi. Boyut: **15.757.312 bayt**. Kurulum yapılmadı.
- İndirilen MSI'nın SHA-256 değeri WinGet manifestiyle eşleşti: `7944B579D76359E5B859A263BF63583E271AE3FBD427AE46E133C1F348B46371`.

Ekran görüntüleri: `.qa/electron-panel.png`, `.qa/electron-programs.png`, `.qa/electron-detail.png`, `.qa/electron-download.png`, `.qa/electron-settings.png`.

Son uygulama raporları: `.qa/smoke.json`, `.qa/packaged/smoke.json` ve `.qa/portable/smoke.json`. İndirme doğrulaması: `.qa/download-verification.json`.

Node.js sürüm kanalı arayüzü: `.qa/version-detail.json`. Resmi Node.js dosya doğrulamaları: `.qa/node-download-verification.json`.

Ayar/dil/tema raporları: `.qa/settings-validation.json`, `.qa/packaged/settings-validation.json`. Windows testi: `.qa/packaged/native-validation.json`. Görsel örnekler: `.qa/packaged/settings-en.png`, `.qa/packaged/settings-de.png`, `.qa/packaged/settings-fr.png`, `.qa/packaged/settings-tr.png`, `.qa/packaged/settings-light.png`.

Test verileri normal kullanıcı ayarlarından ayrıdır. Desteklenen uygulamalarda resmi API/yayıncı deposu önceliklidir. Diğerlerinde katalog kullanımı ve doğrulama sınırı açıkça gösterilir; desteklenmeyenler GitHub veya manuel paket yoluyla takip edilebilir.
