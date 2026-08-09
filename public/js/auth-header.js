// Shared "logged in" header widget: renders a clickable username in
// .auth-buttons that opens a dropdown with profile info, current tickets
// and booking history. Included on every page that has a .auth-buttons
// header (index, parking, banking-qr).
(function () {
    const TOKEN_KEY = 'smartpark_token';
    const USER_KEY = 'smartpark_user';
    const CLIENT_CACHE_MS = 15000; // avoid refetching /api/me + /api/tickets/me on every dropdown open

    let cachedProfile = null;
    let cachedTickets = null;
    let cacheTimestamp = 0;

    function getToken() {
        return localStorage.getItem(TOKEN_KEY);
    }

    function getUser() {
        try {
            return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
        } catch (e) {
            return null;
        }
    }

    function setSession(user, token) {
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        localStorage.setItem(TOKEN_KEY, token);
    }

    function clearSession() {
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(TOKEN_KEY);
        cachedProfile = null;
        cachedTickets = null;
    }

    async function authFetch(url, options = {}) {
        const token = getToken();
        const headers = Object.assign({}, options.headers, token ? { Authorization: 'Bearer ' + token } : {});
        return fetch(url, Object.assign({}, options, { headers }));
    }

    function logout() {
        clearSession();
        window.location.reload();
    }

    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatMoney(n) {
        return new Intl.NumberFormat('vi-VN').format(n || 0) + '₫';
    }

    function statusLabel(status) {
        const map = {
            PENDING: 'Chờ thanh toán',
            ACTIVE: 'Đang hiệu lực',
            COMPLETED: 'Đã hoàn tất',
            CANCELLED: 'Đã hủy'
        };
        return map[status] || status;
    }

    function ticketRow(t) {
        return `
            <div class="sp-ticket-row">
                <div class="sp-ticket-main">
                    <strong>${escapeHtml(t.lotName)}</strong>
                    <span class="sp-ticket-badge sp-status-${escapeHtml((t.status || '').toLowerCase())}">${escapeHtml(statusLabel(t.status))}</span>
                </div>
                <div class="sp-ticket-sub">Chỗ ${escapeHtml(t.spot)} · ${escapeHtml(t.zone)} · ${t.expectedHours}h</div>
                <div class="sp-ticket-sub">${formatMoney(t.totalPrice)} · Mã: ${escapeHtml(t.code)}</div>
            </div>
        `;
    }

    async function loadDropdownData(force) {
        const now = Date.now();
        if (!force && cachedProfile && (now - cacheTimestamp) < CLIENT_CACHE_MS) {
            return { profile: cachedProfile, tickets: cachedTickets };
        }
        const [profileRes, ticketsRes] = await Promise.all([
            authFetch('/api/me'),
            authFetch('/api/tickets/me')
        ]);
        if (!profileRes.ok) throw new Error('SESSION_EXPIRED');
        cachedProfile = await profileRes.json();
        cachedTickets = ticketsRes.ok ? await ticketsRes.json() : { current: [], history: [] };
        cacheTimestamp = now;
        return { profile: cachedProfile, tickets: cachedTickets };
    }

    function buildDropdown() {
        const panel = document.createElement('div');
        panel.className = 'sp-user-dropdown';
        panel.innerHTML = `
            <div class="sp-tabs">
                <button type="button" class="sp-tab active" data-tab="info">Thông tin</button>
                <button type="button" class="sp-tab" data-tab="current">Vé hiện tại</button>
                <button type="button" class="sp-tab" data-tab="history">Lịch sử</button>
            </div>
            <div class="sp-tab-content" data-panel="info"><div class="sp-loading">Đang tải...</div></div>
            <div class="sp-tab-content" data-panel="current" style="display:none"><div class="sp-loading">Đang tải...</div></div>
            <div class="sp-tab-content" data-panel="history" style="display:none"><div class="sp-loading">Đang tải...</div></div>
            <button type="button" class="sp-logout-btn">Đăng xuất</button>
        `;

        panel.querySelectorAll('.sp-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                panel.querySelectorAll('.sp-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                panel.querySelectorAll('.sp-tab-content').forEach(c => c.style.display = 'none');
                panel.querySelector(`.sp-tab-content[data-panel="${tab.dataset.tab}"]`).style.display = 'block';
            });
        });

        panel.querySelector('.sp-logout-btn').addEventListener('click', logout);

        return panel;
    }

    function renderData(panel, data) {
        const { profile, tickets } = data;

        panel.querySelector('[data-panel="info"]').innerHTML = `
            <div class="sp-info-row"><span>Họ tên</span><strong>${escapeHtml(profile.fullName)}</strong></div>
            <div class="sp-info-row"><span>Điện thoại</span><strong>${escapeHtml(profile.phone)}</strong></div>
            <div class="sp-info-row"><span>Email</span><strong>${escapeHtml(profile.email)}</strong></div>
            <div class="sp-info-row"><span>Biển số</span><strong>${escapeHtml(profile.licensePlate || 'Chưa có')}</strong></div>
        `;

        const currentHtml = tickets.current.length
            ? tickets.current.map(ticketRow).join('')
            : '<div class="sp-empty">Chưa có vé nào đang hiệu lực.</div>';
        panel.querySelector('[data-panel="current"]').innerHTML = currentHtml;

        const historyHtml = tickets.history.length
            ? tickets.history.map(ticketRow).join('')
            : '<div class="sp-empty">Chưa có lịch sử đặt chỗ.</div>';
        panel.querySelector('[data-panel="history"]').innerHTML = historyHtml;
    }

    function init() {
        const user = getUser();
        const token = getToken();
        const authButtons = document.querySelector('.auth-buttons');
        if (!authButtons || !user || !token) return;

        authButtons.innerHTML = `
            <div class="sp-user-widget">
                <button type="button" class="sp-user-trigger">👋 ${escapeHtml(user.fullName)} ▾</button>
            </div>
        `;

        const widget = authButtons.querySelector('.sp-user-widget');
        const trigger = widget.querySelector('.sp-user-trigger');
        let dropdown = null;
        let open = false;

        async function toggle() {
            open = !open;
            if (!open) {
                if (dropdown) dropdown.style.display = 'none';
                return;
            }
            if (!dropdown) {
                dropdown = buildDropdown();
                widget.appendChild(dropdown);
            }
            dropdown.style.display = 'block';
            try {
                const data = await loadDropdownData(false);
                renderData(dropdown, data);
            } catch (err) {
                if (err.message === 'SESSION_EXPIRED') {
                    logout();
                } else {
                    dropdown.querySelector('[data-panel="info"]').innerHTML = '<div class="sp-empty">Không thể tải dữ liệu.</div>';
                }
            }
        }

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle();
        });

        document.addEventListener('click', (e) => {
            if (open && !widget.contains(e.target)) {
                open = false;
                if (dropdown) dropdown.style.display = 'none';
            }
        });
    }

    window.SmartParkAuth = { getToken, getUser, setSession, clearSession, authFetch, logout, init };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
