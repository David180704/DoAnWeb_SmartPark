const mongoose = require('mongoose');

// Matches the pre-existing shared `transactions` collection.
const transactionSchema = new mongoose.Schema({
    ticket_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
    standard_fee: { type: Number, required: true },
    overtime_fee: { type: Number, default: 0 },
    towing_fee: { type: Number, default: 0 },
    total_amount: { type: Number, required: true },
    payment_status: { type: String, default: 'PENDING' }, // PENDING | SUCCESS | FAILED
    qr_code_url: { type: String },
    qr_expired_at: { type: Date },
    paid_at: { type: Date }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: false }
});

module.exports = mongoose.model('Transaction', transactionSchema, 'transactions');
