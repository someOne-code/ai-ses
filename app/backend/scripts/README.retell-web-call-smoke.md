# Retell Web Call Smoke

Bu local helper, Retell dashboard testine guvenmeden gercek bir web call baslatmak icin vardir.

Amac:

- `metadata.office_id` ve `retell_llm_dynamic_variables.office_id` ile call yaratmak
- webhook backend'e dusunce `officeResolved=true` kanitlamak

Calistirma:

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
npm run smoke:retell-web-call -- --agentId agent_ca01968818f99b7639f1deda06
```

Ardindan:

- `http://127.0.0.1:8787` adresini ac
- `Start Call` de
- mikrofon izni ver
- kisa bir test konusmasi yap

Sonra backend tarafinda su kayitlar kontrol edilir:

- `audit_events`
- `call_logs`

Varsayilan `officeId`:

- `22222222-2222-4222-8222-222222222222`

Gerekirse override:

```powershell
npm run smoke:retell-web-call -- --agentId agent_xxx --officeId 22222222-2222-4222-8222-222222222222 --port 8787
```
