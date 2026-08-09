const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const { requireAuth } = require('./middleware/auth');
const { signUserToken } = require('./utils/jwt');
const { BANK_INFO, buildMemoContent } = require('./utils/payment');
const userRepository = require('./repositories/userRepository');
const parkingRepository = require('./repositories/parkingRepository');
const ticketRepository = require('./repositories/ticketRepository');

const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI)
        .catch(err => {
            console.error('Database connection failed. Using in-memory fallback data.', err.message);
        });
} else {
    console.warn('MONGODB_URI is not set. Using in-memory fallback data.');
}

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
        if (err.code === 'SPOT_UNAVAILABLE') {
            return res.status(409).json({ message: 'Chỗ này vừa được người khác đặt. Vui lòng chọn chỗ khác.' });
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
