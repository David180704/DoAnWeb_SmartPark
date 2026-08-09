const Ticket = require('../models/Ticket');
const Transaction = require('../models/Transaction');
const ParkingSpot = require('../models/ParkingSpot');
const ParkingLotModel = require('../models/ParkingLotModel');
const Vehicle = require('../models/Vehicle');
const parkingRepository = require('./parkingRepository');
const userRepository = require('./userRepository');
const { buildQrUrl } = require('../utils/payment');

const BOOKING_WINDOW_MS = 30 * 60 * 1000; // hold the spot for 30 minutes to check in / pay

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

async function createTicket(userId, { lotId, spotCode, vehicleType, expectedHours }) {
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

module.exports = { createTicket, findByCode, findByUser, confirmPayment };
