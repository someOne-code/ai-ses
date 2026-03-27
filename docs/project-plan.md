# Retell-First Emlak Voice SaaS MVP Planı

## Summary

Node.js + TypeScript tabanlı çok kiracılı bir `emlak voice receptionist SaaS` kurulacak. İlk MVP kapsamı:
- inbound çağrı karşılama
- listing/portföy soru-cevap
- showing/randevu talebi
- insan danışmana handoff
- generic webhook ile CRM senkronizasyonu

Temel mimari:
- `Retell`: çağrı ve agent runtime
- `backend`: tenant, office, listing, prompt/config, webhook, audit
- `n8n`: booking ve CRM/calendar otomasyonları
- `admin`: ofis ayarları, prompt, numara, entegrasyon yönetimi

## Key Changes

### 1. Backend Omurgası
`app/backend` içinde Node + TypeScript servis kurulacak.

İlk modüller:
- auth-lite veya internal admin auth
- tenants
- offices
- phone number mappings
- prompt versions
- listing sources
- listings
- inquiries/showing requests
- call logs / audit events
- integration connections

İlk public API yüzeyi:
- `GET /v1/offices/:officeId/listings/search`
- `GET /v1/offices/:officeId/listings/:listingId`
- `GET /v1/offices/:officeId/listings/by-reference/:referenceCode`
- `POST /v1/offices/:officeId/showing-requests`
- `POST /v1/offices/:officeId/listing-inquiries`
- `POST /v1/webhooks/retell`
- `POST /v1/webhooks/n8n/:officeId/:flow`

İlk veri modeli:
- `tenants`
- `offices`
- `phone_number_mappings`
- `prompt_versions`
- `integration_connections`
- `listing_sources`
- `listings`
- `listing_media`
- `listing_facts`
- `listing_inquiries`
- `showing_requests`
- `call_logs`
- `audit_events`

### 2. Retell Tool Katmanı
Retell agent için backend-controlled tool server tanımlanacak.

İlk function/tool set:
- `search_listings`
- `get_listing_by_reference`
- `get_listing_details`
- `create_showing_request`
- `create_listing_inquiry`

Davranış kuralları:
- agent hiçbir listing bilgisini uydurmayacak
- sonuçlar backend tool çıktısından beslenecek
- en fazla birkaç sonuç okunacak
- listing bulunamazsa danışmana yönlendirme veya inquiry fallback’i kullanılacak

### 3. Listing Search ve Portföy Katmanı
Listing soru-cevap için `Property Pulse` mantığı alınacak ama serbest SQL generation ürün mantığına sokulmayacak.

Uygulama kuralı:
- NL query backend’de filtre modeline çevrilecek
- backend parametrik sorgu çalıştıracak
- tool çıktısı kısa ve structured olacak
- office bazlı veri ayrımı zorunlu olacak

İlk desteklenen soru tipleri:
- bölge + oda + bütçe araması
- referans koduyla ilan bulma
- fiyat / oda / m2 / aidat / kat / durum soruları
- benzer ilan önerisi yerine v1’de sadece temel arama ve detay
- showing/randevu talebi oluşturma

### 4. n8n ve Operasyon Akışları
`infra/n8n` referanslarından üretim akışı çıkarılacak.

İlk workflow hedefleri:
- booking workflow: availability check + showing talebi + confirmation webhook
- CRM sync workflow: inquiry/showing/call summary generic webhook fan-out
- ops workflow: Retell call event trigger -> backend normalize -> CRM notify
- high-intent owner alert workflow: `hot` veya `handoffRecommended=true` gibi backend-owned sinyallerde ofis sahibi veya patrona kısa bildirim gönderme

Kurallar:
- n8n source of truth olmayacak
- Vapi referansları Retell-first karşılıklarına çevrilecek
- canlı secret veya hard-coded IDs referanslardan temizlenecek
- customer-facing ayarlar n8n’de tutulmayacak
- yüksek niyetli lead bildirimi prompt içinde gömülü karar olarak değil, backend kuralı + n8n bildirim akışı olarak çalışmalı

### 5. Admin Panel
`app/admin` içinde hafif bir internal operator panel kurulacak.

İlk ekranlar:
- tenant listesi
- office oluşturma/düzenleme
- prompt version yönetimi
- transfer number / timezone / office hours
- listing source kaydı
- webhook/CRM endpoint alanları
- phone mapping görünümü

V1’de olmayacaklar:
- billing
- customer self-serve portal
- gelişmiş analytics
- workflow builder

### 6. V1 Listing İçeri Alma Mekanizması

Admin panelden önce, müşterinin ilanlarını sisteme alacak ilk pratik yol netleştirilecek.

İlk tercih:

- `CSV/XLSX import -> backend normalize -> Postgres upsert -> listing_search_documents sync`

Kurallar:

- v1’de canlı müşteri DB connector’ı zorunlu değil
- ilk sürümde Excel/CSV tabanlı onboarding yeterli kabul edilir
- mevcut search document üretim yolu tekrar kullanılmalı
- ofis bazlı veri ayrımı korunmalı

Bu slice, admin/operator panelinden önce gelmeli çünkü satılabilir ürün için portföy verisinin sisteme alınması yönetim ekranından daha kritik.

### 7. Verification Sonrası Kabul Katmanları

Verification sprint kapandıktan sonra kalan riskler iki ayrı katmanda ele alınmalı.

#### A. Retell Ses Davranışı İncelemesi

Amaç:

- agent doğru soruları soruyor mu
- doğru anda handoff yapıyor mu
- doğru tool'a dallanıyor mu
- kesme, akıcılık ve konuşma hissi yeterli mi

Bu katman için kabul kanıtı:

- Retell `Test Audio`
- Retell `Test Chat`
- transcript ve tool-call incelemesi

Bu katman konuşma kalitesi içindir.
Tek başına backend writeback kabulü sayılmaz.

#### B. Gerçek Provider Kabulü

Amaç:

- stubbed local kabulden sonra gerçek dış servis davranışını doğrulamak

İlk sıra:

1. gerçek takvim sağlayıcısı
   - ilk tercih `Google Calendar`
2. gerekirse daha sonra CRM-native sağlayıcı

Bu katmanda doğrulanacaklar:

- gerçek auth/onboarding
- gerçek availability ve booking side effect'leri
- provider-specific hata gövdeleri
- backend görünürlüğünün ve audit zincirinin bozulmaması

Kural:

- `stubbed local proof` iç mantık kabulüdür
- `real provider proof` canlı entegrasyon kabulüdür
- bunlar birbirinin yerine geçmez

## Test Plan

### Backend
- office bazlı listing araması yalnız doğru tenant verisini döndürmeli
- reference code ile tek ilan bulunmalı
- olmayan listing için güvenli `not found` dönmeli
- showing request oluştuğunda office ve listing foreign key’leri doğrulanmalı
- webhook endpoint’leri auth/secret kontrolü olmadan kabul etmemeli

### Retell Flow
- “Kadıköy’de 3+1 var mı?” -> `search_listings`
- “KD-102 ilanının aidatı ne kadar?” -> `get_listing_by_reference` + `get_listing_details`
- “Bu ev için yarın akşam bakmak istiyorum” -> `create_showing_request`
- veri eksikse agent uydurma yapmadan fallback vermeli

### n8n
- booking flow backend request’ini alıp takvim uygunluğunu işlemeli
- call summary veya inquiry event’i generic webhook’a düşmeli
- Vapi-specific node/config kalmamalı
- referans workflow’taki hard-coded secret/id değerleri kaldırılmış olmalı

### Acceptance
- tek ofisli demo değil, tenant-aware veri yapısı kurulmuş olmalı
- inbound + listing + booking akışı uçtan uca gösterilebilir olmalı
- Retell tool cevapları backend-controlled olmalı
- CRM entegrasyonu generic webhook ile çalışmalı

## Assumptions

- backend stack: Node.js + TypeScript
- ilk CRM entegrasyonu: generic webhook
- MVP scope: inbound + listing + booking
- Retell varsayılan voice platform
- n8n yalnız iç otomasyon katmanı
- listing search v1’de parametrik sorgu ile kurulacak; serbest AI SQL generation üretime alınmayacak
- auth v1’de internal admin/operator seviyesinde tutulabilir; customer self-serve sonraya bırakılır
