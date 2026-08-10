const StaffAssignment = require('../models/StaffAssignment');
const Shift = require('../models/Shift');

// start_time/end_time are "HH:mm" 24h strings; end < start means the shift
// wraps past midnight (e.g. "22:00" -> "06:00").
function isWithinShift(shift, now = new Date()) {
    const [startH, startM] = shift.start_time.split(':').map(Number);
    const [endH, endM] = shift.end_time.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    if (startMinutes === endMinutes) return true; // full 24h shift
    if (startMinutes < endMinutes) {
        return nowMinutes >= startMinutes && nowMinutes < endMinutes;
    }
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

async function getAssignmentForUser(userId) {
    return StaffAssignment.findOne({ user_id: userId }).populate('shift_id');
}

// Verifies a staff member is allowed to check a ticket in/out right now:
// assigned to that exact lot+zone, and currently inside their shift window.
// Returns the assignment (shift populated) on success; throws a coded error
// otherwise. Callers should only invoke this for STAFF actors — ADMIN
// bypasses it entirely (see ticketRepository#checkIn/checkOut).
async function assertOnDuty(staffUserId, ticket) {
    const assignment = await getAssignmentForUser(staffUserId);
    if (!assignment) {
        const err = new Error('NOT_ASSIGNED');
        err.code = 'NOT_ASSIGNED';
        throw err;
    }
    if (String(assignment.lot_id) !== String(ticket.lot_id) || assignment.zone !== ticket.zone) {
        const err = new Error('WRONG_ZONE');
        err.code = 'WRONG_ZONE';
        err.assignedZone = assignment.zone;
        throw err;
    }
    if (!isWithinShift(assignment.shift_id)) {
        const err = new Error('OUTSIDE_SHIFT');
        err.code = 'OUTSIDE_SHIFT';
        err.shiftName = assignment.shift_id.name;
        throw err;
    }
    return assignment;
}

async function listShifts() {
    return Shift.find().sort({ start_time: 1 });
}

// Admin-facing roster keyed by user id: lot/zone/shift for every assigned
// staff member, for display alongside the user accounts screen.
async function listAssignmentsAdmin() {
    const rows = await StaffAssignment.find().populate('shift_id').populate('lot_id');
    const byUser = {};
    rows.forEach(r => {
        byUser[String(r.user_id)] = {
            lotName: r.lot_id ? r.lot_id.name : null,
            zone: r.zone,
            shiftName: r.shift_id ? r.shift_id.name : null,
            shiftStart: r.shift_id ? r.shift_id.start_time : null,
            shiftEnd: r.shift_id ? r.shift_id.end_time : null
        };
    });
    return byUser;
}

module.exports = { isWithinShift, getAssignmentForUser, assertOnDuty, listShifts, listAssignmentsAdmin };
