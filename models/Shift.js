const mongoose = require('mongoose');

// A reusable work-shift template (e.g. "Ca sáng" 06:00-14:00). start_time/
// end_time are "HH:mm" 24h strings; end < start means the shift wraps past
// midnight (e.g. "22:00" -> "06:00").
const shiftSchema = new mongoose.Schema({
    name: { type: String, required: true },
    start_time: { type: String, required: true },
    end_time: { type: String, required: true }
}, {
    timestamps: true
});

module.exports = mongoose.model('Shift', shiftSchema, 'shifts');
