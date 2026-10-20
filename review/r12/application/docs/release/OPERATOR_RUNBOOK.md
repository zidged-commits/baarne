# Seçili sentetik aday — tek operatör işletim kılavuzu

Bu belge K6/A7'nin yerel teknik teslimidir. Üretim kurulumu, insan/operatör
bağımsızlığı, ağ otoritesi veya GO kararı değildir. Production şablonu
`OPERATOR_CLOSED_DEFAULTS.json` kapalıdır; mevcut preflight yeniden yazılmaz.
Gerçek roller, anahtar/retention kararları ve alarmlar C1–C4'e kalır.

## Kurulum ve sağlık

1. `V1_ENGINEERING_BUILD.json` içindeki base kit ve uygulama katmanı pinlerini
   bağımsız kayıtla doğrula. Base kit'in eski node-review klasörünü aktif app
   sanma; applicationLayer.localDirectory/manifestSha256 kullanılır.
2. Windows özel Hub için kit'in Node 24.22.0 runtime'ını kullan. App review
   paketi ethers/TypeScript'in seçili bytes/notice'larını içerir; npm install
   veya global runtime değişikliği yapılmaz. DPAPI için aynı Windows hesabı
   gerekir. Linux Core binary'leri ayrı kit'tedir; Windows Hub Linux'ta çalışır
   gibi gösterilmez.
3. Parent'ı hazırlanmış iki **yeni ve ayrı** özel dizin seç: provider ve
   workspace. Provider source/review/yedek dışında kalır. Aşağıdaki değerler
   gerçek dosya veya pin değil, doldurulacak yer tutuculardır.

```powershell
& 'KIT/runtime/win-x64/node.exe' apps/hub/operator-cli.mjs init ISOLATED_SYNTHETIC_LAB 'NEW_PROVIDER' 'NEW_WORKSPACE'
& 'KIT/runtime/win-x64/node.exe' apps/hub/operator-cli.mjs status ISOLATED_SYNTHETIC_LAB 'PROVIDER' 'PROVIDER_PIN' 'LATEST_CONTROL_PIN'
& 'KIT/runtime/win-x64/node.exe' apps/hub/operator-cli.mjs run ISOLATED_SYNTHETIC_LAB 'PROVIDER' 'PROVIDER_PIN' 'LATEST_CLEAN_CONTROL_PIN'
```

PROVISIONED/READY/HEALTH/CHECKPOINT/STOPPED JSON satırları public metadata'dır;
provider protected blob'u veya owner private key içermez. Pinleri ayrı güvenilir
kayıtta tut. `provider.json` dosyasını sohbet/log/repo'ya dökme. Health için
çalışan terminale `health` yaz. Durum, pendingPin, storage policy, bellekteki
vault/pair revision'ları ve write-stop nedeni görünür. Bunlar consensus/freshness
kanıtı değildir. Eski demo `/health`, özel servis işletim sağlığı yerine geçmez.
Çalışan dış alarm/monitoring hedefi yok; stdout kaydı gerçek entegrasyon sayılmaz.

## Normal stop ve yeniden başlatma

Çalışan terminale `stop` yaz; STOPPED/CLEAN ve yeni controlPin olmadan temiz
kapanış varsayma. Bu tüm servisi durdurur; üyelik geçmişini değiştirmez.
READY veya CHECKPOINT içindeki RUNNING pini yerine son CLEAN piniyle `run`
kullan. Aynı origin korunur; port başka uygulamadaysa otomatik farklı porta
taşınmaz. Owner encrypted pending journal ayrı istemci materyalidir.

## Ani kesinti ve belirsiz gönderim

Her değişiklik öncesi şifreli intent ve dış pinned control, sonra imzalı native
geçiş ve checkpoint kaydedilir; HTTP başarı yanıtı bunlardan sonra gelir.
Control V2 pendingPin'i taşır. R10 control V1 dosyaları otomatik göç ettirilmez.

RUNNING durumundaki **son bilinen pinle**, ayrı açık lab kurtarma komutu:

```powershell
& 'KIT/runtime/win-x64/node.exe' apps/hub/operator-cli.mjs recover ISOLATED_SYNTHETIC_LAB 'PROVIDER' 'PROVIDER_PIN' 'LAST_KNOWN_RUNNING_CONTROL_PIN'
```

Kurtarma native store'da yalnız sıfır veya tek beklenen signed tail kabul eder.
NOT_APPLIED ise istemci kendi aynı imzalı intent'ini retry eder; APPLIED ise
receipt bulunur, çift etki olmaz. READ/SOURCE_SYNC sınırları yeniden kurulur.
Yeni CHECKPOINT/READY olmadan servis açılmış sayılmaz. Bütün metadata/pin
geçmişinin birlikte rollback'ini çözdüğü veya son global state'i bildiği
iddia edilmez. Kayıp/bilinmeyen pin için dosyanın kendi hash'ini otomatik
otorite sayma; marker silerek veya eski izin yedeğine dönerek devam etme.

Henüz yanıtlanmamış ENROLL sırasında partial store oluşursa yeni servis
anahtarı uydurulmaz; unavailable/inceleme kalır. Kabul edilmiş profil işlemi
başarı sayılmadan önce enrollment checkpoint'i zaten kaydedilmiştir. Bu sınır
gerçek testte doğrulanır; bütün yarım dosyaların otomatik onarıldığı söylenmez.

## Kota, disk ve incident

Default lab politikası vault başına 1000 revision ve en az 16 MiB boş alan
rezervidir. Politikayı fresh sentetik API girdisiyle daraltmak testlerde
kullanılır; var olan workspace'te sessiz limit yükseltme yoktur. Native pair
4095 action / son 32 SOURCE_NOTICE rezervini ve byte sınırını korur.

Disk rezervi veya kesin kota duruşunda yeni yazılar durur; imzalı read/export
var olan durumdan çalışır. Halt checkpoint'e kaydedilir ve restart'ta kaybolmaz.
Disk yazısı ortada hata verirse outcome UNKNOWN/FAULTED kalır; temiz stop pini
verilmez. Alan/cihaz sorunu giderilmeden kurtarma denemesi yapma. Lab testleri
gerçek statfs rezerv ölçümünü, gerçek düşük revision kotasını ve ayrı enjekte
ENOSPC yolunu kapsar; host diski doldurulmadı, power-loss/hardware sertifikası yok.
Kota dolunca tarihsel snapshotları elle silme; bu imzalı replay'i bozar.

Anahtar/servis şüphesinde tüm servisi `stop` ile kapat, son doğrulanmış
checkpoint/control/intent'i koru. Root key kaybında admin reset yok; DPAPI
bağlamı kayıpsa ciphertext backup yeterli değildir. Key çalınması servis
mahremiyetini etkiler, owner signing yetkisi vermez. Aynı-user malware/admin/
bellek erişimi DPAPI sınırının dışında kalır. Gerçek incident owner ve üretim
custody kararı `OPERATOR_CLOSED_DEFAULTS.json` üzerinden incelemeye sunulur.

## Kapalı backup ve restore

```powershell
& 'KIT/runtime/win-x64/node.exe' apps/hub/operator-cli.mjs backup ISOLATED_SYNTHETIC_LAB 'PROVIDER' 'PROVIDER_PIN' 'CLEAN_CONTROL_PIN' 'NEW_BACKUP'
& 'KIT/runtime/win-x64/node.exe' apps/hub/operator-cli.mjs restore ISOLATED_SYNTHETIC_LAB 'PROVIDER' 'PROVIDER_PIN' 'CLEAN_CONTROL_PIN' 'BACKUP' 'TRANSFER_PIN' 'NEW_REPLACEMENT'
```

Provider bu yedeğe girmez. Transfer + beklenen checkpoint pini/checksumlar
hedef yaratılmadan doğrulanır; mevcut hedef ezilmez. RESTORED_UNVERIFIED yeni
dizin demektir; native replay ile run tamamlanmadan doğrulanmış servis değildir.
Eski source korunur. Kayıp/corrupt/tamamen unavailable veri başarılı boş geçmiş
sayılmaz. Silme/geri çekme eski encrypted backup'ı ve peer kopyasını fiziksel
olarak silmez; eski izinli yedeği güncel onay gibi kullanma.

## Core, arşiv ve şirket gateway'i olmadan doğrulama

Core farklı trust/storage alanıdır: V3 + CometBFT + bağımsız offline semantic
replay/certificate doğrulayıcıları. Hub backup'ı validator signing-state veya
Core arşivi değildir. Fresh lab provisioning, container stop/restart ve
quota-halt mevcut harness'lerde kullanılır; yeni consensus/monitoring platformu
yazılmaz. Public proof'tan validator key/signing-state geri yüklenmez;
double-sign riskini sahte recovery adımıyla kapatma. Gerçek validator custody
ve ağ üyelik otoritesi C3'tedir, bu runbook onu benimsemez.

`scripts/check-k4-lifecycle.py --help`: pinned kit + aktif app-review, fresh
work/output ile dört yerel validator kabulü (published port yok).
`scripts/check-k4-offline-proof.py --help`: açık public blockstore/Genesis,
kit/app pinleriyle ayrı Go certificate ve Node replay.
`scripts/check-k4-archive.py --help`: tek public surviving archive'den yeni
dizine checksum restore ve aynı iki mevcut doğrulayıcı. RESTORED byte'ları
tek başına signed-history doğrulaması değildir. Bu yollar BAARNE API'sine
bağlı değildir. Gerçek bağımsız makine/operatör veya latest-state kanıtı sayılmaz.

Geçerli K4 binary/core source pinleri unchanged ise tarihsel topoloji kanıtı
kapsamı korunur; final A1–A8 ve kaynak karşılaştırması K7 kabul kaydındadır.
Test için açılan Docker kaynakları harness'in kendi adlarıyla temizlenir;
bu çalışma öncesinde kapalı olan Docker finalde tekrar kapatılır. Başka
projelerin container/volume'larına dokunulmaz. AWS bu işletim kabulünde gerekmez.
