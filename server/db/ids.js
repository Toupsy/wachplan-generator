// ============================================================
// ids.js – Gemeinsames, sicheres Parsing von numerischen Route-IDs
// ============================================================
// Akzeptiert ausschließlich positive Ganzzahlen. Eingaben wie
// '5abc' (parseInt → 5) oder '' / undefined (→ NaN) ergeben null,
// damit keine ungültigen/teilgeparsten Werte in DB-Queries fließen.

/** @returns {number|null} positive Ganzzahl oder null bei ungültiger Eingabe */
function parsePositiveInt(paramStr) {
  const id = parseInt(paramStr, 10);
  return Number.isInteger(id) && id > 0 && String(id) === String(paramStr).trim()
    ? id
    : null;
}

module.exports = { parsePositiveInt };
