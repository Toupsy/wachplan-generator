# GitHub Setup für automatische Preview-Deployments

## Übersicht

Mit dieser Konfiguration wird automatisch für jeden Pull Request eine Preview URL erstellt, die du testen kannst, bevor du mergst.

**Workflow:**
```
PR erstellen
    ↓
GitHub Action startet automatisch
    ↓
Deploy zu Cloudflare Workers (pr-#123.wachplan-generator-preview.workers.dev)
    ↓
PR-Comment mit Preview-URL
    ↓
Du testest deine Changes
    ↓
Merge nach main → Production-Deploy
```

## Setup-Schritte

### 1. GitHub Secrets erstellen

Gehe zu: **Settings → Secrets and variables → Actions**

Erstelle diese Secrets:

#### `CLOUDFLARE_API_TOKEN`
1. Gehe zu https://dash.cloudflare.com/profile/api-tokens
2. Klicke "Create Token"
3. Wähle **"Edit Cloudflare Workers"** Template
4. Berechtigungen:
   - ✅ Account Cloudflare Workers Routes (Read)
   - ✅ Account Workers KV Storage (Edit)
   - ✅ Account Workers Tail (Read)
5. **Account Resources:** Wähle dein Account aus
6. Kopiere den Token in GitHub Secret `CLOUDFLARE_API_TOKEN`

#### `CLOUDFLARE_ACCOUNT_ID`
Finde deine Account ID auf https://dash.cloudflare.com:
- **Home** → Rechts unten "Account ID" kopieren
- Füge sie in GitHub Secret `CLOUDFLARE_ACCOUNT_ID` ein

### 2. Wrangler.toml konfigurieren

Öffne `wrangler.toml` und trage deine IDs ein:

```toml
account_id = "YOUR_ACCOUNT_ID_HERE"

[env.preview]
# Diese Subdomain wird für PRs verwendet
routes = [
  { pattern = "*.wachplan-generator-preview.workers.dev/*", zone_name = "" }
]
```

### 3. Test

Erstelle einen Test-PR:
```bash
git checkout -b test/preview-workflow
echo "# Test" >> README.md
git add README.md
git commit -m "test: check preview workflow"
git push origin test/preview-workflow
```

Dann auf GitHub PR erstellen. Du solltest sehen:
- ✅ GitHub Action startet automatisch
- ✅ PR-Comment mit Preview URL wird gepostet
- ✅ Preview ist live unter `https://pr-NNN.wachplan-generator-preview.workers.dev`

## Workflow

### Pull Request erstellen
```bash
git checkout -b feature/mein-feature
# ... Änderungen machen ...
git push origin feature/mein-feature
# → PR auf GitHub erstellen
```

**Automatisch:**
- 🚀 Deploy zu Cloudflare Workers
- 💬 PR-Comment mit Preview URL
- ✅ Bereit zum Testen!

### Testen
1. Klicke auf Preview URL im PR-Comment
2. Teste deine Änderungen
3. Falls OK → "Approve" oder kommentiere Feedback

### Nach dem Merge
```bash
# Auf GitHub: "Merge pull request"
```

**Automatisch:**
- 🚀 Deploy zu Production
- 🧹 Preview-Environment wird bereinigt

## Troubleshooting

### ❌ "API Token validation failed"
- ✅ Token korrekt in `CLOUDFLARE_API_TOKEN` Secret?
- ✅ Token noch gültig (nicht abgelaufen)?
- ✅ Richtiger Account ID in `CLOUDFLARE_ACCOUNT_ID`?

### ❌ "Could not detect static files"
- ✅ `public/` Verzeichnis vorhanden?
- ✅ `[assets]` Section in `wrangler.toml` richtig?

### ❌ PR-Comment erscheint nicht
- ✅ GitHub Action erfolgreich abgelaufen (grünes ✅)?
- ✅ GitHub Action hat Permission für PR-Comments?

### 📋 Logs anschauen
Gehe zu: **Pull Request → Checks → Deploy Preview → Logs**

## Kosten

- **Preview-Deployments:** Kostenlos (unter Cloudflare Free Tier)
- **Requests:** Zählen gegen deine 100k/Tag Free Tier

Weitere Details: [Cloudflare Workers Pricing](https://workers.cloudflare.com/pricing)

## Limits

- **Worker-Namen-Länge:** Max 63 Zeichen (daher `pr-123` statt `pull-request-123`)
- **Subdomains:** Up to 3 Levels (`pr-123.wachplan-generator-preview.workers.dev`)

---

**Weitere Ressourcen:**
- [GitHub Secrets](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)
- [Cloudflare API Tokens](https://developers.cloudflare.com/api/tokens/create)
- [Wrangler Environments](https://developers.cloudflare.com/workers/wrangler/environments/)
