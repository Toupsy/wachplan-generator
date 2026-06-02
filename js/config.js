// ============================================================
// config.js – Externe Konfiguration laden
// ============================================================

let appConfig = null;

// Lade Konfiguration vom Server
async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) {
      console.error('Failed to load config:', response.statusText);
      return false;
    }
    appConfig = await response.json();
    console.log('✓ Configuration loaded from server');
    return true;
  } catch (error) {
    console.error('Config load error:', error);
    return false;
  }
}

// Initialisiere Anwendung mit Konfiguration
async function seedFromConfig() {
  if (!appConfig || !appConfig.template) {
    console.error('No config available');
    return;
  }

  const config = appConfig.template;

  // Keine Wachgänger
  people = [];
  uid = 0;

  // Erstelle Türme mit IDs
  const towerMap = {};
  (config.towers || []).forEach(towerCfg => {
    const tower = {
      id: ++uid,
      name: towerCfg.name,
      prio: towerCfg.prio,
      code: '',
      slotCount: towerCfg.slotCount || 2
    };
    towerMap[towerCfg.name] = tower;
    towers.push(tower);
  });

  // Erstelle Boote mit korrekten Tower-IDs
  (config.boats || []).forEach(boatCfg => {
    const tower = towerMap[boatCfg.towerName];
    if (!tower) {
      console.warn(`Tower "${boatCfg.towerName}" not found for boat "${boatCfg.name}"`);
      return;
    }
    boats.push({
      id: ++uid,
      name: boatCfg.name,
      code: '',
      towerId: tower.id,
      prio: boatCfg.prio,
      slotCount: boatCfg.slotCount || 1
    });
  });

  // Setze Export-Spalten
  exportColumns = [...(config.exportColumns || [])];

  // Setze Positionsbeschriftungen
  if (appConfig.positions) {
    positionDescriptions = { ...appConfig.positions };
  }

  // Initialisiere State
  dayState = freshDayState();
  autoCodes();

  console.log(`✓ Seed from config: ${towers.length} towers, ${boats.length} boats`);
}
