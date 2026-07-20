# Avlu Sipariş Sistemi

Personel ekranı `personel/` adresindedir. Mevcut `m-7k9p3/index.html` dosyasındaki ürünleri ve fiyatları sayfa açılırken otomatik okur; fiyatlar iki yerde ayrı ayrı tutulmaz.

## İlk sürümde olanlar

- 15 masa
- Masa bazında açık sipariş ve toplam
- Menü arama ve kategori filtreleme
- Ürün adedi artırma/azaltma
- Masa notu
- Nakit, kart veya karma ödeme ile masa kapatma
- Supabase personel girişi
- Birden fazla telefonda ortak ve anlık masa durumu
- Bağlantı yoksa Sheets'e gönderilecek kapanış raporlarını cihazda bekletme
- Google Sheets'e satış ve ürün detaylarını gönderme
- Günlük, haftalık, aylık ciro ve ürün satış özetleri

## Google Sheets kurulumu

1. Yeni ve boş bir Google Sheet oluşturun.
2. `Uzantılar > Apps Script` bölümünü açın.
3. `personel/google-apps-script.gs` içeriğini Apps Script editörüne yapıştırın.
4. `setup` fonksiyonunu bir kez çalıştırın ve izinleri onaylayın.
5. `Dağıt > Yeni dağıtım > Web uygulaması` seçin. Çalıştıran kullanıcı olarak kendinizi, erişim için `Herkes` seçeneğini kullanın.
6. Dağıtım sonucundaki `/exec` adresini sipariş ekranındaki `Ayarlar` alanına kaydedin.

Sheet içinde `Satışlar`, `Satış Detayı` ve `Özet` sekmeleri otomatik hazırlanır. Her satışın benzersiz kimliği vardır; aynı kayıt yeniden ulaşırsa ikinci kez yazılmaz.

## Supabase kurulumu

`supabase/migrations/20260720150000_avlu_pos.sql` dosyası 15 masayı, aktif siparişleri, kapanmış satışları, güvenlik politikalarını ve eşzamanlı işlem fonksiyonlarını hazırlar. GitHub-Supabase entegrasyonu açıksa migration `main` dalına alındığında uygulanır.

İlk migration çalışmadan önce Supabase panelinde `Authentication > Users` bölümünden en az bir personel hesabı oluşturulmalıdır. İlk kurulum mevcut kullanıcıları `staff_members` tablosuna güvenli biçimde ekler. Sonraki migration, onaylanmış `@personel.zuhtubeykonagi.com` hesaplarını otomatik olarak `staff` rolüyle personel listesine alır. Yeni personel için ayrıca SQL çalıştırılmaz; Supabase panelinden hesabı oluşturup otomatik onaylamak yeterlidir. Mevcut roller korunur, bu nedenle yönetici hesabı yanlışlıkla `staff` rolüne düşürülmez.

Personelin gerçek e-posta adresi gerekmez. Örneğin `garson1` kullanıcısı için Supabase hesabını `garson1@personel.zuhtubeykonagi.com` e-postasıyla oluşturun, parolayı belirleyin ve hesabı otomatik onaylayın. Personel giriş ekranına yalnızca `garson1` ve parolasını yazar; uygulama dahili e-posta uzantısını kendisi ekler. Mevcut yönetici hesabı tam e-posta adresiyle giriş yapmaya devam edebilir. Dahili adreslerin posta kutusu olmadığı için parola sıfırlama işlemini yönetici Supabase panelinden yapmalıdır.

Güvenlik için Supabase `Authentication` ayarlarında dışarıdan yeni kullanıcı kaydı kapalı tutulmalıdır. Hesapları yalnızca yönetici `Authentication > Users` ekranından oluşturur. Aksi halde proje anahtarını bilen biri uygun uzantıyla kendi hesabını açıp personel listesine girebilir.

## Veri modeli

Açık masalar ve siparişler Supabase'te ortak tutulur. Google Sheets yalnızca kapanan satışların raporlama katmanıdır. İki telefon aynı masaya ürün eklediğinde veritabanı fonksiyonu adetleri atomik olarak artırır; masa kapatma satış ve ürün arşivini tek işlemde oluşturur.

## Sonraki geliştirmeler

- İptal/ikram/indirim ve işlem geçmişi
- Gün sonu kapatma ve kasa farkı
- Yazıcı veya mutfak ekranı
- Menü/fiyat yönetim ekranı
- Otomatik yedekleme ve ayrıntılı raporlar
