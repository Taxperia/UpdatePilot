# UpdatePilot 3.0 — Node.js / Electron

UpdatePilot kurulu Windows uygulamalarını otomatik analiz eder, desteklenen uygulamaların resmi sürüm kaynaklarını kontrol eder ve **Update / Güncelle** düğmesine basıldığında kurulum paketini indirir. Diğer uygulamalarda WinGet kataloğu kullanılır. Arayüz siyah-beyazdır; varsayılan dil İngilizcedir. Almanca, Fransızca ve Türkçe de desteklenir.

## Çalıştırma

`UpdatePilot.bat` dosyasına çift tıklayın. Paketlenmiş uygulama varsa doğrudan açılır. Geliştirme sürümü için Node.js 22+ gerekir; Python gerekmez.

```powershell
npm.cmd ci
npm.cmd start
```

PowerShell'de proje klasörüne geçerek çalıştırın:

```powershell
cd "C:\Users\talba\Desktop\gh\UpdatePilot"
npm.cmd start
```

Pencere açıldığında terminalde `UpdatePilot window opened.` mesajı görünür. Windows'ta başlatıcı Electron'u görünür başlatır; uygulama zaten açıksa mevcut pencereyi öne getirir. Küçültülmüş başlatma tercih edilirse tepsi simgesinden açabilirsiniz.

## Ayarlar

Sol alttaki **Settings** düğmesi, sol bölüm menüsü ve anında kaydedilen tercihlerle modal pencere açar. GitHub ayarları ile veri/klasör yönetimi bölümü kaldırılmıştır; sürüm deposu desteği uygulama detayında korunur.

- **General:** Windows ile başlatma, sistem tepsisine küçültme, indirmeler devam ederken çıkış onayı, küçültülmüş başlatma ve açılış sayfası.
- **Appearance:** Siyah veya beyaz görünüm; renkli gradyan kullanılmaz. Kompakt liste seçeneği.
- **Updates:** Açılış kontrolü, çalışırken zamanlanmış kontrol (15 dakika / 1 saat / 6 saat / 1 gün), otomatik paket indirme ve ön sürüm filtresi. Otomatik indirme varsayılan olarak kapalıdır; açıldığında en fazla iki paket aynı anda indirilir. Yükleyiciler kendiliğinden çalıştırılmaz.
- **Notifications:** Windows bildirimleri, indirme tamamlandı/hata tercihleri ve gerçek test bildirimi. Uygulama kimliği ve Windows Başlat menüsü kısayolu kaydedilir; bildirim hataları geçmişe yazılır. Aynı bildirim oturum boyunca tekrarlanmaz. Bildirime tıklama güncelleme listesini veya indirilenleri açar.
- **Language:** English / Deutsch / Français / Türkçe. Arayüz ve gelecekteki bildirimler anında değişir; tercih kalıcıdır.
- **Advanced:** Kullanıcı kapsamındaki uygulamaları tarama ve uygulamadan çıkış.

Windows başlangıcı varsayılan olarak kapalıdır. Etkinleştirildiğinde yalnızca bu uygulama için kullanıcı başlangıç kaydı eklenir; kapatıldığında kaldırılır. Taşınabilir EXE kullanıldığında geçici açılım klasörü yerine asıl EXE yolu kaydedilir. Windows'un Rahatsız Etmeyin veya bildirim tercihleri başlıkları gizleyebilir; uygulamadaki test düğmesi Windows gönderim sonucunu gösterir.

**Reset defaults** tercihlerde İngilizce/siyah varsayılanlarına döner; takip edilen uygulamaları, paketleri veya geçmişi silmez. **Escape**, dış alana tıklama veya **Done** modalı kapatır.

Tek başına dağıtılabilen Windows uygulaması:

```powershell
npm.cmd run dist
```

Çıktı: `dist/UpdatePilot-3.0.0-x64.exe`. Bu uygulamayı çalıştırmak için Node.js veya Python kurulumu gerekmez. Otomatik Windows katalog kontrolü ve indirmesi için **App Installer / WinGet** gereklidir. `winget --version` ile kontrol edilebilir.

## Güncelleme akışı

1. Açılışta Windows kayıt defterinin 32/64 bit ve kullanıcı kapsamındaki kurulu uygulama kayıtları okunur.
2. `winget list --source winget` ile Windows paket kataloğunun doğruladığı uygulama kimlikleri eşleştirilir. WinGet'in keşfettiği ek uygulamalar listeye eklenir.
3. Açılışta otomatik kontrol açıksa desteklenen uygulamaların resmi sürüm API'leri veya yayıncı GitHub depoları sorgulanır. Resmi kaynak desteği olmayan uygulamalarda `winget show` ile katalog sürümü alınır. **Güncellemeleri Kontrol Et** düğmesi sorguları yeniler.
4. **Kurulu Programlar → Detay → Güncelle** veya satırın indirme simgesi, belirlenen sürümün paketini indirir. WinGet indirmelerinde SHA-256 doğrulaması açık tutulur. İndirme ilerlemesi ve sonuç arayüzde gösterilir.
5. Paketler Windows'un İndirilenler klasöründeki `UpdatePilot` altına kaydedilir. İndirilenler klasörünü uygulamadan açıp resmi yükleyiciyi çalıştırabilirsiniz. **Güncelle düğmesi indirme başlatır; sessiz veya izinsiz kurulum yapmaz.** Kurulumdan sonra **Yeniden Tara** yeni kurulu sürümü okur.

GitHub deposu atanmış uygulamalarda kullanıcı seçimi önceliklidir. Windows'a ve işlemci mimarisine uygun `.exe`, `.msi`, `.msix` veya `.zip` paketi seçilir; GitHub SHA-256 özeti sağlıyorsa doğrulanır. Manuel paketlerin doğrudan HTTPS indirme bağlantısı da aynı indirme akışını kullanır.

## Resmi sürüm kaynakları ve sürüm kanalları

- **Node.js:** `nodejs.org/dist/index.json` doğrudan okunur. Tabloda en yeni genel sürüm gösterilir. Detay panelinde **en yeni genel / en yeni LTS / kurulu ana sürüm serisinin güncellemesi** ayrı indirme seçenekleridir. İndirme, seçilen sürümün resmi Windows MSI/ZIP dosyasıdır; `SHASUMS256.txt` ile SHA-256 doğrulaması zorunludur. Büyük sürüm değişikliği açıkça gösterilir.
- **Cursor ve VS Code:** Yayıncının resmi güncelleme/indirme API'si; kullanıcı/sistem kapsamı ve mimari korunur.
- **Firefox:** Mozilla Product Details API; normal ve ESR kanalı ayrılır, kurulu dil korunur.
- **Chrome:** Google VersionHistory API. Katalogda aynı sürüm yoksa Google'ın genel güncel Windows MSI yükleyicisi kullanılır. Bu bağlantı belirli bir sürüme sabitlenmiş arşiv değildir; Google tarafından güncellenir. Sürüm kontrolü için cihazın OS build'i veya kurulu Chrome sürümü Google'a gönderilmez.
- **Git, GitHub CLI, DBeaver, PowerToys, Tailscale, Notepad++, RustDesk, WinDirStat, Zen Browser:** Doğrulanmış yayıncı GitHub Releases depoları önceliklidir.

Tabloda sürümün altında **Resmi / Katalog / GitHub / Manuel** etiketi bulunur. Sürüm metninin üzerinde bekleyince tam sürüm ve kaynak bilgisi görünür. Detay panelinde kaynak açıkça yazılır.

Katalogdan gelen sonuç resmi sitenin mutlak en yeni sürümü olarak sunulmaz. Eşit sürüm **Katalogda güncel**, kurulu sürümden eski katalog **Katalog eski** olarak gösterilir ve eski paketin indirilmesi engellenir. Resmi API başarısız olursa katalog verisine dönülebilir; başarısızlık ve kullanılan kaynak açıkça belirtilir.

## Kapsam

- Her uygulamanın internette standart bir sürüm API'si yoktur. Resmi kaynak desteği ve WinGet eşleşmesi bulunmayan uygulamalar **Eşleşme yok** olarak gösterilir; bir GitHub deposu veya manuel paket atanabilir. Benzer isimli rastgele depolar otomatik atanmaz.
- Kurulu sürüm belirlenemiyorsa **Bilinmiyor**, ağ/katalog sorgusu başarısızsa **Hata** gösterilir. Başarısız kontrol uygulamayı güncel olarak işaretlemez.
- Microsoft Store'a özel paket indirmeleri bu akışın kapsamına dahil değildir. WinGet kaynağındaki desteklenen masaüstü paketleri kullanılır.
- Mimariye uygun yükleyici bulunmazsa hata gösterilir; yanlış işletim sistemi paketi indirilmez.
- Otomatik analiz ve güncelleme kaynağı Windows için geliştirilmiştir. macOS/Linux desteği bu sürümün kapsamına dahil değildir.

## Yedek ve mevcut veriler

Düzenlemeden önce alınan orijinal proje ZIP yedeği `backups/` klasöründedir. Python kaynakları `legacy-python/` altında korunur; yeni uygulama bunları kullanmaz.

- Ayarlar: `%LOCALAPPDATA%\UpdatePilot\config.json`
- Geçmiş: `%LOCALAPPDATA%\UpdatePilot\history.jsonl`
- Paketler: Windows İndirilenler klasörü → `UpdatePilot`

Eski Python sürümünün ayarları, depo eşleştirmeleri, yoksayılan sürümleri ve manuel paketleri aynı veri biçimiyle okunur. İlk Node.js açılışında mevcut ayar dosyasının `config.json.python-backup` kopyası alınır. Bozuk ayarlar otomatik olarak üzerine yazılmaz.

Ayarlar ve geçmiş yereldedir. Katalog, GitHub ve paket sağlayıcılarına gerekli çevrimiçi sürüm/indirme istekleri yapılır. GitHub tokeni arayüze gönderilmez.

## Geliştirme ve doğrulama

```powershell
npm.cmd test
npm.cmd run diagnose
npm.cmd run qa -- --smoke
npm.cmd run qa -- --smoke --smoke-download
npm.cmd run qa -- --smoke --smoke-node-download
npm.cmd run qa -- --smoke --smoke-node-download --smoke-node-track=series
npm.cmd run qa -- --smoke --smoke-settings
npm.cmd run pack
node scripts/packaged-smoke.js
node scripts/packaged-smoke.js --portable
node scripts/packaged-smoke.js --smoke-settings --native-test
```

- Testler sürüm karşılaştırması, otomatik eşleştirme, veri geçişi, hata durumları, mimari seçimi ve dosya doğrulamasını kapsar.
- `diagnose` gerçek kurulu uygulama/katalog kontrolünü yapar; sonuçları `.qa/diagnose.json` içine yazar.
- `qa -- --smoke` gerçek Electron penceresini test eder; ekran görüntüsü ve raporu `.qa/` içine kaydeder.
- `--smoke-download` ayrıca Güncelle düğmesi üzerinden **GitHub CLI** paketini `.qa/downloads` içine indirir. Kurulum yapmaz.
- `--smoke-node-download`, Node.js sürüm seçeneklerini ve resmi en yeni MSI dosyasının indirilmesini doğrular. `--smoke-node-track=series` kurulu ana sürümün güncelleme düğmesini test eder. Kurulum yapmaz.
- QA ve tanılama ayrı veri klasörlerini kullanır; normal kullanıcı ayarlarını değiştirmez.
- `packaged-smoke.js`, `dist/win-unpacked/UpdatePilot.exe` uygulamasını `.qa/packaged` içinde ayrı verilerle test eder.
- `--portable`, dağıtılan tek EXE dosyasını doğrudan test eder; raporu `.qa/portable/smoke.json` içine yazar.
- `--smoke-settings`, dört dilin gerçek modal geçişini, temaları, klavye davranışını ve tercih kaydını doğrular. `--native-test` ayrıca UpdatePilot QA adına geçici bir Windows başlangıç kaydı ekleyip kaldırır ve gerçek Windows bildirimi gönderir. Normal kullanıcı ayarları değişmez.

## Mimari

- `electron/main.js`: Electron penceresi, dar kapsamlı IPC işlemleri, bildirimler ve CSV kaydetme.
- `electron/preload.js`: İzole arayüz köprüsü. Renderer içinde Node.js erişimi kapalıdır; sandbox açıktır.
- `src/scanner.js`: Salt okunur Windows uygulama taraması.
- `src/winget.js`: Katalog eşleştirmesi, sürüm sorgusu ve doğrulanmış paket indirme.
- `src/github.js`, `src/download.js`: GitHub sürümleri, mimari seçimi, HTTPS indirme, ilerleme ve dosya doğrulama.
- `src/official-sources.js`: Resmi yayıncı API'leri, Node.js sürüm kanalları ve doğrulanmış yayıncı deposu eşleştirmeleri.
- `src/app-state.js`, `src/storage.js`, `src/versioning.js`: Uygulama işleri, Python verileriyle uyumlu depolama ve sürüm karşılaştırması.
- `src/preferences.js`, `src/update-scheduler.js`, `src/desktop-services.js`: Tercih doğrulama, zamanlanmış kontroller, Windows başlangıcı, bildirimler ve kısayol kaydı.
- `web/i18n.js`: Arayüz ve sistem bildirimleri için paylaşılan dört dil sözlüğü.
- `web/`: Korunan HTML/CSS/JS arayüzü. Yerel HTTP sunucusu gerekmez.
