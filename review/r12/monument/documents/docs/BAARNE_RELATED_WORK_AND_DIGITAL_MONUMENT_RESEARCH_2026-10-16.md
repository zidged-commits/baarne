# BAARNE: benzer çalışmalar ve dijital anıt değerlendirmesi

Araştırma tarihi: 2026-10-16. Görev: `BAARNE-RELATED-WORK-MONUMENT-20261016`.

Bu bir kaynaklı karşılaştırma ve tasarım önerisidir. Ürün/politika kabulü, teknik uyumluluk testi, bağımsız audit veya özgünlük/patent incelemesi değildir. Mevcut M1, mahremiyet ve pilot sınırları değiştirilmez. Core Pilot NO-GO kalır. Hiçbir dış topluluğa mesaj gönderilmedi.

## Kapsam ve yöntem

BAARNE'nin mevcut hedefi: gönüllü bilgiye dayalı açıklanabilir karşılıklı fırsat ve iki taraflı rıza; tarihsel REFERENCE, deterministik üyelik ve bağımsız replay; zorunlu kullanıcı ücreti/token/gas olmadan kurucudan bağımsız işletim hedefi. Bu hedefler, projelerin kendi dokümanları ve teknik şartnameleriyle karşılaştırıldı. Pazarlama iddiaları, o iddiaların bağımsız ispatı olarak alınmadı. Ürünlerin güncel deployment, güvenlik veya ekonomik başarısı test edilmedi.

## İlke ve teknik yakınlık

| Çalışma | Doğrulanan benzerlik | BAARNE açısından kritik fark |
| --- | --- | --- |
| Duniter / Ğ1 | İmzalı sosyal sertifikalarla üyelik, grafik mesafesi, sertifika kapasitesi ve üyelik yaşam döngüsü. V2 dokümanı davet/onay ve koşullar sağlanınca deterministik kaydı açıklar. | Para yaratımına ilişkin üyelik amaçlanır. BAARNE'nin tarihsel referansı, üç aktif yuvası, otomatik Genesis kapanışı ve altı-hop sorgusu bu kuralların aynısı değildir. V1/V2 parametreleri karıştırılmamalı. [V2 yaşam döngüsü](https://duniter.fr/wiki/doc-v2/concept/tdc/), [ayrıntılı tarihsel WoT kuralları](https://duniter.fr/wiki/toile-de-confiance/la-toile-de-confiance-en-detail/) |
| BrightID | Merkeziyetsiz sosyal grafik üzerinden benzersiz katılım hedefi ve sosyal kurtarma yaklaşımı. | Benzersiz insan iddiası temel amaçtır; BAARNE stable identity'nin tek insanı kanıtlamadığını açıkça korur. Grafik kullanımı başarı ispatı değildir. [Projenin açıklaması](https://www.brightid.org/about) |
| Secure Scuttlebutt | Offline çalışmaya uygun, eşler arası çoğaltılan, imzalı ve önceki kayda bağlı append-only kullanıcı feed'leri. | Kullanıcı feed sırası, BAARNE'nin farklı üyeler arasındaki kapasite yarışlarını tek kanonik sıraya bağlama gereksinimini tek başına çözmez. [Protokol](https://scuttlebutt.nz/docs/protocol/), [teknik rehber](https://ssbc.github.io/scuttlebutt-protocol-guide/) |
| Nostr | Küçük bir ortak event formatı; anahtar sahibinin imzası; birden fazla istemci ve relay. | Temel NIP-01, BAARNE'nin Genesis/üyelik/slot kurallarını veya ortak consensus-finality geçmişini tanımlamaz. [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) |
| Holochain | Katılımcı merkezli yerel source chain'ler, dağıtık doğrulama ve taraflar arası countersigning. | Global durum konsensüsü hedeflemez; countersigning kendi başına çift harcamayı önlemez. İncelenen doküman özelliği unstable/varsayılan kapalı işaretler. CometBFT yerine doğrudan takılabilir kabul edilmedi. [Teknik açıklama](https://developer.holochain.org/concepts/10_countersigning/) |
| Circles | Sosyal güven grafiğini kişiler ve topluluklar arasında değer dolaşımı için kullanır. | Kişisel/grup para ve token transferi esaslıdır. BAARNE'nin tokensız karşılıklı fırsat ve üyelik amacıyla aynı ürün değildir. [Resmî açıklama](https://docs.aboutcircles.com/overview/how-it-works) |
| Trust over IP / TSP | Merkezi otoriteyi zorunlu kılmama, kriptografik doğrulanabilirlik, uçta anahtarlar ve varsayılan mahremiyet; güvenin bağlamsal ve yönlü ele alınması. | Bir üyelik/keşif ürünü değil, daha genel mimari ve protokol ailesidir. BAARNE ile hazır teknik uyumluluk gösterilmedi. [İlkeler](https://www.trustoverip.org/our-work/design-principles/), [TSP şartnamesi](https://trustoverip.github.io/tswg-tsp-specification/) |

W3C Verifiable Credentials da imzalı ve taşınabilir iddia modeli açısından ilgili standarttır; imzanın doğrulanması iddianın doğru olmasıyla aynı değildir. BAARNE_REFERENCE_V1 bir W3C VC uyumluluk iddiası taşımaz. [VC Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/).

### Araştırmacı değerlendirmesi

Üyelik kuralları için en yakın karşılaştırma Duniter; imzalı ve dağıtık sosyal geçmiş için SSB/Nostr; felsefi ve mahremiyet mimarisi için Trust over IP'dir. Birkaç sayı/parametreyi değiştirmek tek başına yeni bir paradigma oluşturmaz. BAARNE'nin anlamlı farkı, referansı tarihsel tanıklık olarak sınırlandırması ve bunu ayrı rızalı keşif/tanıştırma ürünü, ücretsiz kullanıcı hedefi ve bağımsız doğrulamayla tutarlı bir bütün haline getirmesinde aranmalı.

Bu taramada bütün bu özellikleri aynı kapsamda karşılayan bir eşdeğer doğrulanmadı. Bu, dünyada böyle bir çalışma bulunmadığının ispatı değildir. Karşılaştırma yüzdelik benzerlik veya tartışmasız yenilik iddiası üretmez. Mevcut motoru değiştirmek için gerekçe de oluşturmaz.

SSB teknik rehberinin arşiv bölümünde, iyi belgelenmiş metafeeds çalışmasının topluluğun dağılmaya başlaması dahil nedenlerle benimsenmediği belirtilir. Bu, SSB'nin tamamının sona erdiği anlamına gelmez. BAARNE için çıkarım: doğru kod, belgelenmiş fikir ve yaşayan bakım topluluğu ayrı kanıtlar ister. [Arşiv bölümü](https://ssbc.github.io/scuttlebutt-protocol-guide/#archived-material).

## Dijital anıt

Burada dijital anıt; kurucusu, şirketi, web sitesi veya aktif ağı kalmasa bile gelecekte okunabilen, bağlamı anlaşılabilen ve sınırları içinde doğrulanabilen bir düşünce/yazılım eseri anlamında kullanılır. Anıtın korunması, aktif ağın yeni işlem üretmesi veya o ağın meşru halefi olmasıyla eşdeğer değildir.

### İlgili gerçek örnekler

- **Software Heritage:** kamuya açık kaynak kodu ve gelişim geçmişini toplama, koruma ve paylaşma; içerikle bağlı tanımlayıcılar ve kopyalama yaklaşımı. Bu, BAARNE kod mirası için anlamlı bir modeldir; canlı ağın veya bütün çalışma ortamının korunduğu anlamına gelmez. [Misyon](https://www.softwareheritage.org/mission/), [FAQ](https://www.softwareheritage.org/software-heritage-faq/). Arama servisinde resmî metin görüldü; sayfaların doğrudan açılması araç hatası verdi.
- **GitHub Arctic Code Vault ve Tech Tree:** belirli tarihli kod snapshot'ının yanında onu çözmek/anlamak için kılavuz ve teknik bağlam. Kamuya açık anlatılan temel snapshot 02/02/2020 tarihli; bugün yeni repo yayımlamak bu fiziksel snapshot'a otomatik dahil olmak değildir. Bin yıllık saklama hedefi, bin yıllık çalışabilirlik garantisi değildir. [Arctic Vault](https://archiveprogram.github.com/arctic-vault/), [Tech Tree](https://github.com/github/archive-program/blob/master/TheTechTree.md).
- **Long Now / Rosetta:** yalnız dayanıklı ortam değil, gelecekteki kişinin bilgiyi nasıl okuyacağını da tasarlar. BAARNE açısından ders, kaynak kodun yanında insan tarafından anlaşılabilir anlam ve çözümleme kılavuzu tutmaktır. [Long Now değerlendirmesi](https://longnow.org/ideas/decoding-long-term-data-storage/).

### BAARNE için önerilen ayrım — henüz uygulanmış veya kabul edilmiş değil

| Katman | Korunacak şey | Yaşama koşulu |
| --- | --- | --- |
| Düşünsel anıt | Tarihli manifest, amaç, sınırlamalar, haklar ve tarihsel karar gerekçeleri | Okunabilir belgelerin birden fazla kopyası; özgün sürüm yeni manifestlerle sessizce ezilmez. |
| Hesaplanabilir çekirdek | Açık şartname, kanonik örnekler, pozitif/negatif test vektörleri, küçük çevrimdışı verifier, kaynak ve bağımlılık/toolchain tanımı | Gelecekte yeniden uygulanabilecek açıklık; doğrulayıcı çalışırken BAARNE API'sine, GitHub'a veya paket deposuna zorunlu sorgu yok. |
| Doğrulanabilir tarih kapsülü | Sentetik veya ayrıca yetkilendirilmiş kamu Genesis/olay/geçmiş paketi ve açık güven kökeni | İçeriğin gerçekten saklanması. Hash tek başına veri değildir; geçerli bir prefix, otomatik en yeni geçmiş değildir. |
| Yaşayan ağ | Yeni üyelik/işlem, mevcut karşılıklı fırsatlar ve özel servisler | Çalışan quorum, veri erişilebilirliği, bakım ve meşru operatör halefiyeti. Anıt tek başına bunları sağlayamaz. |

Anıt çekirdeğine özel profil, sohbet, kurtarma materyali ve başka kişileri kalıcı teşhire zorlayan yeni veri eklenmesi önerilmez. Mevcut kamu üyelik grafiğinin bile kalıcı bağlantı metadata'sı taşıdığı unutulmamalıdır; yeni arşiv/içerik politikası ayrı karar ve inceleme ister. Sentetik kapsül en güvenli hazırlık örneğidir.

İmza, belirli bir anahtarla belirli beyanın bağını gösterebilir; bütün toplumsal anlamını veya doğruluğunu onaylamaz. Uzun zaman ufkunda kriptografik varsayımlar ve okunabilirlik de sınırlardır. Yaşayan bileşenlerde hata/güvenlik bakımı gerekebilir; anıtın orijinal kuralları ve tarihsel açıklaması ayrıca korunabilir.

Önerilen başarı deneyi: BAARNE sitesi, ana API, GitHub ve paket depolarına erişim olmadan önceden hazırlanmış kopyayla bir başka kişi manifesti okuyabilsin, örnek geçmişi doğrulasın ve aynı kuralı bağımsız uygulamak için yeterli şartnameyi bulabilsin. Bu yalnız önerilen kabul ölçütüdür; bu araştırmada uygulanmadı. Tamamen durmuş eski bir ağı yeniden başlatmanın otorite/freshness sorunlarını kapatmaz.

## Karar ve uygulama sınırı

Öneri: yaşayan BAARNE ağına ek olarak küçük, sürümlü ve çevrimdışı okunabilir bir anıt çekirdeği hazırlama seçeneğini değerlendirmek. Yeni bağımlılık, lisans kararı, anayasal değişiklik, kişisel veri arşivi, production geçişi veya dış yayın bu araştırmayla yetkilendirilmez. GitHub/Software Heritage/arşiv yayımlaması yapılmadı. Kaynak taraması, bu projelerin kodlarının kullanılabilirliğini veya lisans uyumluluğunu ayrıca doğrulamaz.
