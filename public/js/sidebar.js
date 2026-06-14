/* Intrack — Sidebar dinamis + Socket.io notifikasi realtime */

function buildSidebar(user, activePage) {
  if (!user) return '';

  const isSuperadmin = user.role === 'superadmin';
  const isDireksi    = user.role === 'direksi';
  const inits     = (user.namaLengkap || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const avColors  = ['#5B4FE8','#16A34A','#EA580C','#0D9488','#DB2777'];
  const avColor   = avColors[inits.charCodeAt(0) % avColors.length];

  const pages = [
    { id: 'dashboard', href: '/pages/dashboard.html',  icon: 'ti-layout-dashboard', label: 'Dashboard',     section: 'main' },
    { id: 'my-tasks',  href: '/pages/my-tasks.html',   icon: 'ti-checkbox',         label: 'My Tasks',      section: 'main' },
    { id: 'tasks',     href: '/pages/list.html',        icon: 'ti-clipboard-list',   label: 'Daftar Task',   section: 'main' },
    { id: 'board',     href: '/pages/board.html',       icon: 'ti-layout-kanban',    label: 'Board Kanban',  section: 'main' },
    { id: 'calendar',   href: '/pages/calendar.html',    icon: 'ti-calendar-month',   label: 'Kalender',      section: 'plan' },
    { id: 'gantt',      href: '/pages/gantt.html',       icon: 'ti-chart-gantt',      label: 'Gantt Chart',   section: 'plan' },
    { id: 'milestones', href: '/pages/milestones.html',  icon: 'ti-flag',             label: 'Milestones',    section: 'plan' },
    { id: 'workload',   href: '/pages/workload.html',    icon: 'ti-users-group',      label: 'Workload',      section: 'plan' },
    { id: 'inbox',     href: '/pages/inbox.html',       icon: 'ti-bell',             label: 'Notifikasi',    section: 'main', badge: true },
    { id: 'kpi',       href: '/pages/stats.html',       icon: 'ti-chart-bar',        label: 'KPI',           section: 'main' },
    ...(isDireksi || isSuperadmin ? [
      { id: 'users',  href: '/pages/settings.html', icon: 'ti-users',        label: 'Manajemen User', section: 'admin' },
      { id: 'audit',  href: '/pages/audit.html',    icon: 'ti-shield-check', label: 'Audit Trail',    section: 'admin' },
    ] : []),
    ...(isSuperadmin ? [
      { id: 'site-settings', href: '/pages/site-settings.html', icon: 'ti-settings', label: 'Site Settings', section: 'admin' },
    ] : []),
  ];

  const sections = [
    { key: 'main',  label: 'Menu' },
    { key: 'plan',  label: 'Perencanaan' },
    { key: 'admin', label: 'Administrasi' },
  ];

  const navLinks = sections.map(sec => {
    const items = pages.filter(p => p.section === sec.key);
    if (!items.length) return '';
    return `<div class="sb-section">
      <div class="sb-section-label">${sec.label}</div>
      ${items.map(p => `
        <a href="${p.href}" class="sb-link${activePage === p.id ? ' active' : ''}" data-page="${p.id}">
          <i class="ti ${p.icon}" aria-hidden="true"></i>
          ${p.label}
          ${p.badge ? `<span class="sb-badge" id="sb-notif-badge" style="display:none">0</span>` : ''}
        </a>`).join('')}
    </div>`;
  }).join('');

  const fotoHtml = user.fotoProfil
    ? `<img src="${user.fotoProfil}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover">`
    : `<div class="sb-av" style="background:${avColor}">${inits}</div>`;

  const roleLabel = isSuperadmin ? 'Superadmin' : isDireksi ? 'Direksi' : (user.direktoratId?.nama || 'Manager');

  return `
    <div class="sb-logo">
      <div class="sb-mark">
        <img src="/img/logo.png" alt="Logo" onerror="this.parentElement.innerHTML='<div class=sb-mark-text>I</div>'">
      </div>
      <div>
        <div class="sb-name" id="sb-app-name">Intrack</div>
        <div class="sb-ws">${roleLabel}</div>
      </div>
    </div>
    <div class="sb-scroll">
      ${navLinks}
    </div>
    <div class="sb-user" onclick="window.location='/pages/profile.html'" style="cursor:pointer">
      ${fotoHtml}
      <div>
        <div class="sb-uname">${user.namaLengkap}</div>
        <div class="sb-urole">${roleLabel}</div>
      </div>
      <i class="ti ti-chevron-right" style="font-size:12px;color:#52525B;margin-left:auto" aria-hidden="true"></i>
    </div>`;
}

function injectImpersonateBanner(targetName, adminName) {
  const style = document.createElement('style');
  style.textContent = `
    #impersonate-banner {
      position:fixed;bottom:0;left:0;right:0;z-index:9999;
      background:#92400E;color:#FEF3C7;
      display:flex;align-items:center;justify-content:center;gap:12px;
      padding:10px 20px;font-size:13px;font-weight:600;
      box-shadow:0 -2px 12px rgba(0,0,0,.2);
    }
    #impersonate-banner i { font-size:16px; }
    #impersonate-banner button {
      background:#FEF3C7;color:#92400E;border:none;border-radius:6px;
      padding:5px 14px;font-size:12px;font-weight:700;cursor:pointer;
      transition:opacity .15s;
    }
    #impersonate-banner button:hover { opacity:.85 }
    .main { padding-bottom: 48px !important; }
  `;
  document.head.appendChild(style);

  const banner = document.createElement('div');
  banner.id = 'impersonate-banner';
  banner.innerHTML = `
    <i class="ti ti-user-check"></i>
    Anda menyamar sebagai <strong style="margin:0 4px">${targetName}</strong> (sebagai ${adminName})
    <button onclick="exitImpersonate()">Keluar dari Mode Penyamaran</button>
  `;
  document.body.appendChild(banner);
}

function exitImpersonate() {
  Auth.stopImpersonate();
  window.location.reload();
}

// Mobile overlay sidebar
function injectMobileToggle() {
  // Inject style
  const style = document.createElement('style');
  style.textContent = `
    #sb-mobile-toggle {
      display:none;position:fixed;top:12px;left:12px;z-index:1200;
      background:var(--accent);color:#fff;border:none;border-radius:9px;
      width:38px;height:38px;cursor:pointer;align-items:center;justify-content:center;font-size:19px;
      box-shadow:0 2px 8px rgba(91,79,232,.4);
    }
    #sb-overlay {
      display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1099;backdrop-filter:blur(2px);
    }
    @media(max-width:768px){
      #sb-mobile-toggle{display:flex!important;}
    }
  `;
  document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.id = 'sb-mobile-toggle';
  btn.innerHTML = '<i class="ti ti-menu-2"></i>';
  document.body.appendChild(btn);

  const overlay = document.createElement('div');
  overlay.id = 'sb-overlay';
  document.body.appendChild(overlay);

  const openSidebar = () => {
    document.querySelector('.sidebar')?.classList.add('open');
    overlay.style.display = 'block';
    btn.innerHTML = '<i class="ti ti-x"></i>';
  };
  const closeSidebar = () => {
    document.querySelector('.sidebar')?.classList.remove('open');
    overlay.style.display = 'none';
    btn.innerHTML = '<i class="ti ti-menu-2"></i>';
  };

  btn.addEventListener('click', () => {
    document.querySelector('.sidebar')?.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  overlay.addEventListener('click', closeSidebar);
}

async function initSidebar(activePage) {
  const el = document.getElementById('sidebar');
  if (!el) return;

  injectMobileToggle();

  // Ambil user dari cache atau API
  let user = getUser();
  if (!user) {
    try { user = await Auth.me(); localStorage.setItem('wt_user', JSON.stringify(user)); }
    catch { window.location.href = '/pages/login.html'; return; }
  }

  el.innerHTML = buildSidebar(user, activePage);

  // Banner impersonasi
  if (Auth.isImpersonating()) {
    const by = JSON.parse(localStorage.getItem('wt_impersonated_by') || '{}');
    injectImpersonateBanner(user.namaLengkap, by.nama || 'Superadmin');
  }

  // Load app name dari site settings
  fetch('/api/site-settings').then(r => r.json()).then(s => {
    const el = document.getElementById('sb-app-name');
    if (el && s.appName) el.textContent = s.appName;
    if (s.accentColor) document.documentElement.style.setProperty('--accent', s.accentColor);
  }).catch(() => {});

  // Socket.io koneksi untuk notifikasi realtime
  initSocketNotif(user);

  // Load badge count
  loadNotifBadge();
}

async function loadNotifBadge() {
  try {
    const { unreadCount } = await Notifikasi.list({ limit: 1 });
    const badge = document.getElementById('sb-notif-badge');
    if (badge) {
      badge.textContent = unreadCount;
      badge.style.display = unreadCount > 0 ? 'flex' : 'none';
    }
  } catch {}
}

function initSocketNotif(user) {
  if (typeof io === 'undefined') return;
  const token = getToken();
  if (!token) return;

  const socket = io(window.location.origin, { auth: { token } });

  socket.on('notifikasi:baru', (notif) => {
    // Update badge
    const badge = document.getElementById('sb-notif-badge');
    if (badge) {
      const current = parseInt(badge.textContent || '0');
      badge.textContent = current + 1;
      badge.style.display = 'flex';
    }
    // Toast
    showToast(`🔔 ${notif.judul}: ${notif.isi}`);
  });
}

function injectGlobalSearchBtn() {
  // Add search button to topbar-right if present
  const topbarRight = document.querySelector('.topbar-right');
  if (!topbarRight) return;
  const btn = document.createElement('button');
  btn.className = 'btn-icon';
  btn.title = 'Cari (Ctrl+K)';
  btn.innerHTML = `<i class="ti ti-search"></i>`;
  btn.style.cssText = 'position:relative';
  btn.addEventListener('click', () => typeof openGlobalSearch === 'function' && openGlobalSearch());

  // Add keyboard shortcut hint badge
  const hint = document.createElement('span');
  hint.style.cssText = `position:absolute;top:-4px;right:-4px;background:var(--accent);color:#fff;border-radius:4px;font-size:9px;padding:0 3px;font-weight:700;pointer-events:none`;
  hint.textContent = '⌘K';
  btn.appendChild(hint);

  topbarRight.prepend(btn);
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('sidebar');
  if (!el) return;
  const page = el.dataset.page || '';
  initSidebar(page);
  injectGlobalSearchBtn();
});
