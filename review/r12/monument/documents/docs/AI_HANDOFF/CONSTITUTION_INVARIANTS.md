# BAARNE Constitution Invariants

Bu dosya yeni kural koymaz. Kabul edilmiş kod ve raporlardan gelecekteki agentların bozmaması gereken sınırları özetler.

1. **REFERENCE tarihsel bir tanıklıktır.** Gelecekteki davranış, güvenlik, itibar veya hukuki sorumluluk garantisi değildir.
2. **Tarihsel kayıtlar yeniden yazılmaz.** Sonradan anahtar rotasyonu, resignation veya ilişkinin değişmesi eski imzayı matematiksel olarak yok etmez.
3. **M1 düzenli üyelik üç geçerli referans ister.** Referans verenler üç farklı aktif stable identity olmalıdır. Bu, üç farklı insanı kanıtlamaz.
4. **Aktif üyede üç eşzamanlı referans yuvası vardır.** Accepted lifecycle kuralları dışında elle bakiye/slot düzenleme yapılamaz.
5. **Aday iptali rezervasyonları bırakır; suspension bırakmaz.** Pending uygulamalar otomatik zaman aşımına uğramaz.
6. **İlk başarılı düzenli üyelik Genesis'i atomik ve geri döndürülemez biçimde kapatır.** Ayrı `GENESIS_CLOSED` komutu yetkisizdir.
7. **Membership state yalnızca geçerli olay replay'inden doğar.** Veritabanı, API veya snapshot tek başına protokol gerçeği değildir.
8. **Finality ile attestation varlığı aynı değildir.** EAS kaydı BAARNE olayının yetkili/geçerli olduğunu tek başına kanıtlamaz.
9. **Yönetici/founder override yoktur.** Desteklenmeyen suspension ve expulsion olayları `UNSUPPORTED_POLICY` olarak kalır.
10. **Frozen M1 sessizce değiştirilemez.** Yeni davranış versioned modül/olay ve açık karar gerektirir.
11. **Stable identity bir insan-tekilliği kanıtı değildir.** Sybil ve insan benzersizliği çözüldü denemez.
12. **Reference, discovery ve introduction grafikleri ayrıdır.** Öneri veya karşılıklı tanıştırma otomatik sosyal/constitutional referans değildir.
13. **Behavioral Twin açık rıza sınırına tabidir.** Özel onboarding alanı ancak discovery izniyle eşleştirmede kullanılabilir; introduction disclosure ayrıca onaylanır.
14. **Sentetik kanıt gerçek kullanıcı geçerliliği değildir.** Yerel demo; güvenlik, hukuk, fayda veya benimsenme kanıtı sayılmaz.
15. **Eksik kanıt boş/geçerli geçmiş değildir.** Arşiv yokluğu `UNAVAILABLE/INCOMPLETE` olarak fail-closed ele alınır.
16. **Core Pilot NO-GO sınırı sürer.** Canlı taahhütler, bağımsız arşiv, anahtar operasyonları ve hukuk/mahremiyet kapanmadan pilot başlatılmaz.

Bir görev bu maddelerden birini değiştirmek istiyorsa agent raporu `approval_required` olmalı ve çalışma açık insan kararı gelene kadar durmalıdır.
