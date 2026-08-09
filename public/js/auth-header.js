// Shared "logged in" header widget: renders a clickable username in
// .auth-buttons that opens a horizontal-tab menu with customer info,
// transaction history and paid invoices. Included on every page that has
// a .auth-buttons header (index, parking, banking-qr, staff scan).
//
// Also maintains window.currentUserId for convenience elsewhere in the
// app: 0 while logged out, the real user id once logged in.
(function () {
    const TOKEN_KEY = 'smartpark_token';
    const USER_KEY = 'smartpark_user';
    const CLIENT_CACHE_MS = 15000; // avoid refetching /api/me + /api/tickets/me too often

    window.currentUserId = 0;

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
        window.currentUserId = user && user.id ? user.id : 0;
    }

    function clearSession() {
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(TOKEN_KEY);
        cachedProfile = null;
        cachedTickets = null;
        cacheTimestamp = 0;
        window.currentUserId = 0;
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

    function formatDateTime(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('vi-VN');
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

    function transactionRow(t) {
        return `
            <div class="sp-ticket-row">
                <div class="sp-ticket-main">
                    <strong>${escapeHtml(t.lotName)}</strong>
                    <span class="sp-ticket-badge sp-status-${escapeHtml((t.status || '').toLowerCase())}">${escapeHtml(statusLabel(t.status))}</span>
                </div>
                <div class="sp-ticket-sub">Chỗ ${escapeHtml(t.spot)} · ${escapeHtml(t.zone)} · ${t.expectedHours}h</div>
                <div class="sp-ticket-sub">${formatMoney(t.totalPrice)} · ${formatDateTime(t.bookingTime)}</div>
                <div class="sp-ticket-sub">Mã: ${escapeHtml(t.code)}</div>
            </div>
        `;
    }

    function invoiceRow(t) {
        const payload = escapeHtml(JSON.stringify(t));
        return `
            <div class="sp-ticket-row">
                <div class="sp-ticket-main">
                    <strong>${escapeHtml(t.lotName)}</strong>
                    <span class="sp-ticket-badge sp-status-completed">Đã thanh toán</span>
                </div>
                <div class="sp-ticket-sub">Chỗ ${escapeHtml(t.spot)} · ${escapeHtml(t.zone)} · ${t.expectedHours}h</div>
                <div class="sp-ticket-sub">${formatMoney(t.totalPrice)} · Mã: ${escapeHtml(t.code)}</div>
                <button type="button" class="sp-print-btn" data-invoice="${payload}">In hóa đơn</button>
            </div>
        `;
    }

    function printInvoice(t) {
        const w = window.open('', '_blank', 'width=420,height=600');
        w.document.write(`
            <html><head><title>Hóa đơn ${escapeHtml(t.code)}</title>
            <style>body{font-family:sans-serif;padding:24px;color:#111} h2{color:#10b981} .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee}</style>
            </head><body>
            <h2>SmartPark - Hóa đơn thanh toán</h2>
            <div class="row"><span>Mã vé</span><strong>${escapeHtml(t.code)}</strong></div>
            <div class="row"><span>Bãi xe</span><strong>${escapeHtml(t.lotName)}</strong></div>
            <div class="row"><span>Địa chỉ</span><strong>${escapeHtml(t.lotAddress || '')}</strong></div>
            <div class="row"><span>Vị trí</span><strong>${escapeHtml(t.spot)} (${escapeHtml(t.zone)})</strong></div>
            <div class="row"><span>Biển số</span><strong>${escapeHtml(t.vehiclePlate || '')}</strong></div>
            <div class="row"><span>Số giờ</span><strong>${t.expectedHours} giờ</strong></div>
            <div class="row"><span>Thời gian đặt</span><strong>${formatDateTime(t.bookingTime)}</strong></div>
            <div class="row"><span>Tổng tiền</span><strong>${formatMoney(t.totalPrice)}</strong></div>
            </body></html>
        `);
        w.document.close();
        w.focus();
        w.print();
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
                <button type="button" class="sp-tab active" data-tab="info">Thông tin khách hàng</button>
                <button type="button" class="sp-tab" data-tab="transactions">Lịch sử giao dịch</button>
                <button type="button" class="sp-tab" data-tab="invoices">Hóa đơn đã thanh toán</button>
            </div>
            <div class="sp-tab-content" data-panel="info"><div class="sp-loading">Đang tải...</div></div>
            <div class="sp-tab-content" data-panel="transactions" style="display:none"><div class="sp-loading">Đang tải...</div></div>
            <div class="sp-tab-content" data-panel="invoices" style="display:none"><div class="sp-loading">Đang tải...</div></div>
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

        panel.addEventListener('click', (e) => {
            const btn = e.target.closest('.sp-print-btn');
            if (btn) printInvoice(JSON.parse(btn.dataset.invoice));
        });

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

        const allTickets = [...tickets.current, ...tickets.history];
        panel.querySelector('[data-panel="transactions"]').innerHTML = allTickets.length
            ? allTickets.map(transactionRow).join('')
            : '<div class="sp-empty">Chưa có giao dịch nào.</div>';

        const paidTickets = allTickets.filter(t => t.paymentStatus === 'SUCCESS');
        panel.querySelector('[data-panel="invoices"]').innerHTML = paidTickets.length
            ? paidTickets.map(invoiceRow).join('')
            : '<div class="sp-empty">Chưa có hóa đơn đã thanh toán.</div>';
    }

    function injectStaffNavLink(user) {
        const STAFF_ROLES = ['STAFF', 'ADMIN'];
        if (!user || !STAFF_ROLES.includes(user.role)) return;
        const navLinks = document.querySelector('.nav-links');
        if (!navLinks || navLinks.querySelector('.sp-staff-link')) return;

        const contactLink = Array.from(navLinks.querySelectorAll('a')).find(a => a.textContent.trim() === 'Liên hệ');
        const staffLink = document.createElement('a');
        staffLink.href = '/staff/scan';
        staffLink.className = 'sp-staff-link';
        staffLink.textContent = 'Quét Vé (NV)';

        if (contactLink) {
            contactLink.insertAdjacentElement('afterend', staffLink);
        } else {
            navLinks.appendChild(staffLink);
        }
    }

    function init() {
        const user = getUser();
        const token = getToken();
        window.currentUserId = user && user.id ? user.id : 0;

        const authButtons = document.querySelector('.auth-buttons');
        if (!authButtons || !user || !token) return;

        injectStaffNavLink(user);

        authButtons.innerHTML = `
            <div class="sp-user-widget">
                <button type="button" class="sp-user-trigger">👋 ${escapeHtml(user.fullName)} ▾</button>
            </div>
        `;

        const widget = authButtons.querySelector('.sp-user-widget');
        const trigger = widget.querySelector('.sp-user-trigger');
        let dropdown = null;
        let open = false;

        function ensureDropdown() {
            if (!dropdown) {
                dropdown = buildDropdown();
                widget.appendChild(dropdown);
            }
            return dropdown;
        }

        async function refresh(force) {
            const panel = ensureDropdown();
            try {
                const data = await loadDropdownData(force);
                renderData(panel, data);
            } catch (err) {
                if (err.message === 'SESSION_EXPIRED') {
                    logout();
                } else {
                    panel.querySelector('[data-panel="info"]').innerHTML = '<div class="sp-empty">Không thể tải dữ liệu.</div>';
                }
            }
        }

        // Cache the customer's info/history right away on login/page load,
        // not only the first time they open the dropdown.
        refresh(false);

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            open = !open;
            const panel = ensureDropdown();
            panel.style.display = open ? 'block' : 'none';
            if (open) refresh(false);
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
