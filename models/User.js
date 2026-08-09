const mongoose = require('mongoose');

// Matches the pre-existing shared `users` collection in Atlas (created by
// another SmartPark backend service). Field names and indexes intentionally
// mirror that collection so this app reads/writes compatible documents.
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    phone: { type: String, required: true, unique: true, trim: true },
    full_name: { type: String, required: true, trim: true },
    email: { type: String, trim: true },
    role: { type: String, default: 'CUSTOMER' }, // ADMIN | CUSTOMER | STAFF
    status: { type: String, default: 'ACTIVE' }
}, {
    timestamps: true
});

module.exports = mongoose.model('User', userSchema, 'users');
