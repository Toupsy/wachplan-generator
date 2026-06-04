# Preview Workflow für Pull Requests

## Quick Start

### 1️⃣ Einmalige Einrichtung

```bash
# Cloudflare mit Wrangler verbinden
npx wrangler login

# Secrets in GitHub hinzufügen (siehe GITHUB_SETUP.md)
```

### 2️⃣ Feature entwickeln

```bash
# Neuer Branch für dein Feature
git checkout -b feature/mein-feature

# Änderungen machen...
git add .
git commit -m "feat: mein feature"
git push origin feature/mein-feature
```

### 3️⃣ Pull Request erstellen

Auf GitHub:
- **Neue PR erstellen** gegen `main`
- 🤖 GitHub Action startet automatisch
- 💬 Bot postet Preview URL im PR-Comment

### 4️⃣ Testen & Reviewen

```
Preview-URL: https://pr-123.wachplan-generator-preview.workers.dev
```

- 🧪 Alle deine Änderungen live testen
- 📋 Feedback geben / änderungen machen
- ✅ Bei OK: "Approve"

### 5️⃣ Merge

Klick auf "Merge pull request" → Production Deploy

---

## Vergleich: Local vs Preview vs Production

| Aspekt | Local | Preview | Production |
|--------|-------|---------|------------|
| **URL** | `localhost:3000` | `pr-NNN.wachplan-generator-preview.workers.dev` | `wachplan-generator.de` |
| **Wann?** | While developing | After PR creation | After merge to main |
| **Automatisch?** | ❌ Manual (`npm run dev`) | ✅ Ja (GitHub Action) | ✅ Ja (GitHub Action) |
| **Wer sieht es?** | Nur du | Collaborators (PR) | Alle |
| **Kosten** | ❌ None | ✅ Free Tier | ✅ Free Tier |

---

## Beispiel-PR-Flow

```
┌─────────────────────────────────────────┐
│ 1. Feature Branch erstellen             │
│    git checkout -b feature/boot-dnd     │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│ 2. Code ändern + Commit                 │
│    git push origin feature/boot-dnd     │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│ 3. GitHub PR erstellen                  │
│    base: main ← compare: feature/boot-dnd
└─────────────────────────────────────────┘
                    ↓
         🚀 GitHub Action startet
                    ↓
┌─────────────────────────────────────────┐
│ 4. Deploy zu Cloudflare Workers Preview │
│    URL: pr-123.wachplan...workers.dev   │
│    💬 Bot postet Comment mit URL         │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│ 5. Testen & Feedback                    │
│    - Click Preview Link                 │
│    - Test changes live                  │
│    - Comment feedback / approve         │
└─────────────────────────────────────────┘
                    ↓
        Weitere commits? → Zurück zu Schritt 2
        Alles OK? → Nächster Schritt
                    ↓
┌─────────────────────────────────────────┐
│ 6. Merge PR                             │
│    Click "Merge pull request"           │
└─────────────────────────────────────────┘
                    ↓
         🚀 GitHub Action startet
                    ↓
┌─────────────────────────────────────────┐
│ 7. Deploy zu Production                 │
│    URL: wachplan-generator.de           │
│    🧹 Preview-Env wird gelöscht         │
└─────────────────────────────────────────┘
```

---

## Häufige Fragen

### F: Kann ich die Preview-URL sharen?
**A:** Ja! Preview ist öffentlich. URL ist eindeutig (`pr-NNN` = PR-Nummer).

### F: Was ist mit meinen Änderungen, wenn ich den Code pushe?
**A:** Preview aktualisiert automatisch bei jedem Push (ähnlich wie `git push`).

### F: Wie lange läuft eine Preview?
**A:** Solange der PR offen ist. Nach Merge/Close → gelöscht.

### F: Kann ich lokal mit `npm run dev` und Preview gleichzeitig arbeiten?
**A:** Ja! Sie nutzen unterschiedliche Ports/Subdomains → kein Konflikt.

### F: Kosten für Preview-Deployments?
**A:** Kostenlos (unter Free Tier). Nur Requests gegen dein Limit.

---

## Performance-Tipps

1. **Große Änderungen?** → Mehrere kleinere PRs statt eine große
2. **Viel Testing?** → Preview ist schneller als lokal (Cloudflare CDN)
3. **API-Issues?** → Check `ORIGIN_SERVER` in `src/worker.js`

---

**Nächste Schritte:**
- Siehe [GITHUB_SETUP.md](GITHUB_SETUP.md) für Secrets-Konfiguration
- Siehe [CLOUDFLARE_WORKER.md](CLOUDFLARE_WORKER.md) für Worker-Details
