// ============================================================
// config.js – Externe Konfiguration laden mit Fallback
// ============================================================

let appConfig = null;

// Default-Konfiguration für Preview-Umgebung / Offline
const DEFAULT_PREVIEW_CONFIG = {
  template: {
    towers: [
      { name: "9/12", prio: 1, slotCount: 2 },
      { name: "9/13", prio: 2, slotCount: 2 },
      { name: "9/14", prio: 3, slotCount: 2 },
      { name: "9/15", prio: 4, slotCount: 2 },
      { name: "9/16", prio: 5, slotCount: 2 },
      { name: "9/17", prio: 6, slotCount: 2 },
      { name: "9/18", prio: 7, slotCount: 2 }
    ],
    boats: [
      { name: "Boot 78/1", towerName: "9/12", code: "78/1", prio: 1, slotCount: 1 },
      { name: "Boot 78/2", towerName: "9/14", code: "78/2", prio: 2, slotCount: 1 },
      { name: "Boot 78/3", towerName: "9/17", code: "78/3", prio: 3, slotCount: 1 }
    ],
    exportColumns: [
      "78/1", "9/12", "9/13", "", "WF", "HW", "",
      "78/2", "9/14", "9/15", "9/16", "78/3", "9/17", "9/18"
    ]
  },
  positions: {
    "3": "Wachführer",
    "4": "Bootsführer",
    "5": "Sanitäter",
    "6": "Beobachter",
    "7": "Verwalter"
  },
  ui: {
    maxPeople: 28,
    maxDays: 14,
    maxTowerSlots: 10,
    maxBoatSlots: 3
  }
};

// Erkenne Preview-Umgebung
function isPreviewEnvironment() {
  const environment = window.WORKER_ENVIRONMENT || 'production';
  return environment === 'preview';
}

// Lade Konfiguration vom Server mit Fallback-Kette
async function loadConfig() {
  // Schritt 1: Versuche vom Server zu laden
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      appConfig = await response.json();
      console.log('✓ Configuration loaded from server');
      return true;
    }
  } catch (error) {
    // Fehler beim Fetch (z.B. Netzwerk) – weitermachen zu Fallback
  }

  // Schritt 2: Nutze Preview-Fallback wenn in Preview-Umgebung
  if (isPreviewEnvironment()) {
    appConfig = DEFAULT_PREVIEW_CONFIG;
    console.warn('⚠️ Config API unavailable, using preview fallback');
    console.log('ℹ️ Running in preview mode');
    return true;
  }

  // Schritt 3: Fallback für Production – Fehler anzeigen
  console.error('⚠️ Failed to load config and not in preview mode');
  appConfig = DEFAULT_PREVIEW_CONFIG;  // Nutze auch in Production Defaults als letzten Ausweg
  return false;
}

// Initialisiere Anwendung mit Konfiguration
function seedFromConfig() {
  if (!appConfig || !appConfig.template) {
    console.warn('⚠️ No appConfig available, seedFromConfig cannot proceed');
    console.warn('appConfig:', appConfig);
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
      code: towerCfg.name,  // Code = Name (z.B. "9/12")
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
      code: boatCfg.code || '',
      towerId: tower.id,
      prio: boatCfg.prio,
      slotCount: boatCfg.slotCount || 1
    });
  });

  // Setze Export-Spalten (aus config.template.exportColumns)
  exportColumns = [...(appConfig.template?.exportColumns || [])];

  // Setze Positionsbeschriftungen
  if (appConfig.positions) {
    positionDescriptions = { ...appConfig.positions };
  }

  // Initialisiere State
  dayState = freshDayState();
  autoCodes();

  console.log(`✓ Seed from config: ${towers.length} towers, ${boats.length} boats`);
}
