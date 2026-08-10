const Ticket = require('../models/Ticket');
const Transaction = require('../models/Transaction');
const ParkingSpot = require('../models/ParkingSpot');
const ParkingLotModel = require('../models/ParkingLotModel');
const Vehicle = require('../models/Vehicle');
const User = require('../models/User');
const parkingRepository = require('./parkingRepository');
const userRepository = require('./userRepository');
const { buildQrUrl } = require('../utils/payment');

const BOOKING_WINDOW_MS = 5 * 60 * 1000; // hold the spot for 5 minutes to pay before auto-cancelling

function generateTicketCode() {
    return 'TK' + Math.random().toString(36).slice(2, 12).toUpperCase();
}

function toPublicTicket(ticket, lot, transaction) {
    return {
        code: ticket.ticket_code,
        lotId: lot ? lot.id : ticket.lotId,
        lotName: lot ? lot.name : ticket.lotName,
        lotAddress: lot ? lot.address : ticket.lotAddress,
        spot: ticket.spotCode,
        zone: ticket.zone,
        vehiclePlate: ticket.vehiclePlate,
        vehicleType: ticket.vehicle_type,
        bookingTime: ticket.booking_time,
        bookingExpiredAt: ticket.booking_expired_at,
        checkInTime: ticket.check_in_time,
        expectedHours: ticket.expected_hours,
        status: ticket.status,
        totalPrice: transaction ? transaction.total_amount : null,
        paymentStatus: transaction ? transaction.payment_status : 'PENDING',
        qrCodeUrl: transaction ? transaction.qr_code_url : null
    };
}

// Fair-use rule: one in-flight booking per customer at a time (not yet
// checked out). Keeps a single account from holding several spots while
// demand is high. NOTE: VIP/priority accounts could later be exempted
// here by checking the user's role/tier before enforcing this.
async function assertNoActiveTicket(userId) {
    const existing = await Ticket.findOne({ user_id: userId, status: { $in: ['PENDING', 'ACTIVE'] } });
    if (existing) {
        const err = new Error('ALREADY_HAS_ACTIVE_TICKET');
        err.code = 'ALREADY_HAS_ACTIVE_TICKET';
        err.ticketCode = existing.ticket_code;
        throw err;
    }
}

async function createTicket(userId, { lotId, spotCode, vehicleType, expectedHours }) {
    await assertNoActiveTicket(userId);

    const lot = await parkingRepository.getLot(lotId);
    if (!lot) {
        const err = new Error('LOT_NOT_FOUND');
        err.code = 'LOT_NOT_FOUND';
        throw err;
    }

    const vehicle = await userRepository.getDefaultVehicle(userId);
    if (!vehicle) {
        const err = new Error('NO_VEHICLE');
        err.code = 'NO_VEHICLE';
        throw err;
    }

    // Only ever reserves a spot that is currently AVAILABLE; throws
    // SPOT_UNAVAILABLE otherwise, so a ticket can't be created for a
    // spot someone else already holds.
    const spot = await parkingRepository.reserveSpot(lotId, spotCode);
    const lotDoc = await parkingRepository.findLotDoc(lotId);

    const ticketCode = generateTicketCode();
    const now = new Date();
    const expiredAt = new Date(now.getTime() + BOOKING_WINDOW_MS);
    const totalPrice = Math.round(lot.pricePerHour * expectedHours);

    let ticket;
    try {
        ticket = await Ticket.create({
            ticket_code: ticketCode,
            lot_id: lotDoc._id,
            user_id: userId,
            vehicle_id: vehicle._id,
            zone: spot.zone,
            vehicle_type: vehicleType || vehicle.vehicle_type || 'CAR',
            spot_id: spot._id,
            booking_time: now,
            check_in_time: now,
            booking_expired_at: expiredAt,
            expected_hours: expectedHours,
            status: 'PENDING'
        });
    } catch (ticketErr) {
        await parkingRepository.releaseSpot(lotId, spotCode);
        throw ticketErr;
    }

    const transaction = await Transaction.create({
        ticket_id: ticket._id,
        standard_fee: totalPrice,
        overtime_fee: 0,
        towing_fee: 0,
        total_amount: totalPrice,
        payment_status: 'PENDING',
        qr_code_url: buildQrUrl(ticketCode, totalPrice),
        qr_expired_at: expiredAt
    });

    return toPublicTicket(
        { ...ticket.toObject(), vehiclePlate: vehicle.license_plate, spotCode: spot.spot_code },
        lot,
        transaction
    );
}

async function findByCode(ticketCode, userId) {
    const ticket = await Ticket.findOne({ ticket_code: ticketCode });
    if (!ticket || (userId && String(ticket.user_id) !== String(userId))) return null;

    const [lot, spot, vehicle, transaction] = await Promise.all([
        ParkingLotModel.findById(ticket.lot_id),
        ParkingSpot.findById(ticket.spot_id),
        Vehicle.findById(ticket.vehicle_id),
        Transaction.findOne({ ticket_id: ticket._id })
    ]);

    const publicLot = lot ? await parkingRepository.getLot(lot.lot_code) : null;
    return {
        ...toPublicTicket(
            { ...ticket.toObject(), spotCode: spot ? spot.spot_code : null, vehiclePlate: vehicle ? vehicle.license_plate : null },
            publicLot,
            transaction
        ),
        _ticketDoc: ticket,
        _transactionDoc: transaction
    };
}

async function findByUser(userId) {
    const tickets = await Ticket.find({ user_id: userId }).sort({ createdAt: -1 });
    const results = await Promise.all(tickets.map(async ticket => {
        const [lot, spot, vehicle, transaction] = await Promise.all([
            ParkingLotModel.findById(ticket.lot_id),
            ParkingSpot.findById(ticket.spot_id),
            Vehicle.findById(ticket.vehicle_id),
            Transaction.findOne({ ticket_id: ticket._id })
        ]);
        const publicLot = lot ? { id: lot.lot_code, name: lot.name, address: lot.address } : null;
        return toPublicTicket(
            { ...ticket.toObject(), spotCode: spot ? spot.spot_code : null, vehiclePlate: vehicle ? vehicle.license_plate : null },
            publicLot,
            transaction
        );
    }));

    return {
        current: results.filter(t => t.status === 'PENDING' || t.status === 'ACTIVE'),
        history: results.filter(t => t.status === 'COMPLETED' || t.status === 'CANCELLED')
    };
}

async function confirmPayment(ticketCode, userId) {
    const found = await findByCode(ticketCode, userId);
    if (!found) return null;

    if (found.status !== 'PENDING' || found.paymentStatus === 'SUCCESS') {
        const err = new Error('ALREADY_PROCESSED');
        err.code = 'ALREADY_PROCESSED';
        throw err;
    }

    const ticket = found._ticketDoc;
    const lot = await ParkingLotModel.findById(ticket.lot_id);
    const spot = await ParkingSpot.findById(ticket.spot_id);

    await parkingRepository.occupySpot(lot.lot_code, spot.spot_code);

    ticket.status = 'ACTIVE';
    await ticket.save();

    const transaction = found._transactionDoc;
    transaction.payment_status = 'SUCCESS';
    transaction.paid_at = new Date();
    await transaction.save();

    const publicLot = await parkingRepository.getLot(lot.lot_code);
    return toPublicTicket(
        { ...ticket.toObject(), spotCode: spot.spot_code, vehiclePlate: found.vehiclePlate },
        publicLot,
        transaction
    );
}

// Called from the bank webhook. `suffix` is the 6-char tag extracted from
// the transfer content (matches the end of a ticket_code, see
// utils/payment.js#buildMemoContent). Only matches a still-PENDING ticket,
// and refuses to confirm if the transferred amount doesn't match what was
// owed, so a mistyped/partial transfer can't mark a ticket as paid.
async function confirmPaymentByMemo(suffix, amount) {
    const ticket = await Ticket.findOne({ ticket_code: new RegExp(suffix + '$', 'i'), status: 'PENDING' });
    if (!ticket) return { matched: false, reason: 'NO_PENDING_TICKET' };

    const transaction = await Transaction.findOne({ ticket_id: ticket._id });
    if (!transaction || transaction.payment_status === 'SUCCESS') {
        return { matched: false, reason: 'ALREADY_PAID' };
    }
    if (amount != null && Number(amount) !== transaction.total_amount) {
        return { matched: false, reason: 'AMOUNT_MISMATCH', ticketCode: ticket.ticket_code, expected: transaction.total_amount, received: amount };
    }

    const updated = await confirmPayment(ticket.ticket_code);
    return { matched: true, ticket: updated };
}

// Staff-facing lookup: same as findByCode with no ownership check, plus
// the customer's name/phone so front-desk staff can identify the driver.
async function findForStaff(ticketCode) {
    const found = await findByCode(ticketCode);
    if (!found) return null;

    const user = await User.findById(found._ticketDoc.user_id);
    return {
        ...found,
        customerName: user ? user.full_name : null,
        customerPhone: user ? user.phone : null
    };
}

async function checkIn(ticketCode) {
    const found = await findByCode(ticketCode);
    if (!found) return null;
    if (found.status !== 'ACTIVE') {
        const err = new Error('NOT_PAID');
        err.code = 'NOT_PAID';
        throw err;
    }

    const ticket = found._ticketDoc;
    ticket.check_in_time = new Date();
    await ticket.save();

    return { ...found, checkInTime: ticket.check_in_time };
}

async function checkOut(ticketCode) {
    const found = await findByCode(ticketCode);
    if (!found) return null;
    if (found.status !== 'ACTIVE') {
        const err = new Error('NOT_ACTIVE');
        err.code = 'NOT_ACTIVE';
        throw err;
    }

    const ticket = found._ticketDoc;
    const checkOutTime = new Date();
    const checkInTime = ticket.check_in_time || ticket.booking_time;
    const actualMinutes = Math.round((checkOutTime - checkInTime) / 60000);
    const overtimeMinutes = Math.max(0, actualMinutes - ticket.expected_hours * 60);

    ticket.check_out_time = checkOutTime;
    ticket.overtime_minutes = overtimeMinutes;
    ticket.status = 'COMPLETED';
    await ticket.save();

    const lot = await ParkingLotModel.findById(ticket.lot_id);
    const spot = await ParkingSpot.findById(ticket.spot_id);
    await parkingRepository.releaseSpot(lot.lot_code, spot.spot_code);

    return { ...found, status: 'COMPLETED', checkOutTime, overtimeMinutes };
}

// Auto-cancels any PENDING ticket whose 5-minute payment window has
// passed: releases its spot back to AVAILABLE, marks the ticket
// CANCELLED and the transaction FAILED. Run on a timer from server.js.
async function cancelExpiredTickets() {
    const expired = await Ticket.find({ status: 'PENDING', booking_expired_at: { $lt: new Date() } });

    for (const ticket of expired) {
        try {
            const spot = await ParkingSpot.findById(ticket.spot_id);
            const lot = await ParkingLotModel.findById(ticket.lot_id);
            if (spot && lot && spot.status !== 'AVAILABLE') {
                await parkingRepository.releaseSpot(lot.lot_code, spot.spot_code);
            }

            ticket.status = 'CANCELLED';
            await ticket.save();

            await Transaction.updateOne(
                { ticket_id: ticket._id, payment_status: 'PENDING' },
                { $set: { payment_status: 'FAILED' } }
            );

            console.log(`Auto-cancelled expired ticket ${ticket.ticket_code} (unpaid after 5 min).`);
        } catch (err) {
            console.error(`Failed to auto-cancel ticket ${ticket.ticket_code}:`, err.message);
        }
    }

    return expired.length;
}

module.exports = { createTicket, findByCode, findByUser, confirmPayment, confirmPaymentByMemo, findForStaff, checkIn, checkOut, cancelExpiredTickets };
