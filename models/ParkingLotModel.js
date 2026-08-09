const mongoose = require('mongoose');

// Matches the pre-existing shared `parkinglots` collection.
const parkingLotSchema = new mongoose.Schema({
    lot_code: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true },
    address: { type: String, required: true },
    totalSlots: { type: Number, required: true },
    pricePerHour: { type: Number, required: true },
    image: { type: String, required: true },
    zones: { type: [String], default: [] },
    amenities: { type: [String], default: [] },
    latitude: { type: Number },
    longitude: { type: Number },
    rating: { type: Number, default: 4.5 },
    reviews: { type: Number, default: 0 },
    status: { type: String, default: 'ACTIVE' }
}, {
    timestamps: true
});

module.exports = mongoose.model('ParkingLotModel', parkingLotSchema, 'parkinglots');
