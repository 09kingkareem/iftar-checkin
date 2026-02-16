// ── WebSocket Connection ──
const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${protocol}//${location.host}`);

ws.onmessage = function(event) {
  const data = JSON.parse(event.data);
  if (data.type === 'checkin') {
    refreshStats();
    refreshGuests();
    addActivityItem(data);
  } else if (data.type === 'duplicate_scan') {
    addDuplicateAlert(data);
  }
};

ws.onclose = function() {
  setTimeout(() => location.reload(), 5000);
};

// ── Stats ──
async function refreshStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();
    document.getElementById('stat-total').textContent = stats.total;
    document.getElementById('stat-checked').textContent = stats.checkedIn;
    document.getElementById('stat-pending').textContent = stats.total - stats.checkedIn;
    const pct = stats.total > 0 ? Math.round((stats.checkedIn / stats.total) * 100) : 0;
    document.getElementById('stat-percent').textContent = pct + '%';
    document.getElementById('progress-fill').style.width = pct + '%';
  } catch (e) {}
}

// ── Guest List ──
let searchTimer;
const searchBox = document.getElementById('search');
if (searchBox) {
  searchBox.addEventListener('input', function() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => refreshGuests(this.value), 300);
  });
}

async function refreshGuests(search = '') {
  try {
    const q = search || (searchBox ? searchBox.value : '');
    const res = await fetch('/api/guests' + (q ? `?search=${encodeURIComponent(q)}` : ''));
    const guests = await res.json();
    const tbody = document.getElementById('guest-list');
    if (!tbody) return;

    tbody.innerHTML = guests.length === 0
      ? '<tr><td colspan="7" class="text-center muted" style="padding:20px">No guests found</td></tr>'
      : guests.map(g => `
        <tr>
          <td>
            ${esc(g.name)}
            ${g.category === 'family' && g.family_size > 1 ? `<br><span class="muted" style="font-size:0.75rem">${g.family_size} members</span>` : ''}
            ${g.phone ? `<br><span class="muted" style="font-size:0.75rem">${esc(g.phone)}</span>` : ''}
            ${g.email ? `<br><span class="muted" style="font-size:0.75rem">${esc(g.email)}</span>` : ''}
          </td>
          <td><span class="badge cat-${g.category || 'guest'}">${g.category || 'guest'}</span></td>
          <td>${esc(g.table_number || '-')}</td>
          <td>${esc(g.dietary_restrictions || '-')}</td>
          <td><span class="badge ${g.checked_in ? 'badge-checked' : 'badge-pending'}">${g.checked_in ? 'Checked In' : 'Pending'}</span></td>
          <td>${g.checked_in_at ? new Date(g.checked_in_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : '-'}</td>
          <td class="actions-cell">
            ${!g.checked_in ? `<button class="btn btn-sm btn-primary" onclick="manualCheckin(${g.id})">Check In</button>` : ''}
            <button class="btn btn-sm btn-secondary" onclick="openEditModal(${g.id})">Edit</button>
            <a href="/admin/ticket/${g.id}" class="btn btn-sm btn-secondary" target="_blank">Ticket</a>
          </td>
        </tr>
      `).join('');
  } catch (e) {}
}

async function manualCheckin(id) {
  try {
    const res = await fetch(`/api/checkin/${id}`, { method: 'POST' });
    const data = await res.json();
    if (data.status === 'already') {
      alert('Already checked in!');
    }
    refreshStats();
    refreshGuests();
  } catch (e) {}
}

// ── Activity Feed ──
const feed = document.getElementById('activity-feed');

function addActivityItem(data) {
  if (!feed) return;
  const first = feed.querySelector('.muted');
  if (first) first.remove();

  const item = document.createElement('div');
  item.className = 'activity-item';
  const time = new Date(data.timestamp).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  const by = data.user ? ` by ${esc(data.user.display_name)}` : ' via QR scan';
  item.innerHTML = `<span class="activity-time">${time}</span> <span class="activity-action">${esc(data.guest.name)} checked in${by}</span>`;
  feed.prepend(item);

  // Keep max 30 items
  while (feed.children.length > 30) feed.lastChild.remove();
}

function addDuplicateAlert(data) {
  if (!feed) return;
  const first = feed.querySelector('.muted');
  if (first) first.remove();

  const item = document.createElement('div');
  item.className = 'activity-item duplicate';
  const time = new Date(data.timestamp).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  item.innerHTML = `<span class="activity-time">${time}</span> &#9888; DUPLICATE SCAN: ${esc(data.guest.name)} (scan #${data.guest.scan_count})`;
  feed.prepend(item);
}

// ── Load initial activity ──
async function loadActivity() {
  try {
    const res = await fetch('/api/activity');
    const activities = await res.json();
    if (!feed || activities.length === 0) return;

    feed.innerHTML = '';
    activities.forEach(a => {
      const item = document.createElement('div');
      item.className = 'activity-item' + (a.action === 'duplicate_scan' ? ' duplicate' : '');
      const time = new Date(a.created_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
      const icon = a.action === 'duplicate_scan' ? '&#9888; ' : '';
      item.innerHTML = `<span class="activity-time">${time}</span> ${icon}<span class="activity-action">${esc(a.details || a.action)}</span>`;
      feed.appendChild(item);
    });
  } catch (e) {}
}

// ── Timeline Chart ──
async function drawTimeline() {
  const canvas = document.getElementById('timeline-chart');
  if (!canvas) return;

  try {
    const res = await fetch('/api/timeline');
    const data = await res.json();
    if (data.length === 0) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#8899aa';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No check-ins yet', canvas.width / 2, canvas.height / 2);
      return;
    }

    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.offsetWidth;
    const H = canvas.height = 200;
    const pad = { top: 20, right: 20, bottom: 40, left: 50 };

    const counts = data.map(d => parseInt(d.count));
    const maxCount = Math.max(...counts, 1);

    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;
    const barW = Math.max(4, chartW / data.length - 2);

    ctx.clearRect(0, 0, W, H);

    // Draw bars
    data.forEach((d, i) => {
      const x = pad.left + (i / data.length) * chartW;
      const h = (parseInt(d.count) / maxCount) * chartH;
      const y = pad.top + chartH - h;

      const grad = ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, '#d4af37');
      grad.addColorStop(1, '#1a7a3a');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barW, h);
    });

    // Y-axis labels
    ctx.fillStyle = '#8899aa';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = Math.round((maxCount / 4) * i);
      const y = pad.top + chartH - (i / 4) * chartH;
      ctx.fillText(v, pad.left - 8, y + 4);
    }

    // X-axis labels (show first, middle, last times)
    ctx.textAlign = 'center';
    [0, Math.floor(data.length / 2), data.length - 1].forEach(i => {
      if (i < data.length) {
        const x = pad.left + (i / data.length) * chartW + barW / 2;
        const time = new Date(data[i].minute).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
        ctx.fillText(time, x, H - 10);
      }
    });
  } catch (e) {}
}

// ── Helpers ──
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ── Edit Modal ──
function createEditModal() {
  if (document.getElementById('edit-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'edit-modal';
  modal.className = 'modal-overlay';
  modal.style.display = 'none';
  modal.innerHTML = `
    <div class="modal-card">
      <h2>Edit Guest</h2>
      <input type="hidden" id="edit-id">
      <div class="form-row" style="margin-bottom:10px">
        <input type="text" id="edit-name" placeholder="Name *">
        <select id="edit-category" onchange="document.getElementById('edit-family-size-wrap').style.display=this.value==='family'?'':'none'">
          <option value="guest">Guest</option>
          <option value="student">Student</option>
          <option value="parent">Parent</option>
          <option value="teacher">Teacher</option>
          <option value="vip">VIP</option>
          <option value="family">Family</option>
        </select>
      </div>
      <div id="edit-family-size-wrap" class="form-row" style="margin-bottom:10px;display:none">
        <label style="color:#8899aa;font-size:0.85rem">Family Members:</label>
        <input type="number" id="edit-family-size" min="1" value="2" style="width:80px">
      </div>
      <div class="form-row" style="margin-bottom:10px">
        <input type="text" id="edit-table" placeholder="Table #">
        <input type="text" id="edit-dietary" placeholder="Dietary restrictions">
      </div>
      <div class="form-row" style="margin-bottom:10px">
        <input type="text" id="edit-phone" placeholder="Phone">
        <input type="text" id="edit-email" placeholder="Email">
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" onclick="saveEdit()">Save</button>
        <button class="btn btn-danger" onclick="deleteGuest()">Delete Guest</button>
        <button class="btn btn-secondary" onclick="closeEditModal()">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', function(e) {
    if (e.target === modal) closeEditModal();
  });
}

async function openEditModal(id) {
  createEditModal();
  try {
    const res = await fetch(`/api/guests/${id}`);
    const g = await res.json();
    document.getElementById('edit-id').value = g.id;
    document.getElementById('edit-name').value = g.name || '';
    document.getElementById('edit-category').value = g.category || 'guest';
    document.getElementById('edit-family-size').value = g.family_size || 1;
    document.getElementById('edit-family-size-wrap').style.display = g.category === 'family' ? '' : 'none';
    document.getElementById('edit-table').value = g.table_number || '';
    document.getElementById('edit-dietary').value = g.dietary_restrictions || '';
    document.getElementById('edit-phone').value = g.phone || '';
    document.getElementById('edit-email').value = g.email || '';
    document.getElementById('edit-modal').style.display = 'flex';
  } catch (e) { alert('Failed to load guest'); }
}

function closeEditModal() {
  const modal = document.getElementById('edit-modal');
  if (modal) modal.style.display = 'none';
}

async function saveEdit() {
  const id = document.getElementById('edit-id').value;
  const category = document.getElementById('edit-category').value;
  const body = {
    name: document.getElementById('edit-name').value,
    category,
    table_number: document.getElementById('edit-table').value,
    dietary_restrictions: document.getElementById('edit-dietary').value,
    phone: document.getElementById('edit-phone').value,
    email: document.getElementById('edit-email').value,
    family_size: category === 'family' ? parseInt(document.getElementById('edit-family-size').value) || 1 : 1,
  };
  try {
    const res = await fetch(`/api/guests/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      closeEditModal();
      refreshGuests();
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to save');
    }
  } catch (e) { alert('Failed to save'); }
}

async function deleteGuest() {
  const id = document.getElementById('edit-id').value;
  const name = document.getElementById('edit-name').value;
  if (!confirm(`Delete ${name}? This cannot be undone.`)) return;

  try {
    // Use form POST for delete
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `/admin/guest/${id}/delete`;
    document.body.appendChild(form);
    form.submit();
  } catch (e) { alert('Failed to delete'); }
}

// ── Init ──
refreshStats();
refreshGuests();
loadActivity();
drawTimeline();

// Refresh timeline every 30s
setInterval(drawTimeline, 30000);
