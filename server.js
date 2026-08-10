const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const { requireAuth, requireStaff, requireAdmin } = require('./middleware/auth');
const { signUserToken } = require('./utils/jwt');
const { BANK_INFO, buildMemoContent, extractMemoSuffix } = require('./utils/payment');
const userRepository = require('./repositories/userRepository');
const parkingRepository = require('./repositories/parkingRepository');
const ticketRepository = require('./repositories/ticketRepository');
const staffRepository = require('./repositories/staffRepository');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set. This app requires a real database connection to run.');
    process.exit(1);
}

mongoose.connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB.'))
    .catch(err => {
        console.error('MongoDB connection failed:', err.message);
        process.exit(1);
    });

// Sweep for unpaid tickets past their 5-minute payment window and cancel
// them (releasing the spot) so it doesn't stay held forever.
const EXPIRED_TICKET_SWEEP_MS = 30 * 1000;
setInterval(() => {
    ticketRepository.cancelExpiredTickets().catch(err => {
        console.error('Lỗi khi tự động hủy vé quá hạn:', err.message);
    });
}, EXPIRED_TICKET_SWEEP_MS);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

function stripInternal(ticket) {
    const { _ticketDoc, _transactionDoc, _fallback, ...clean } = ticket;
    return clean;
}

// ===================== AUTH API =====================

app.post('/api/auth/register', async (req, res) => {
    const { fullName, phone, email, licensePlate, password } = req.body;

    if (!fullName || !phone || !email || !licensePlate || !password) {
        return res.status(400).json({ message: 'Vui lòng điền đầy đủ tất cả các thông tin đăng ký.' });
    }

    try {
        const existingUser = await userRepository.findByPhone(phone);
        if (existingUser) {
            return res.status(400).json({ message: 'Số điện thoại này đã được đăng ký trên hệ thống.' });
        }

        const { user, vehicle } = await userRepository.createUser({ fullName, phone, email, licensePlate, password });
        const userResponse = userRepository.toPublic(user, vehicle);
        const token = signUserToken(userResponse);

        return res.json({ user: userResponse, token });
    } catch (err) {
        if (err.code === 'PLATE_TAKEN') {
            return res.status(400).json({ message: 'Biển số xe này đã được đăng ký trên hệ thống.' });
        }
        if (err.code === 'INVALID_PLATE') {
            return res.status(400).json({ message: 'Biển số xe không hợp lệ.' });
        }
        console.error('Lỗi khi đăng ký:', err);
        return res.status(500).json({ message: 'Lỗi hệ thống khi đăng ký.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ message: 'Vui lòng nhập số điện thoại và mật khẩu.' });
    }

    try {
        const user = await userRepository.findByPhone(phone);
        if (!user || !userRepository.verifyPassword(password, user.password)) {
            return res.status(400).json({ message: 'Số điện thoại hoặc mật khẩu không chính xác.' });
        }
        if (user.status !== 'ACTIVE') {
            return res.status(403).json({ message: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.' });
        }

        const vehicle = await userRepository.getDefaultVehicle(String(user._id || user.id));
        const userResponse = userRepository.toPublic(user, vehicle);
        const token = signUserToken(userResponse);

        return res.json({ user: userResponse, token });
    } catch (err) {
        console.error('Lỗi khi đăng nhập:', err);
        return res.status(500).json({ message: 'Lỗi hệ thống khi đăng nhập.' });
    }
});

app.get('/api/me', requireAuth, async (req, res) => {
    try {
        const user = await userRepository.findById(req.userId);
        if (!user) {
            return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
        }
        const vehicle = await userRepository.getDefaultVehicle(req.userId);
        return res.json(userRepository.toPublic(user, vehicle));
    } catch (err) {
        console.error('Lỗi khi lấy thông tin người dùng:', err);
        return res.status(500).json({ message: 'Lỗi hệ thống.' });
    }
});

// ===================== PARKING LOT API =====================

app.get('/api/parking-lots', async (req, res) => {
    try {
        const lots = await parkingRepository.listLots();
        res.json(lots);
    } catch (err) {
        console.error('Lỗi khi tải danh sách bãi xe:', err);
        res.status(500).json({ message: 'Lỗi hệ thống.' });
    }
});

app.get('/api/parking-lots/:lotId', async (req, res) => {
    try {
        const lot = await parkingRepository.getLot(req.params.lotId);
        if (!lot) return res.status(404).json({ error: 'Bãi xe không tìm thấy' });
        res.json(lot);
    } catch (err) {
        console.error('Lỗi khi tải bãi xe:', err);
        res.status(500).json({ message: 'Lỗi hệ thống.' });
    }
});

app.get('/api/parking-lots/:lotId/slots', async (req, res) => {
    try {
        const data = await parkingRepository.getLotSlots(req.params.lotId);
        if (!data) return res.status(404).json({ error: 'Bãi xe không tìm thấy' });
        res.json(data);
    } catch (err) {
        console.error('Lỗi khi tải sơ đồ chỗ đỗ:', err);
        res.status(500).json({ message: 'Lỗi hệ thống.' });
    }
});

// ===================== TICKET (BOOKING) API =====================

app.post('/api/tickets', requireAuth, async (req, res) => {
    const { lotId, spotCode, vehicleType, expectedHours } = req.body;

    if (!lotId || !spotCode || !expectedHours) {
        return res.status(400).json({ message: 'Thiếu thông tin đặt chỗ.' });
    }

    try {
        const ticket = await ticketRepository.createTicket(req.userId, {
            lotId,
            spotCode,
            vehicleType,
            expectedHours: Number(expectedHours)
        });
        return res.json(stripInternal(ticket));
    } catch (err) {
        if (err.code === 'ALREADY_HAS_ACTIVE_TICKET') {
            return res.status(409).json({ message: `Bạn đang có 1 chỗ đặt chưa hoàn tất (mã ${err.ticketCode}). Vui lòng thanh toán/checkout hoặc chờ hết hạn trước khi đặt chỗ mới.` });
        }
        if (err.code === 'SPOT_UNAVAILABLE') {
            return res.status(409).json({ message: 'Chỗ này vừa được người khác đặt. Vui lòng chọn chỗ khác.' });
        }
        if (err.code === 'LOT_UNAVAILABLE') {
            return res.status(409).json({ message: 'Bãi xe này đang tạm ngưng hoạt động để bảo trì. Vui lòng chọn bãi khác.' });
        }
        if (err.code === 'LOT_NOT_FOUND') {
            return res.status(404).json({ message: 'Bãi xe không tìm thấy.' });
        }
        if (err.code === 'NO_VEHICLE') {
            return res.status(400).json({ message: 'Tài khoản chưa có biển số xe đăng ký.' });
        }
        console.error('Lỗi khi tạo đặt chỗ:', err);
        return res.status(500).json({ message: 'Lỗi hệ thống khi đặt chỗ.' });
    }
});

app.get('/api/tickets/me', requireAuth, async (req, res) => {
    try {
        const result = await ticketRepository.findByUser(req.userId);
        res.json({
            current: result.current.map(stripInternal),
            history: result.history.map(stripInternal)
        });
    } catch (err) {
        console.error('Lỗi khi tải lịch sử đặt chỗ:', err);
        res.status(500).json({ message: 'Lỗi hệ thống.' });
    }
});

// Deliberately unauthenticated: the banking-qr page polls this to detect
// an automatic bank-webhook confirmation. It only leaks whether a ticket
// (already a secret-ish code) is paid — no customer PII — and not
// requiring a valid session avoids silently missing the notification if
// the browser's stored token happened to be missing/expired at that
// moment.
app.get('/api/tickets/:code/status', async (req, res) => {
    try {
        const ticket = await ticketRepository.findByCode(req.params.code);
        if (!ticket) {
            return res.status(404).json({ message: 'Không tìm thấy vé đặt chỗ.' });
        }
        res.json({ status: ticket.status, paymentStatus: ticket.paymentStatus });
    } catch (err) {
        console.error('Lỗi khi kiểm tra trạng thái vé:', err);
        res.status(500).json({ message: 'Lỗi hệ thống.' });
    }
});

app.get('/api/tickets/:code', requireAuth, async (req, res) => {
    try {
        const ticket = await ticketRepository.findByCode(req.params.code, req.userId);
        if (!ticket) {
            return res.status(404).json({ message: 'Không tìm thấy vé đặt chỗ.' });
        }
        res.json(stripInternal(ticket));
    } catch (err) {
        console.error('Lỗi khi tải vé:', err);
        res.status(500).json({ message: 'Lỗi hệ thống.' });
    }
});

app.post('/api/tickets/:code/confirm-payment', requireAuth, async (req, res) => {
    try {
        const updated = await ticketRepository.confirmPayment(req.params.code, req.userId);
        if (!updated) {
            return res.status(404).json({ message: 'Không tìm thấy vé đặt chỗ.' });
        }
        res.json(stripInternal(updated));
    } catch (err) {
        if (err.code === 'ALREADY_PROCESSED') {
            return res.status(400).json({ message: 'Vé này đã được xử lý.' });
        }
        console.error('Lỗi khi xác nhận thanh toán:', err);
        res.status(500).json({ message: 'Lỗi hệ thống khi xác nhận thanh toán.' });
    }
});

// ===================== PAYMENT WEBHOOK (SePay) =====================
// SePay watches a real bank account and POSTs here the moment a matching
// transfer lands, so payment gets confirmed automatically instead of
// relying on someone clicking "Tôi đã thanh toán". Configure this URL
// (https://<domain>/api/payments/webhook/sepay) and SEPAY_API_KEY in your
// SePay dashboard after linking a bank account.
app.post('/api/payments/webhook/sepay', async (req, res) => {
    // .trim() guards against a stray trailing space/newline from copy-pasting
    // the key into Render's env var UI, which would otherwise silently break
    // an exact string match.
    const authHeader = (req.headers.authorization || '').trim();
    const configuredKey = (process.env.SEPAY_API_KEY || '').trim();
    const expected = `Apikey ${configuredKey}`;

    if (!configuredKey || authHeader !== expected) {
        console.warn('SePay webhook: missing/invalid API key. Got:', JSON.stringify(authHeader));
        return res.status(401).json({ message: 'Unauthorized' });
    }

    console.log('SePay webhook payload:', JSON.stringify(req.body));

    const body = req.body || {};
    const content = body.content || body.description || '';
    const amount = body.transferAmount ?? body.amount;
    const transferType = body.transferType || body.type;

    // Only react to money coming IN; ignore outgoing transactions on the
    // same account if SePay reports those too.
    if (transferType && transferType !== 'in') {
        return res.json({ success: true, ignored: 'not_incoming' });
    }

    const suffix = extractMemoSuffix(content);
    if (!suffix) {
        console.warn('SePay webhook: no PARK<code> tag found in content:', content);
        return res.json({ success: true, ignored: 'no_memo_match' });
    }

    try {
        const result = await ticketRepository.confirmPaymentByMemo(suffix, amount);
        if (!result.matched) {
            console.warn('SePay webhook: did not auto-confirm a ticket.', result);
        } else {
            console.log('SePay webhook: confirmed payment for ticket', result.ticket.code);
        }
        res.json({ success: true, matched: result.matched });
    } catch (err) {
        console.error('Lỗi xử lý webhook thanh toán:', err);
        res.status(500).json({ success: false });
    }
});

// ===================== STAFF API (role: STAFF or ADMIN only) =====================

app.get('/api/staff/tickets/:code', requireStaff, async (req, res) => {
    try {
        const ticket = await ticketRepository.findForStaff(req.params.code);
        if (!ticket) {
            return res.status(404).json({ message: 'Không tìm thấy vé đặt chỗ.' });
        }
        res.json(stripInternal(ticket));
    } catch (err) {
        console.error('Lỗi khi tra cứu vé (nhân viên):', err);
        res.status(500).json({ message: 'Lỗi hệ thống.' });
    }
});

app.post('/api/staff/tickets/:code/confirm-payment', requireStaff, async (req, res) => {
    try {
        const updated = await ticketRepository.confirmPayment(req.params.code);
        if (!updated) {
            return res.status(404).json({ message: 'Không tìm thấy vé đặt chỗ.' });
        }
        res.json(stripInternal(updated));
    } catch (err) {
        if (err.code === 'ALREADY_PROCESSED') {
            return res.status(400).json({ message: 'Vé này đã được xử lý.' });
        }
        console.error('Lỗi khi xác nhận thanh toán (nhân viên):', err);
        res.status(500).json({ message: 'Lỗi hệ thống khi xác nhận thanh toán.' });
    }
});

app.post('/api/staff/tickets/:code/check-in', requireStaff, async (req, res) => {
    try {
        const updated = await ticketRepository.checkIn(req.params.code, { id: req.userId, role: req.userRole });
        if (!updated) {
            return res.status(404).json({ message: 'Không tìm thấy vé đặt chỗ.' });
        }
        res.json(stripInternal(updated));
    } catch (err) {
        if (err.code === 'NOT_PAID') {
            return res.status(400).json({ message: 'Vé chưa thanh toán, cần xác nhận thanh toán trước khi check-in.' });
        }
        if (err.code === 'NOT_ASSIGNED') {
            return res.status(403).json({ message: 'Bạn chưa được phân công khu vực/ca làm việc. Vui lòng liên hệ quản trị viên.' });
        }
        if (err.code === 'WRONG_ZONE') {
            return res.status(403).json({ message: `Vé này thuộc khu vực khác. Bạn chỉ được quét vé tại khu vực ${err.assignedZone}.` });
        }
        if (err.code === 'OUTSIDE_SHIFT') {
            return res.status(403).json({ message: `Hiện không trong ca làm việc của bạn (${err.shiftName}). Không thể quét vé.` });
        }
        console.error('Lỗi khi check-in:', err);
        res.status(500).json({ message: 'Lỗi hệ thống khi check-in.' });
    }
});

app.post('/api/staff/tickets/:code/check-out', requireStaff, async (req, res) => {
    try {
        const updated = await ticketRepository.checkOut(req.params.code, { id: req.userId, role: req.userRole });
        if (!updated) {
            return res.status(404).json({ message: 'Không tìm thấy vé đặt chỗ.' });
        }
        res.json(stripInternal(updated));
    } catch (err) {
        if (err.code === 'NOT_ACTIVE') {
            return res.status(400).json({ message: 'Vé không ở trạng thái có thể check-out.' });
        }
        if (err.code === 'NOT_ASSIGNED') {
            return res.status(403).json({ message: 'Bạn chưa được phân công khu vực/ca làm việc. Vui lòng liên hệ quản trị viên.' });
        }
        if (err.code === 'WRONG_ZONE') {
            return res.status(403).json({ message: `Vé này thuộc khu vực khác. Bạn chỉ được quét vé tại khu vực ${err.assignedZone}.` });
        }
        if (err.code === 'OUTSIDE_SHIFT') {
            return res.status(403).json({ message: `Hiện không trong ca làm việc của bạn (${err.shiftName}). Không thể quét vé.` });
        }
        console.error('Lỗi khi check-out:', err);
        res.status(500).json({ message: 'Lỗi hệ thống khi check-out.' });
    }
});

// ===================== ADMIN API (role: ADMIN only) =====================

app.get('/api/admin/overview', requireAdmin, async (req, res) => {
    try {
        const [lots, usersCount, stats] = await Promise.all([
            parkingRepository.listLotsAdmin(),
            userRepository.countUsers(),
            ticketRepository.getAdminStats()
        ]);
        const totalSlots = lots.reduce((sum, l) => sum + l.totalSlots, 0);
        const availableSlots = lots.reduce((sum, l) => sum + l.availableSlots, 0);
        res.json({
            lotsCount: lots.length,
            totalSlots,
            availableSlots,
            usersCount,
            ...stats
        });
    } catch (err) {
        console.error('Lỗi khi tải tổng quan quản trị:', err);
        res.status(500).json({ message: 'Lỗi hệ thống.' });
    }
});

app.get('/api/admin/lots', requireAdmin, async (req, res) => {
    try {
        const lots = await parkingRepository.listLotsAdmin();
        res.json(lots);
    } catch (err) {
        console.error('Lỗi khi tải danh sách bãi xe (admin):', err);
        res.status(500).json({ message: 'Lỗi hệ thống.' });
    }
});

app.post('/api/admin/lots/:lotId/update', requireAdmin, async (req, res) => {
    const { status, pricePerHour } = req.body;
    try {
        const updated = await parkingRepository.updateLotAdmin(req.params.lotId, { status, pricePerHour });
        res.json({ id: updated.lot_code, status: updated.status, pricePerHour: updated.pricePerHour });
    } catch (err) {
        if (err.code === 'LOT_NOT_FOUND') {
            return res.status(404).json({ message: 'Bãi xe không tìm thấy.' });
        }
        console.error('Lỗi khi cập nhật bãi xe (admin):', err);
        res.status(500).json({ message: 'Lỗi hệ thống.' });
    }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const [users, assignments] = await Promise.all([
            userRepository.listUsers(),
            staffRepository.listAssignmentsAdmin()
        ]);
        res.json(users.map(u => ({ ...u, assignment: assignments[u.id] || null })));
    } catch (err) {
        console.error('Lỗi khi tải danh sách người dùng (admin):', err);
        res.status(500).json({ message: 'Lỗi hệ thống.' });
    }
});

app.post('/api/admin/users/:id/status', requireAdmin, async (req, res) => {
    const { status } = req.body;
    if (!['ACTIVE', 'INACTIVE'].includes(status)) {
        return res.status(400).json({ message: 'Trạng thái không hợp lệ.' });
    }
    if (req.params.id === req.userId && status === 'INACTIVE') {
        return res.status(400).json({ message: 'Không thể tự khóa tài khoản của chính mình.' });
    }
    try {
        const updated = await userRepository.updateUserStatus(req.params.id, status);
        res.json({ id: String(updated._id), status: updated.status });
    } catch (err) {
        if (err.code === 'USER_NOT_FOUND') {
            return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
        }
        console.error('Lỗi khi cập nhật trạng thái người dùng (admin):', err);
        res.status(500).json({ message: 'Lỗi hệ thống.' });
    }
});

app.get('/api/admin/tickets', requireAdmin, async (req, res) => {
    try {
        const tickets = await ticketRepository.listRecentForAdmin(50);
        res.json(tickets);
    } catch (err) {
        console.error('Lỗi khi tải danh sách vé (admin):', err);
        res.status(500).json({ message: 'Lỗi hệ thống.' });
    }
});

// ===================== PAGES =====================

app.get('/', async (req, res) => {
    const parkingLots = await parkingRepository.listLots();
    res.render('index', {
        title: 'Hệ thống SmartPark',
        parkingLots
    });
});

app.get('/login', (req, res) => {
    res.render('login', { title: 'Đăng Nhập - SmartPark' });
});

app.get('/staff/scan', (req, res) => {
    res.render('staffScan', { title: 'Quét Vé - SmartPark' });
});

app.get('/admin', (req, res) => {
    res.render('admin', { title: 'Quản Trị - SmartPark' });
});

app.get('/parking/:lotId', async (req, res) => {
    const lot = await parkingRepository.getLot(req.params.lotId);

    if (!lot) {
        return res.status(404).render('404', { message: 'Bãi xe không tìm thấy' });
    }

    res.render('parking', {
        title: `${lot.name} - SmartPark`,
        lotId: lot.id,
        lotName: lot.name,
        address: lot.address,
        totalSlots: lot.totalSlots,
        availableSlots: lot.availableSlots,
        pricePerHour: lot.pricePerHour,
        rating: lot.rating.toFixed(1),
        reviews: lot.reviews,
        zones: lot.zones,
        image: lot.image,
        amenities: lot.amenities
    });
});

app.get('/banking-qr', async (req, res) => {
    const code = req.query.code;
    if (!code) {
        return res.status(400).render('404', { message: 'Thiếu mã vé. Vui lòng đặt chỗ lại từ trang bãi xe.' });
    }

    const ticket = await ticketRepository.findByCode(code);
    if (!ticket) {
        return res.status(404).render('404', { message: 'Không tìm thấy vé đặt chỗ.' });
    }

    const formattedPrice = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(ticket.totalPrice);

    res.render('bankingQR', {
        ticket: stripInternal(ticket),
        bankName: BANK_INFO.bankName,
        accountNumber: BANK_INFO.accountNumber,
        accountHolder: BANK_INFO.accountHolder,
        memoContent: buildMemoContent(ticket.code),
        qrUrl: ticket.qrCodeUrl,
        formattedPrice
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
