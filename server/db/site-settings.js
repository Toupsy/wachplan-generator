// ============================================================
// Seiten-Einstellungen (Impressum & Datenschutz-Betreiberangaben)
// ============================================================
//
// Schlichtes Key/Value-Store über die Tabelle `site_settings`. Die hier definierten
// FIELDS sind die einzige „Whitelist": nur diese Schlüssel werden gelesen/geschrieben
// (kein freies Setzen beliebiger Keys über die API). getSiteSettings() liefert immer
// ALLE Felder (fehlende = '') zurück, damit Frontend/Templates nie auf undefined treffen.
//
// Die Werte sind die öffentlich anzugebenden Betreiber-/Kontaktdaten (Impressumspflicht
// nach § 5 DDG, Verantwortlicher nach Art. 13 DSGVO) – also bewusst nicht-geheim.

const { dbAll, dbRun, dbGet } = require('./connection');

// Reihenfolge = Anzeige-Reihenfolge im Admin-Panel.
const FIELDS = [
  { key: 'org_name',            label: 'Name der Organisation / DLRG-Gliederung', placeholder: 'z. B. DLRG Ortsgruppe Musterstadt e. V.' },
  { key: 'represented_by',      label: 'Vertreten durch (Vorstand / Vorsitz)',    placeholder: 'z. B. Erika Mustermann (1. Vorsitzende)' },
  { key: 'org_street',          label: 'Straße und Hausnummer',                   placeholder: 'z. B. Seestraße 1' },
  { key: 'org_zip',             label: 'PLZ',                                     placeholder: 'z. B. 12345' },
  { key: 'org_city',            label: 'Ort',                                     placeholder: 'z. B. Musterstadt' },
  { key: 'org_country',         label: 'Land',                                    placeholder: 'Deutschland' },
  { key: 'contact_email',       label: 'Kontakt-E-Mail',                          placeholder: 'z. B. info@dlrg-musterstadt.de' },
  { key: 'contact_phone',       label: 'Telefon (optional)',                      placeholder: 'z. B. +49 123 456789' },
  { key: 'register_court',      label: 'Registergericht (optional)',              placeholder: 'z. B. Amtsgericht Musterstadt' },
  { key: 'register_number',     label: 'Registernummer (optional)',               placeholder: 'z. B. VR 1234' },
  { key: 'vat_id',              label: 'USt-IdNr. (optional)',                    placeholder: 'z. B. DE123456789' },
  { key: 'content_responsible', label: 'Inhaltlich verantwortlich nach § 18 Abs. 2 MStV (optional)', placeholder: 'Name + Anschrift, falls abweichend' },
  { key: 'dpo_name',            label: 'Datenschutzbeauftragte:r (optional)',     placeholder: 'Name, falls bestellt' },
  { key: 'dpo_contact',         label: 'Kontakt Datenschutzbeauftragte:r (optional)', placeholder: 'E-Mail / Telefon' },
  { key: 'supervisory_authority', label: 'Zuständige Datenschutz-Aufsichtsbehörde (optional)', placeholder: 'z. B. Der Landesbeauftragte für Datenschutz …' }
];

const FIELD_KEYS = FIELDS.map(f => f.key);
const MAX_VALUE_LENGTH = 1000;   // pro Feld; großzügig, aber kein unbegrenztes Speichern

// Default-Werte für vorbelegte Felder (überschreibbar im Admin-Panel).
const DEFAULTS = {
  org_country: 'Deutschland'
};

// Liefert ein vollständiges { key → value }-Objekt (alle FIELDS, fehlende als '' bzw. Default).
async function getSiteSettings() {
  const rows = await dbAll('SELECT key, value FROM site_settings');
  const stored = {};
  for (const r of rows) stored[r.key] = r.value;

  const result = {};
  for (const key of FIELD_KEYS) {
    result[key] = (stored[key] !== undefined && stored[key] !== '')
      ? stored[key]
      : (DEFAULTS[key] || '');
  }
  return result;
}

// Speichert nur bekannte Felder. Unbekannte Keys werden ignoriert. Werte werden
// getrimmt und gekappt. Gibt das aktualisierte vollständige Settings-Objekt zurück.
async function saveSiteSettings(updates) {
  if (!updates || typeof updates !== 'object') {
    throw new Error('Invalid settings payload');
  }
  for (const key of FIELD_KEYS) {
    if (!(key in updates)) continue;
    let value = updates[key];
    if (value === null || value === undefined) value = '';
    value = String(value).trim().slice(0, MAX_VALUE_LENGTH);
    await dbRun(
      `INSERT INTO site_settings (key, value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [key, value]
    );
  }
  return getSiteSettings();
}

// true, sobald mindestens die Pflicht-Kernangaben (Name + Ort + Kontakt) hinterlegt sind.
// Dient den Templates zur Entscheidung „echte Angaben anzeigen vs. Platzhaltertext".
async function hasOperatorInfo() {
  const s = await getSiteSettings();
  return Boolean(s.org_name && s.contact_email);
}

module.exports = { FIELDS, FIELD_KEYS, getSiteSettings, saveSiteSettings, hasOperatorInfo, dbGet };
