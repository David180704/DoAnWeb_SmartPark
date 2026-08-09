const mongoose = require('mongoose');

// Matches the pre-existing shared `tickets` collection. A ticket is created
// when a customer reserves a spot on the web (booking_time/expected_hours
// set, check_in/check_out left empty) and is later updated by the physical
// gate/staff flow when the car actually arrives and leaves.
const ticketSchema = new mongoose.Schema({
    ticket_code: { type: String, required: true, unique: true },
    lot_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingLotModel', required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    vehicle_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    zone: { type: String, required: true },
    vehicle_type: { type: String, default: 'CAR' },
    spot_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingSpot', required: true },
    booking_time: { type: Date, required: true },
    booking_expired_at: { type: Date, required: true },
    expected_hours: { type: Number, required: true },
    check_in_time: { type: Date },
    check_out_time: { type: Date },
    shift_in_id: { type: mongoose.Schema.Types.ObjectId },
    shift_out_id: { type: mongoose.Schema.Types.ObjectId },
    overtime_minutes: { type: Number, default: 0 },
    agreed_relocation_policy: { type: Boolean, default: true },
    status: { type: String, default: 'PENDING' } // PENDING | ACTIVE | COMPLETED | CANCELLED
}, {
    timestamps: true
});

module.exports = mongoose.model('Ticket', ticketSchema, 'tickets');
