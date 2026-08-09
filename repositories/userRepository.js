const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Vehicle = require('../models/Vehicle');

function isDbReady() {
    return mongoose.connection.readyState === 1;
}

// In-memory fallback store, only used when MongoDB is unreachable.
const fallbackUsers = [
    {
        id: 'user-default',
        full_name: 'Nguyễn Hoàng Long',
        phone: '0909123456',
        email: 'long.nguyen@smartpark.vn',
        password: bcrypt.hashSync('123456', 10)
    }
];
const fallbackVehicles = [
    { id: 'vehicle-default', user_id: 'user-default', license_plate: '30F-12345', is_default: true }
];

function toPublic(user, vehicle) {
    return {
        id: String(user.id || user._id),
        fullName: user.full_name,
        phone: user.phone,
        email: user.email,
        licensePlate: vehicle ? vehicle.license_plate : null
    };
}

async function getDefaultVehicle(userId) {
    if (isDbReady()) {
        return Vehicle.findOne({ user_id: userId, is_default: true }) || Vehicle.findOne({ user_id: userId });
    }
    return fallbackVehicles.find(v => v.user_id === userId) || null;
}

async function findByPhone(phone) {
    if (isDbReady()) {
        return User.findOne({ phone });
    }
    return fallbackUsers.find(u => u.phone === phone) || null;
}

async function findById(id) {
    if (isDbReady()) {
        return User.findById(id);
    }
    return fallbackUsers.find(u => u.id === id) || null;
}

async function createUser({ fullName, phone, email, licensePlate, password }) {
    const hashed = bcrypt.hashSync(password, 10);
    const plate = licensePlate.toUpperCase().trim();

    if (isDbReady()) {
        const user = await User.create({
            username: phone,
            password: hashed,
            phone,
            full_name: fullName,
            email,
            role: 'CUSTOMER',
            status: 'ACTIVE'
        });
        try {
            const vehicle = await Vehicle.create({
                user_id: user._id,
                license_plate: plate,
                vehicle_type: 'CAR',
                is_default: true
            });
            return { user, vehicle };
        } catch (vehicleErr) {
            await User.deleteOne({ _id: user._id });
            if (vehicleErr.code === 11000) {
                const err = new Error('PLATE_TAKEN');
                err.code = 'PLATE_TAKEN';
                throw err;
            }
            throw vehicleErr;
        }
    }

    const user = {
        id: 'user-' + Math.random().toString(36).slice(2, 11),
        full_name: fullName,
        phone,
        email,
        password: hashed
    };
    fallbackUsers.push(user);
    const vehicle = { id: 'vehicle-' + Math.random().toString(36).slice(2, 11), user_id: user.id, license_plate: plate, is_default: true };
    fallbackVehicles.push(vehicle);
    return { user, vehicle };
}

function verifyPassword(plain, hash) {
    return bcrypt.compareSync(plain, hash);
}

module.exports = { findByPhone, findById, createUser, verifyPassword, toPublic, getDefaultVehicle, isDbReady };
