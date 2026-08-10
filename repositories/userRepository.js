const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Vehicle = require('../models/Vehicle');

function toPublic(user, vehicle) {
    return {
        id: String(user.id || user._id),
        fullName: user.full_name,
        phone: user.phone,
        email: user.email,
        licensePlate: vehicle ? vehicle.license_plate : null,
        role: user.role
    };
}

async function getDefaultVehicle(userId) {
    return (await Vehicle.findOne({ user_id: userId, is_default: true })) || Vehicle.findOne({ user_id: userId });
}

async function findByPhone(phone) {
    return User.findOne({ phone });
}

async function findById(id) {
    return User.findById(id);
}

// Strips dashes/dots/spaces so "51H-123.45" and "51H 123 45" normalize to
// the same canonical string as "51H12345" — otherwise the unique index on
// license_plate could be bypassed by formatting the same physical plate
// differently.
function normalizePlate(licensePlate) {
    const plate = String(licensePlate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!plate) {
        const err = new Error('INVALID_PLATE');
        err.code = 'INVALID_PLATE';
        throw err;
    }
    return plate;
}

async function createUser({ fullName, phone, email, licensePlate, password }) {
    const hashed = bcrypt.hashSync(password, 10);
    const plate = normalizePlate(licensePlate);

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

function verifyPassword(plain, hash) {
    return bcrypt.compareSync(plain, hash);
}

module.exports = { findByPhone, findById, createUser, verifyPassword, toPublic, getDefaultVehicle };
