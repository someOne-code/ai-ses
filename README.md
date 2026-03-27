# ai-ses

Retell-first, cok kiracili bir `emlak voice receptionist SaaS` prototipi.

Bu repo, bir emlak ofisinin gelen aramalarini karsilayan, portfoy sorularini cevaplayan, showing/randevu talebi toplayan, insan danismana handoff yapabilen ve sonuc olaylarini CRM ile takvim akislarina baglayan urun omurgasini icerir.

## Ne Cozuyor

Urunun hedefi su:

- gelen aramayi kacirmamak
- arayan kisinin niyetini anlamak
- ilan ve portfoy sorularina backend-dogrulamali cevap vermek
- showing talebi olusturmak
- booking ve CRM sonuc zincirini backend kontrollu isletmek
- ofis bazli ve tenant-aware veri sahipligini korumak

## Mimari Ozeti

Sistem 3 ana parcaya bolunur:

### 1. Retell

Retell su isleri yapar:

- cagri runtime
- agent davranisi
- telefon tarafindaki konusma dongusu
- backend tool cagrilari

### 2. Backend

Backend bu urunde source of truth'tur.

Backend su verileri ve davranislari sahiplenir:

- tenants
- offices
- phone number mappings
- prompt versions
- listing sources
- normalized listings
- listing search documents
- showing requests
- call logs
- audit events
- integration connections
- Retell webhook dogrulama
- Retell tool execution
- n8n callback writeback

### 3. n8n

n8n yalnizca ic otomasyon katmanidir.

n8n su isleri yapar:

- booking orchestration
- calendar availability ve booking side-effect'leri
- CRM fan-out
- hafif transform ve callback akislari

Kural:

- backend source of truth
- n8n glue
- Retell call runtime

## Mevcut Durum

Repo bugun itibariyla su ana dilimleri kapsiyor:

- backend temel omurga
- office-scoped listing search
- hybrid search hazirligi ve search document modeli
- Retell tool server
- showing request olusturma
- booking workflow callback yazimi
- CRM delivery callback yazimi
- chained local booking -> CRM akisi
- CSV/XLSX listing import foundation
- ilk gercek provider dogrulamasi olarak Google Calendar path'i
- callback replay ve idempotency hardening

## Su Anda Calisan Temel Ozellikler

### Listing ve Portfoy Tarafi

- office-scoped listing search
- reference code ile tek ilan getirme
- listing search document refresh
- hybrid search icin lexical + embedding hazirligi

### Retell Tool Yuzeyi

Retell tarafinda backend'in sundugu mevcut tool'lar:

- `search_listings`
- `get_listing_by_reference`
- `create_showing_request`

Not:

- README bu noktada sadece kodda gercekten var olan tool setini yazar
- plandaki ama henuz canli tool olmayan alanlar ayri tutulur

### Booking ve CRM

- `ai-ses - Booking Flow`
- `ai-ses - CRM Sync`

Bu akislarda:

- backend kontrati nettir
- callback secret korumalidir
- workflow sonucu backend'e normalize writeback yapar
- replay ve duplicate riski icin idempotency guard vardir

### Listing Onboarding

Ilk practical onboarding yolu su anda:

- `CSV/XLSX import -> backend normalize -> Postgres upsert -> listing_search_documents sync`

Bu slice `admin` panelden once gelmistir cunku satilabilir urun icin portfoy verisinin sisteme alinmasi daha kritik kabul edilmistir.

## Repo Yapisi

```text
ai-ses/
  app/
    backend/        Fastify + TypeScript backend
  docs/             planlar, runbook'lar, verification dokumanlari
  infra/
    n8n/            project-owned workflow asset'leri
  references/       yerel referans repolar ve ornekler
  scripts/          local runtime yardimci scriptleri
  AGENTS.md         repo-level calisma kurallari
```

### Backend Dizinleri

`app/backend/src` altindaki ana alanlar:

- `config/`
  - env parse ve runtime config
- `db/`
  - Drizzle client
  - schema
  - migrations
- `modules/listings/`
  - listing repository, service, routes
  - search-documents
  - embeddings
  - import
- `modules/showing-requests/`
  - showing request create path
- `modules/retell/`
  - webhook ve tool execution
  - post-call analysis normalization
- `modules/integrations/`
  - booking / CRM contract ve callback handling
  - CRM dispatcher
- `modules/health/`
  - health endpoint

### n8n Assetleri

`infra/n8n` altinda project-owned workflow asset'leri bulunur:

- `ai-ses-booking-flow.json`
- `ai-ses-crm-sync.json`

Kural:

- legacy workflow'lar reference-only
- proje source of truth bunlar degil
- project-owned workflow'lar `ai-ses - ...` adlandirmasiyla ayrilir

## Backend API Yuzeyi

Su an kodda bulunan ana HTTP yuzeyleri:

### Health

- `GET /health`

### Listings

- `GET /v1/offices/:officeId/listings/search`
- `GET /v1/offices/:officeId/listings/by-reference/:referenceCode`
- `POST /v1/offices/:officeId/listings/:listingId/search-documents/main/refresh`

### Showing Requests

- `POST /v1/offices/:officeId/showing-requests`

### Retell

- `POST /v1/retell/tools`
- `POST /v1/webhooks/retell`

### n8n Callback Writeback

- `POST /v1/webhooks/n8n/booking-results`
- `POST /v1/webhooks/n8n/crm-deliveries`

## Veritabani Modeli

Ana tablolar:

- `tenants`
- `offices`
- `phone_number_mappings`
- `prompt_versions`
- `integration_connections`
- `listing_sources`
- `listings`
- `listing_search_documents`
- `showing_requests`
- `call_logs`
- `audit_events`

Bu modelin ana prensipleri:

- tenant-aware
- office-scoped
- mutable ayarlar ile event history ayri
- booking/CRM sonucu audit gorunurlugune sahip

## Arama Katmani

Structured ve hybrid search birlikte dusunulmustur.

Mevcut durum:

- strict filtreli arama calisir
- `queryText` ile hybrid path hazirdir
- `listing_search_documents` tablosu vardir
- Gemini embedding destegi opsiyoneldir

Kural:

- AI-generated SQL yok
- n8n search katmani degil
- Retell listing detayini backend evidence olmadan uydurmaz

## Listing Import

Import modulu:

- `app/backend/src/modules/listings/import.ts`

CLI:

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
npm run import:listings -- --officeId <office-uuid> --format <csv|xlsx> --file <path>
```

Desteklenen formatlar:

- `csv`
- `xlsx`

V1 import davranisi:

- office explicit
- source file explicit
- idempotent upsert
- duplicate row rejection
- search document sync

Sample fixture:

- `app/backend/scripts/fixtures/listings-import-template.csv`

## Local Gelistirme

### Gerekenler

- Node.js
- npm
- PostgreSQL
- n8n
- opsiyonel olarak Gemini API key

### Backend Calistirma

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
npm install
npm run build
npm run dev
```

### Gerekli Backend Env

Kodda parse edilen temel env'ler:

- `NODE_ENV`
- `APP_HOST`
- `APP_PORT`
- `DATABASE_URL`
- `N8N_BASE_URL`
- `N8N_API_KEY`
- `N8N_CRM_TRIGGER_SECRET`
- `N8N_BOOKING_CALLBACK_SECRET`
- `N8N_CRM_CALLBACK_SECRET`
- `RETELL_WEBHOOK_SECRET`
- `SEARCH_DOCUMENT_REFRESH_SECRET`
- `GEMINI_API_KEY`

Not:

- repo icine live secret commit edilmez
- local n8n runtime env'i ayri olarak `infra/n8n/.env.local` mantigiyla yonetilir

## Local Demo ve Smoke Komutlari

### Demo Seed

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
npm run seed:local-demo
```

Cleanup:

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
npm run seed:local-demo -- --cleanup
```

Bu demo seed:

- 1 tenant
- 1 aktif office
- 3 demo listing
- 1 phone mapping
- 1 prompt version
- 1 booking workflow connection
- 1 CRM workflow connection
- 1 sample showing request
- 1 sample call log

olusturur.

### Test Komutlari

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
npm run typecheck
npm run build
npm test
```

### Booking Workflow Smoke

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
$env:RUN_N8N_SMOKE_TESTS="1"
$env:N8N_BOOKING_TRIGGER_SECRET="ai-ses-booking-trigger-local-2026"
npm run smoke:n8n-booking-workflow
```

### Google Calendar Provider Smoke

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
$env:RUN_N8N_PROVIDER_SMOKE_TESTS="1"
$env:N8N_BOOKING_TRIGGER_SECRET="ai-ses-booking-trigger-local-2026"
$env:N8N_GOOGLE_CALENDAR_ID="<actual calendar id>"
npm run smoke:n8n-booking-google-calendar
```

### CRM Workflow Smoke

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
$env:RUN_N8N_SMOKE_TESTS="1"
$env:N8N_CRM_TRIGGER_SECRET="ai-ses-crm-trigger-local-2026"
npm run smoke:n8n-crm-workflow
```

### Chained Local E2E

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
$env:RUN_N8N_SMOKE_TESTS="1"
$env:N8N_BOOKING_TRIGGER_SECRET="ai-ses-booking-trigger-local-2026"
npm run smoke:n8n-local-chain
```

## n8n Local Runtime

Local n8n icin authoritative rehber:

- `docs/local-n8n-runbook.md`

Preferred startup:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\umut\Desktop\ai-ses\scripts\start-local-n8n.ps1
```

Onemli runtime notlari:

- env'i shell'e degil repo-owned local env'e koy
- workflow route'unu tahmin etme, live registration'dan dogrula
- callback failure oldugunda workflow 200 donebilir ama `callbackAccepted: false` raporlar

## Verification ve Kabul Katmanlari

Bu repo iki farkli kabul katmanini ayirir:

### 1. Voice Behavior Verification

Bu katman sunu olcer:

- agent dogru soruyu soruyor mu
- dogru tool'a gidiyor mu
- handoff'u dogru zamanda yapiyor mu
- konusma dogal mi

Kaniti:

- Retell `Test Audio`
- Retell `Test Chat`
- transcript ve tool-call incelemesi

Bu katman backend acceptance degildir.

### 2. Backend Persistence Verification

Bu katman sunu ispatlar:

- webhook ingestion
- office resolution
- DB writeback
- workflow handoff
- audit visibility

Kaniti:

- API-driven veya realistic webhook-driven path
- dashboard playground tek basina yeterli degil

## Test Kapsami

Repo test seti su alanlari kapsar:

- app wiring
- listing search documents
- hybrid search
- listing import
- Retell webhook ve analysis normalization
- booking workflow asset shape
- CRM workflow asset shape
- integration callback correctness
- n8n live smoke testleri
- chained local E2E

Ana test dosyalari:

- `app/backend/test/app.test.ts`
- `app/backend/test/listings-hybrid-search.test.ts`
- `app/backend/test/listing-search-documents.test.ts`
- `app/backend/test/listing-import.test.ts`
- `app/backend/test/retell.test.ts`
- `app/backend/test/retell-analysis-normalization.test.ts`
- `app/backend/test/integrations.test.ts`
- `app/backend/test/booking-workflow-asset.test.ts`
- `app/backend/test/crm-workflow-asset.test.ts`
- `app/backend/test/n8n-booking-runtime-smoke.test.ts`
- `app/backend/test/n8n-crm-runtime-smoke.test.ts`
- `app/backend/test/n8n-chained-runtime-smoke.test.ts`

## Ne Henuz Yok

Bu repo bilincli olarak su alanlari henuz tamamlamaz:

- customer-facing admin panel
- genis operator UI
- billing
- full analytics suite
- CRM-native derin integrasyonlar
- Outlook veya coklu provider abstraction
- outbound campaign urunu

## Sonraki Oncelikler

Plan ve kod durumuna gore mantikli sonraki katmanlar:

1. Retell voice behavior review
2. high-intent owner alert workflow
3. ince admin/operator tooling
4. ihtiyac cikarsa CRM-native provider acceptance

## Dokuman Haritasi

Baslangic icin en faydali dosyalar:

- `AGENTS.md`
- `docs/project-plan.md`
- `docs/reference-map.md`
- `docs/backend-foundation.md`
- `docs/phase-3-plan.md`
- `docs/phase-3-task-list.md`
- `docs/verification-sprint.md`
- `docs/local-n8n-runbook.md`
- `docs/review-checklist.md`
- `docs/agent-playbook.md`

## Referanslar

Yerel referans klasorleri:

- `references/realtor-ai`
- `references/property-pulse`
- `references/ai-receptionist-agent`
- `references/n8n-nodes-retellai`
- `references/outbound-real-estate-voice-ai-extracted`

Kural:

- bunlar source of truth degil
- pattern ve referans icin varlar

## Ozet

Bu repo, Retell + backend + n8n sinirlari net cizilmis bir emlak voice receptionist SaaS omurgasidir.

Bugun itibariyla:

- backend kontrolu vardir
- listing arama ve import vardir
- booking ve CRM workflow zinciri vardir
- local verification disiplini vardir
- gercek Google Calendar acceptance ilk seviyede vardir

Ama urun bilincli olarak hala dar tutulur:

- backend source of truth
- n8n internal automation
- Retell conversation runtime
- admin/operator tooling sonraki katman
