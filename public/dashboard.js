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
      ? '<tr><td colspan="6" class="text-center muted" style="padding:20px">No guests found</td></tr>'
      : guests.map(g => `
        <tr>
          <td>${esc(g.name)}</td>
          <td><span class="badge cat-${g.category || 'guest'}">${g.category || 'guest'}</span></td>
          <td>${esc(g.table_number || '-')}</td>
          <td><span class="badge ${g.checked_in ? 'badge-checked' : 'badge-pending'}">${g.checked_in ? 'Checked In' : 'Pending'}</span></td>
          <td>${g.checked_in_at ? new Date(g.checked_in_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : '-'}</td>
          <td>
            ${g.checked_in ? `<a href="/admin/ticket/${g.id}" class="btn btn-sm btn-secondary" target="_blank">Ticket</a>` : `
              <button class="btn btn-sm btn-primary" onclick="manualCheckin(${g.id})">Check In</button>
              <a href="/admin/ticket/${g.id}" class="btn btn-sm btn-secondary" target="_blank">Ticket</a>
            `}
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

// ── Init ──
refreshStats();
refreshGuests();
loadActivity();
drawTimeline();

// Refresh timeline every 30s
setInterval(drawTimeline, 30000);
