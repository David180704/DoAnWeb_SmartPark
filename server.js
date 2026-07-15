const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

const { parkingLots } = require('./models/parkingLot');
const User = require('./models/User');

let isDatabaseConnected = false;

const usersFallback = [
    {
        id: 'user-default',
        fullName: 'Nguyễn Hoàng Long',
        phone: '0909123456',
        email: 'long.nguyen@smartpark.vn',
        licensePlate: '30F-123.45',
        password: bcrypt.hashSync('123456', 10)
    }
];

const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI)
        .then(async () => {
            isDatabaseConnected = true;
            try {
                const count = await User.countDocuments();
                if (count === 0) {
                    await User.create({
                        fullName: 'Nguyễn Hoàng Long',
                        phone: '0909123456',
                        email: 'long.nguyen@smartpark.vn',
                        licensePlate: '30F-123.45',
                        password: bcrypt.hashSync('123456', 10)
                    });
                }
            } catch (seedErr) {
                console.error('Seed error:', seedErr.message);
            }
        })
        .catch(err => {
            console.error('Database connection failed. Using fallback.', err.message);
        });
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

function getParkingLotById(id) {
    return parkingLots.find(lot => lot.id === id);
}

// REGISTER API
app.post('/api/auth/register', async (req, res) => {
    const { fullName, phone, email, licensePlate, password } = req.body;
    
    if (!fullName || !phone || !email || !licensePlate || !password) {
        return res.status(400).json({ message: 'Vui lòng điền đầy đủ tất cả các thông tin đăng ký.' });
    }
    
    if (isDatabaseConnected) {
        try {
            const existingUser = await User.findOne({ phone });
            if (existingUser) {
                return res.status(400).json({ message: 'Số điện thoại này đã được đăng ký trên hệ thống.' });
            }
            
            const newUser = await User.create({
                fullName,
                phone,
                email,
                licensePlate: licensePlate.toUpperCase(),
                password: bcrypt.hashSync(password, 10)
            });
            
            const userResponse = {
                id: newUser._id,
                fullName: newUser.fullName,
                phone: newUser.phone,
                email: newUser.email,
                licensePlate: newUser.licensePlate
            };
            return res.json(userResponse);
        } catch (dbErr) {
            console.error('Lỗi khi đăng ký vào MongoDB:', dbErr);
            return res.status(500).json({ message: 'Lỗi cơ sở dữ liệu MongoDB khi đăng ký.' });
        }
    } else {
        // Fallback sử dụng Local In-Memory
        const existingUser = usersFallback.find(u => u.phone === phone);
        if (existingUser) {
            return res.status(400).json({ message: 'Số điện thoại này đã được đăng ký trên hệ thống.' });
        }
        
        const newUser = {
            id: 'user-' + Math.random().toString(36).substr(2, 9),
            fullName,
            phone,
            email,
            licensePlate: licensePlate.toUpperCase(),
            password: bcrypt.hashSync(password, 10)
        };
        
        usersFallback.push(newUser);
        const { password: _, ...userResponse } = newUser;
        return res.json(userResponse);
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { phone, password } = req.body;
    
    if (!phone || !password) {
        return res.status(400).json({ message: 'Vui lòng nhập số điện thoại và mật khẩu.' });
    }
    
    if (isDatabaseConnected) {
        try {
            const user = await User.findOne({ phone });
            if (!user || !bcrypt.compareSync(password, user.password)) {
                return res.status(400).json({ message: 'Số điện thoại hoặc mật khẩu không chính xác.' });
            }
            
            const userResponse = {
                id: user._id,
                fullName: user.fullName,
                phone: user.phone,
                email: user.email,
                licensePlate: user.licensePlate
            };
            return res.json(userResponse);
        } catch (dbErr) {
            console.error(dbErr);
            return res.status(500).json({ message: 'Database error.' });
        }
    } else {
        const user = usersFallback.find(u => u.phone === phone);
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(400).json({ message: 'Số điện thoại hoặc mật khẩu không chính xác.' });
        }
        
        const { password: _, ...userResponse } = user;
        return res.json(userResponse);
    }
});

app.get('/', (req, res) => {
    res.render('index', { 
        title: 'Hệ thống SmartPark',
        parkingLots: parkingLots 
    });
});

app.get('/login', (req, res) => {
    res.render('login', { title: 'Đăng Nhập - SmartPark' });
});

app.get('/parking/:lotId', (req, res) => {
    const lot = getParkingLotById(req.params.lotId);
    
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

app.get('/api/parking-lots', (req, res) => {
    res.json(parkingLots);
});

app.get('/api/parking-lots/:lotId', (req, res) => {
    const lot = getParkingLotById(req.params.lotId);
    if (!lot) {
        return res.status(404).json({ error: 'Bãi xe không tìm thấy' });
    }
    res.json(lot);
});

app.get('/checkout', (req, res) => {
    let spot = req.query.spot || req.query.slots;
    if (Array.isArray(spot)) {
        spot = spot.join(', ');
    } else if (typeof spot === 'string') {
        // ok
    } else {
        spot = 'Chưa chọn';
    }
    
    const price = req.query.price || req.query.totalPrice || '0';
    res.render('checkout', { spot, price });
});

app.get('/banking-qr', (req, res) => {
    const booking = {
        id: req.query.id || 'BOOK' + Math.random().toString(36).slice(2,10).toUpperCase(),
        totalPrice: Number(req.query.amount) || 150000
    };

    const bankName = 'Vietcombank (VCB)';
    const accountNumber = '1018827182738';
    const accountHolder = 'CONG TY CO PHAN DO XE THONG MINH SMARTPARK VIETNAM';
    const memoContent = `PARK${booking.id.slice(-6).toUpperCase()}`;
    const binCode = '970436';
    const qrUrl = `https://api.vietqr.io/image/${binCode}-${accountNumber}-compact.jpg?accountName=${encodeURIComponent(accountHolder)}&amount=${booking.totalPrice}&addInfo=${encodeURIComponent(memoContent)}`;
    const formattedPrice = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(booking.totalPrice);

    res.render('bankingQR', {
        booking,
        bankName,
        accountNumber,
        accountHolder,
        memoContent,
        qrUrl,
        formattedPrice
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});