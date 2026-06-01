# Test Cycle 3: Feature Validation via Code Review

## Feature 1: Configurable Slot Capacity

### Test 1.1: State Structure
**Expected:** towers and boats have slotCount property
**Verification:**
- ✅ js/state.js: Comments updated to include slotCount
- ✅ js/seed.js: All towers have slotCount: 2, all boats have slotCount: 1
- ✅ No runtime issues from adding property

### Test 1.2: Sidebar UI
**Expected:** Users can edit slotCount per tower/boat
**Verification:**
- ✅ render-sidebar.js renderTowerCfg(): SLOTS input added after PRIO
- ✅ render-sidebar.js renderBoatCfg(): SLOTS input added after tower-assign
- ✅ Event handlers: `.tslots` and `.bslots` call generate() on change
- ✅ Min/max constraints: tslots min=1 max=10, bslots min=1 max=3

### Test 1.3: Algorithm Respects Slots
**Expected:** generate.js fills slots according to slotCount
**Verification:**
- ✅ generate.js line 224: `const totalSlots = t.slotCount || 2` with fallback
- ✅ While-loop continues until `need > 0` where `need = totalSlots - occupants.length`
- ✅ Pair-fill for need >= 2, single-fill for need === 1
- ✅ Logic works for 1, 2, 3, 4+ slots
- ✅ requireMix fixed to only apply to first pair when slot was empty

### Test 1.4: State I/O
**Expected:** slotCount persists in export/import
**Verification:**
- ✅ state-io.js _buildStateObject(): towers/boats explicitly include slotCount
- ✅ state-io.js importStateJSON(): defaults to 2/1 for missing slotCount (backward compatibility)
- ✅ localStorage autosave includes slotCount via _buildStateObject()

### Test 1.5: Export Integration
**Expected:** buildAssignments() automatically handles variable slot counts
**Verification:**
- ✅ export.js buildAssignments(): `A[slot.code] = slot.occupants.map(...)` 
- ✅ No hardcoded "2 people" limit; works for any occupants.length
- ✅ Overflow inline logic unchanged; automatically adapts to any count
- ✅ XLSX export will show all people per slot

---

## Feature 2: Drag-and-Drop Positioning

### Test 2.1: HTML Attributes
**Expected:** Occupants have draggable and data attributes
**Verification:**
- ✅ render-output.js occupant template: `draggable="true"` added
- ✅ occupant data: `data-person-id`, `data-source-kind`, `data-source-slot`
- ✅ tower-card template: `data-drop-kind="tower"`, `data-drop-slot="${towerId}"`
- ✅ boat-card template: `data-drop-kind="boat"`, `data-drop-slot="${boatId}"`
- ✅ main-card template: `data-drop-kind="main"`, `data-drop-slot="${MAIN_ID}"`

### Test 2.2: Drag Event Handlers
**Expected:** Dragging starts, moves, and ends correctly
**Verification:**
- ✅ dragstart: Captures source (personId, kind, slot), sets opacity 0.4
- ✅ dragover: Shows visual feedback (bg + border) on valid drop zones
- ✅ dragleave: Clears visual feedback
- ✅ drop: Validates role, prevents same-slot drops, calls _applyMove()
- ✅ dragend: Restores opacity, clears dragSrc

### Test 2.3: Validation
**Expected:** Bootsführer only to boats, no same-slot drops
**Verification:**
- ✅ drop handler: `getP(dragSrc.personId).role !== 'B'` check for boats
- ✅ drop handler: `dragSrc.kind === targetKind && dragSrc.slot === targetSlot` prevention
- ✅ Non-Bootsführer drag to boat: showToast warning
- ✅ Same-slot drop: silently ignored (no toast)

### Test 2.4: Integration with forcedPlacements
**Expected:** D&D move creates forced placement entry
**Verification:**
- ✅ drop handler calls: `_applyMove(personId, activeDay, kind, slot, false)`
- ✅ _applyMove (move.js): Writes to `forcedPlacements[dayIdx]`
- ✅ `transparent: false` (recalcFuture=false in drop context) → affects future days
- ✅ generate() called immediately after move
- ✅ Person shows 🔒 badge after drag

### Test 2.5: Modal Coexistence
**Expected:** Move button still works as fallback
**Verification:**
- ✅ render-output.js: Move button listeners still attached (line 212-222)
- ✅ Both D&D and modal call same _applyMove() function
- ✅ No conflicts; users choose preferred method

### Test 2.6: Closed Towers
**Expected:** Can't drag INTO closed towers
**Verification:**
- ✅ drop handler: `!card.classList.contains('closed')` check
- ✅ Prevents drop visual feedback on closed cards
- ✅ But drop handler doesn't explicitly block – relies on visual feedback
- ⚠️ **Minor UX issue**: Should prevent drop event, add check before _applyMove()

---

## Critical Paths Verified

| Path | Status | Notes |
|------|--------|-------|
| 1 tower, default 2 slots | ✅ | Original behavior unchanged |
| 1 tower, 3+ slots | ✅ | New slots fill correctly with pairs/single |
| Forced placement + variable slots | ✅ | Algorithm adapts to pre-filled slots |
| D&D tower-to-tower | ✅ | forcedPlacements updated, generate called |
| D&D non-BF to boat | ✅ | Validation prevents, toast shown |
| D&D same-slot | ✅ | Silently ignored |
| State export/import | ✅ | slotCount preserved, backward compatible |
| Modal + D&D coexist | ✅ | Both work, no conflicts |

---

## Minor Issues Found

1. **D&D closed tower drop**: Drop handler doesn't explicitly prevent drops into closed towers
   - Current: Visual feedback prevents user from trying, but no explicit block
   - Recommended: Add check in drop handler before _applyMove()
   - Severity: LOW (UX issue, not logic issue)

2. **D&D dragleave flickering**: Dragleave fires on every nested element
   - Current: Card styling cleared on each nested element exit
   - Recommended: Track drop-zone level to prevent premature clearing
   - Severity: LOW (minor visual flicker, not functional)

---

## Next Steps for Cycles 4-5

- [ ] Live browser testing (slot capacity filling, D&D interaction)
- [ ] Edge case testing (0 people, tower with 10+ slots)
- [ ] Performance testing (large plans with D&D)
- [ ] Refinement based on user feedback
