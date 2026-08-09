const mongoose = require('mongoose');

// Matches the pre-existing shared `zonestatuses` collection: a materialized
// available/total spot count per (lot, zone, vehicle_type), kept in sync
// whenever a spot's status changes.
const zoneStatusSchema = new mongoose.Schema({
    lot_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingLotModel', required: true },
    zone: { type: String, required: true },
    vehicle_type: { type: String, required: true },
    available_spots: { type: Number, required: true },
    total_spots: { type: Number, required: true },
    updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ZoneStatus', zoneStatusSchema, 'zonestatuses');
