const mongoose = require('mongoose');

// The "bảng nhân viên" (staff roster) — one row per STAFF-role user, pinning
// them to the single zone they're allowed to check tickets in and the shift
// window they're allowed to work it during. Kept separate from `users` so a
// staff account can exist without an assignment yet (rejected at check-in/
// out with a clear message instead of failing to log in).
const staffAssignmentSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    lot_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingLotModel', required: true },
    zone: { type: String, required: true },
    shift_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', required: true }
}, {
    timestamps: true
});

module.exports = mongoose.model('StaffAssignment', staffAssignmentSchema, 'staffassignments');
