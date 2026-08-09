const mongoose = require('mongoose');

// Matches the pre-existing shared `parkingspots` collection (2000+ real docs).
const parkingSpotSchema = new mongoose.Schema({
    lot_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingLotModel', required: true },
    spot_code: { type: String, required: true },
    zone: { type: String, required: true },
    allowed_type: { type: String, default: 'CAR' }, // CAR | MOTORBIKE
    status: { type: String, default: 'AVAILABLE' } // AVAILABLE | RESERVED | OCCUPIED
}, {
    timestamps: true
});

module.exports = mongoose.model('ParkingSpot', parkingSpotSchema, 'parkingspots');
