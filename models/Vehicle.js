const mongoose = require('mongoose');

// Matches the pre-existing shared `vehicles` collection.
const vehicleSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    license_plate: { type: String, required: true, unique: true, trim: true, uppercase: true },
    vehicle_type: { type: String, default: 'CAR' }, // CAR | MOTORBIKE
    is_default: { type: Boolean, default: true }
}, {
    timestamps: true
});

module.exports = mongoose.model('Vehicle', vehicleSchema, 'vehicles');
