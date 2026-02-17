// ── Offline Mode: IndexedDB + Sync ──
const OFFLINE_DB_NAME = 'iftar-offline';
const OFFLINE_DB_VERSION = 1;

let offlineDb = null;

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    if (offlineDb) return resolve(offlineDb);
    const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('guests')) {
        db.createObjectStore('guests', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('pendingCheckins')) {
        db.createObjectStore('pendingCheckins', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => {
      offlineDb = e.target.result;
      resolve(offlineDb);
    };
    req.onerror = () => reject(req.error);
  });
}

// Cache guest list to IndexedDB
async function cacheGuestList() {
  try {
    const res = await fetch('/api/guests');
    if (!res.ok) return;
    const guests = await res.json();
    const db = await openOfflineDB();
    const tx = db.transaction('guests', 'readwrite');
    const store = tx.objectStore('guests');
    store.clear();
    guests.forEach(g => store.put(g));
  } catch (e) {
    // Network error — skip caching
  }
}

// Get cached guests from IndexedDB
async function getCachedGuests() {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('guests', 'readonly');
    const store = tx.objectStore('guests');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Queue an offline check-in
async function queueOfflineCheckin(guestId) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingCheckins', 'readwrite');
    const store = tx.objectStore('pendingCheckins');
    store.add({ guestId, timestamp: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Get all pending offline check-ins
async function getPendingCheckins() {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingCheckins', 'readonly');
    const store = tx.objectStore('pendingCheckins');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Clear pending check-ins after sync
async function clearPendingCheckins() {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingCheckins', 'readwrite');
    tx.objectStore('pendingCheckins').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Sync queued check-ins to server
async function syncOfflineCheckins() {
  const pending = await getPendingCheckins();
  if (pending.length === 0) return;

  try {
    const res = await fetch('/api/sync-checkins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkins: pending.map(p => ({ guestId: p.guestId, timestamp: p.timestamp })) }),
    });
    if (res.ok) {
      await clearPendingCheckins();
      updateOfflineIndicator(false);
      // Refresh dashboard data
      if (typeof refreshStats === 'function') refreshStats();
      if (typeof refreshGuests === 'function') refreshGuests();
    }
  } catch (e) {
    // Still offline — will retry
  }
}

// Offline indicator UI
function updateOfflineIndicator(isOffline) {
  let indicator = document.getElementById('offline-indicator');
  if (isOffline) {
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'offline-indicator';
      indicator.className = 'offline-indicator';
      indicator.textContent = 'Offline Mode — check-ins will sync when reconnected';
      document.body.prepend(indicator);
    }
    indicator.style.display = 'block';
  } else {
    if (indicator) indicator.style.display = 'none';
  }
}

// Wrap manualCheckin for offline support
const _originalManualCheckin = typeof manualCheckin === 'function' ? manualCheckin : null;

async function offlineAwareCheckin(id) {
  if (navigator.onLine) {
    if (_originalManualCheckin) {
      return _originalManualCheckin(id);
    }
    // Fallback: call API directly
    try {
      const res = await fetch(`/api/checkin/${id}`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'already') alert('Already checked in!');
      if (typeof refreshStats === 'function') refreshStats();
      if (typeof refreshGuests === 'function') refreshGuests();
    } catch (e) {}
  } else {
    // Offline: queue and mark locally
    await queueOfflineCheckin(id);
    updateOfflineIndicator(true);
    // Update local cache to show as checked in
    try {
      const db = await openOfflineDB();
      const tx = db.transaction('guests', 'readwrite');
      const store = tx.objectStore('guests');
      const req = store.get(id);
      req.onsuccess = () => {
        const guest = req.result;
        if (guest) {
          guest.checked_in = true;
          guest.checked_in_at = new Date().toISOString();
          store.put(guest);
        }
      };
    } catch (e) {}
    if (typeof refreshGuests === 'function') refreshGuests();
  }
}

// Replace global manualCheckin if it exists
if (typeof window !== 'undefined') {
  window.manualCheckin = offlineAwareCheckin;
}

// Monitor online/offline status
window.addEventListener('online', () => {
  updateOfflineIndicator(false);
  syncOfflineCheckins();
});

window.addEventListener('offline', () => {
  updateOfflineIndicator(true);
});

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Initial setup
openOfflineDB();

// Cache guest list periodically (every 60 seconds)
cacheGuestList();
setInterval(cacheGuestList, 60000);

// Check for pending syncs on load
if (navigator.onLine) {
  syncOfflineCheckins();
}
