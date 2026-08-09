const mongoose = require('mongoose');
const ParkingLotModel = require('../models/ParkingLotModel');
const ParkingSpot = require('../models/ParkingSpot');
const ZoneStatus = require('../models/ZoneStatus');
const { parkingLots: staticLots } = require('../models/parkingLot');
const { TTLCache } = require('../utils/cache');
const { buildSlotsForLot } = require('../utils/slotGenerator');

const cache = new TTLCache();
const fallbackSlotsByLot = new Map();

function isDbReady() {
    return mongoose.connection.readyState === 1;
}

function computeSummary(totalSlots, availableSlots) {
    const availabilityPercent = totalSlots > 0 ? Math.round((availableSlots / totalSlots) * 100) : 0;
    let status = 'Còn chỗ';
    if (availableSlots === 0) status = 'Hết chỗ';
    else if (availableSlots <= 5) status = 'Sắp hết';
    return { availabilityPercent, status };
}

function normalizeSpotStatus(status) {
    return String(status || 'AVAILABLE').toLowerCase();
}

async function availableCountForLot(lotObjectId) {
    const rows = await ZoneStatus.aggregate([
        { $match: { lot_id: lotObjectId } },
        { $group: { _id: null, available: { $sum: '$available_spots' } } }
    ]);
    return rows.length ? rows[0].available : 0;
}

function toPublicLot(doc, availableSlots) {
    const totalSlots = doc.totalSlots;
    const { availabilityPercent, status } = computeSummary(totalSlots, availableSlots);
    return {
        id: doc.lot_code,
        name: doc.name,
        address: doc.address,
        totalSlots,
        availableSlots,
        availabilityPercent,
        status,
        pricePerHour: doc.pricePerHour,
        image: doc.image,
        zones: doc.zones,
        amenities: doc.amenities,
        coords: { lat: doc.latitude, lng: doc.longitude },
        rating: doc.rating,
        reviews: doc.reviews
    };
}

// Fallback (no DB) slots are generated on first use with the same layout
// the seed script would produce, so the app still shows a real-looking
// grid when running without MongoDB configured.
function getFallbackSlots(lotId) {
    if (!fallbackSlotsByLot.has(lotId)) {
        const lot = staticLots.find(l => l.id === lotId);
        if (!lot) return null;
        fallbackSlotsByLot.set(lotId, buildSlotsForLot(lot));
    }
    return fallbackSlotsByLot.get(lotId);
}

function fallbackLotSummary(lot) {
    const slots = getFallbackSlots(lot.id);
    const availableSlots = slots.filter(s => s.status === 'available').length;
    const { availabilityPercent, status } = computeSummary(lot.totalSlots, availableSlots);
    return {
        id: lot.id,
        name: lot.name,
        address: lot.address,
        totalSlots: lot.totalSlots,
        availableSlots,
        availabilityPercent,
        status,
        pricePerHour: lot.pricePerHour,
        image: lot.image,
        zones: lot.zones,
        amenities: lot.amenities,
        coords: lot.coords,
        rating: lot.rating,
        reviews: lot.reviews
    };
}

async function listLots() {
    return cache.getOrSet('all', async () => {
        if (isDbReady()) {
            const docs = await ParkingLotModel.find();
            if (docs.length > 0) {
                return Promise.all(docs.map(async doc => {
                    const available = await availableCountForLot(doc._id);
                    return toPublicLot(doc, available);
                }));
            }
        }
        return staticLots.map(fallbackLotSummary);
    });
}

async function findLotDoc(lotCode) {
    if (!isDbReady()) return null;
    return ParkingLotModel.findOne({ lot_code: lotCode });
}

async function getLot(lotCode) {
    return cache.getOrSet(`lot:${lotCode}`, async () => {
        const doc = await findLotDoc(lotCode);
        if (doc) {
            const available = await availableCountForLot(doc._id);
            return toPublicLot(doc, available);
        }
        const lot = staticLots.find(l => l.id === lotCode);
        return lot ? fallbackLotSummary(lot) : null;
    });
}

async function getLotSlots(lotCode) {
    return cache.getOrSet(`slots:${lotCode}`, async () => {
        const doc = await findLotDoc(lotCode);
        if (doc) {
            const spots = await ParkingSpot.find({ lot_id: doc._id });
            return {
                lotId: lotCode,
                zones: doc.zones,
                slots: spots.map(s => ({ code: s.spot_code, zone: s.zone, status: normalizeSpotStatus(s.status) }))
            };
        }
        const lot = staticLots.find(l => l.id === lotCode);
        if (!lot) return null;
        const slots = getFallbackSlots(lotCode);
        return { lotId: lotCode, zones: lot.zones, slots };
    });
}

function invalidateLot(lotCode) {
    cache.invalidate('all');
    cache.invalidate(`lot:${lotCode}`);
    cache.invalidate(`slots:${lotCode}`);
}

// Moves a single spot (identified by lotCode + spotCode) from one of
// `fromStatuses` into `toStatus`, adjusting its zone's cached available
// count to match. Throws { code: 'SPOT_UNAVAILABLE' } if the spot isn't
// currently in one of the allowed source statuses.
async function transitionSpot(lotCode, spotCode, fromStatuses, toStatus) {
    if (isDbReady()) {
        const lotDoc = await findLotDoc(lotCode);
        if (!lotDoc) {
            const err = new Error('LOT_NOT_FOUND');
            err.code = 'LOT_NOT_FOUND';
            throw err;
        }
        const spot = await ParkingSpot.findOne({ lot_id: lotDoc._id, spot_code: spotCode });
        if (!spot || !fromStatuses.includes(spot.status)) {
            const err = new Error('SPOT_UNAVAILABLE');
            err.code = 'SPOT_UNAVAILABLE';
            err.spot = spotCode;
            throw err;
        }

        const wasAvailable = spot.status === 'AVAILABLE';
        spot.status = toStatus;
        await spot.save();

        const nowAvailable = toStatus === 'AVAILABLE';
        const delta = wasAvailable === nowAvailable ? 0 : (nowAvailable ? 1 : -1);
        if (delta !== 0) {
            await ZoneStatus.updateOne(
                { lot_id: lotDoc._id, zone: spot.zone, vehicle_type: spot.allowed_type },
                { $inc: { available_spots: delta }, $set: { updated_at: new Date() } }
            );
        }

        invalidateLot(lotCode);
        return spot;
    }

    const slots = getFallbackSlots(lotCode);
    if (!slots) {
        const err = new Error('LOT_NOT_FOUND');
        err.code = 'LOT_NOT_FOUND';
        throw err;
    }
    const slot = slots.find(s => s.code === spotCode);
    const fromStatusesLower = fromStatuses.map(s => s.toLowerCase());
    if (!slot || !fromStatusesLower.includes(slot.status)) {
        const err = new Error('SPOT_UNAVAILABLE');
        err.code = 'SPOT_UNAVAILABLE';
        err.spot = spotCode;
        throw err;
    }
    slot.status = toStatus.toLowerCase();
    invalidateLot(lotCode);
    return slot;
}

const reserveSpot = (lotCode, spotCode) => transitionSpot(lotCode, spotCode, ['AVAILABLE'], 'RESERVED');
const occupySpot = (lotCode, spotCode) => transitionSpot(lotCode, spotCode, ['RESERVED', 'AVAILABLE'], 'OCCUPIED');
const releaseSpot = (lotCode, spotCode) => transitionSpot(lotCode, spotCode, ['RESERVED', 'OCCUPIED'], 'AVAILABLE');

module.exports = {
    listLots,
    getLot,
    getLotSlots,
    findLotDoc,
    reserveSpot,
    occupySpot,
    releaseSpot,
    invalidateLot
};
