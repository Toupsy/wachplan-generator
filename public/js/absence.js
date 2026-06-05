// ============================================================
// absence.js – Mehrtagige Abwesenheit / Urlaub Management
// ============================================================

function openAbsenceModal(personId) {
  const person = getP(personId);
  if (!person) return;

  const modal = document.getElementById('absence-modal');
  if (!modal) return;

  modal.querySelector('#absence-modal-title').textContent = `Abwesenheit: ${escapeHtml(person.name)}`;

  // Count how many days this person is currently marked sick
  let absenceDays = [];
  dayState.forEach((d, idx) => {
    if (d.sick.has(personId)) {
      absenceDays.push(idx);
    }
  });

  // Populate day selects
  const fromSelect = document.getElementById('absence-from-day');
  const toSelect = document.getElementById('absence-to-day');
  fromSelect.innerHTML = '';
  toSelect.innerHTML = '';

  for (let d = 0; d < DAYS; d++) {
    const label = dayLabel(d);
    const fromOpt = document.createElement('option');
    fromOpt.value = d;
    fromOpt.textContent = label;
    fromSelect.appendChild(fromOpt);

    const toOpt = document.createElement('option');
    toOpt.value = d;
    toOpt.textContent = label;
    toSelect.appendChild(toOpt);
  }

  // Reset UI
  const clearBtn = document.getElementById('absence-clear-btn');

  // Set default values: if any sick days, select range from first to last
  // Otherwise default to 0 to min(3, DAYS-1)
  if (absenceDays.length > 0) {
    fromSelect.value = Math.min(...absenceDays);
    toSelect.value = Math.max(...absenceDays);
  } else {
    fromSelect.value = 0;
    toSelect.value = Math.min(3, DAYS - 1);
  }

  // Show/hide clear button based on whether person has any sick days
  clearBtn.style.display = absenceDays.length > 0 ? 'block' : 'none';

  // Show modal
  modal.style.display = 'flex';

  // Bind close handlers
  const closeBtn = modal.querySelector('#absence-modal-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => modal.style.display = 'none';
  }

  // Bind set button
  const setBtn = document.getElementById('absence-set-btn');
  if (setBtn) {
    setBtn.onclick = () => {
      const fromDay = +fromSelect.value;
      const toDay = +toSelect.value;

      if (fromDay > toDay) {
        showToast('⚠️ Von-Tag muss vor oder gleich Bis-Tag sein');
        return;
      }

      setAbsence(personId, fromDay, toDay, true);
      modal.style.display = 'none';
      showToast(`✅ ${escapeHtml(person.name)}: Abwesenheit Tage ${fromDay + 1}–${toDay + 1} gesetzt`);
    };
  }

  // Bind clear button
  if (clearBtn) {
    clearBtn.onclick = () => {
      clearAbsence(personId);
      modal.style.display = 'none';
      showToast(`✅ ${escapeHtml(person.name)}: Alle Abwesenheiten gelöscht`);
    };
  }
}

function setAbsence(personId, fromDay, toDay, isAbsent) {
  for (let d = fromDay; d <= toDay; d++) {
    if (isAbsent) {
      dayState[d].sick.add(personId);
    } else {
      dayState[d].sick.delete(personId);
    }
  }
  generate();
  scheduleAutoSave();
}

function clearAbsence(personId) {
  dayState.forEach(d => d.sick.delete(personId));
  generate();
  scheduleAutoSave();
}

// Close modal on overlay click
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('absence-modal');
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });
  }
});
