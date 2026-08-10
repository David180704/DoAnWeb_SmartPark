const ParkingLotModel = require('../models/ParkingLotModel');
const ParkingSpot = require('../models/ParkingSpot');
const ZoneStatus = require('../models/ZoneStatus');
const { TTLCache } = require('../utils/cache');

const cache = new TTLCache();

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

// zonestatuses.total_spots reflects the real number of seeded parkingspots
// per zone, which can differ from the parkinglots.totalSlots field (that
// one drifted out of sync with the actual spot inventory for a few lots)
// — so total/available are both derived from here, the real source of
// truth, instead of trusting the lot document's own stored total.
async function spotCountsForLot(lotObjectId) {
    const rows = await ZoneStatus.aggregate([
        { $match: { lot_id: lotObjectId } },
        { $group: { _id: null, available: { $sum: '$available_spots' }, total: { $sum: '$total_spots' } } }
    ]);
    return rows.length ? { available: rows[0].available, total: rows[0].total } : { available: 0, total: 0 };
}

function toPublicLot(doc, availableSlots, totalSlots) {
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

async function listLots() {
    return cache.getOrSet('all', async () => {
        const docs = await ParkingLotModel.find();
        return Promise.all(docs.map(async doc => {
            const { available, total } = await spotCountsForLot(doc._id);
            return toPublicLot(doc, available, total);
        }));
    });
}

async function findLotDoc(lotCode) {
    return ParkingLotModel.findOne({ lot_code: lotCode });
}

async function getLot(lotCode) {
    return cache.getOrSet(`lot:${lotCode}`, async () => {
        const doc = await findLotDoc(lotCode);
        if (!doc) return null;
        const { available, total } = await spotCountsForLot(doc._id);
        return toPublicLot(doc, available, total);
    });
}

async function getLotSlots(lotCode) {
    return cache.getOrSet(`slots:${lotCode}`, async () => {
        const doc = await findLotDoc(lotCode);
        if (!doc) return null;
        const spots = await ParkingSpot.find({ lot_id: doc._id });
        return {
            lotId: lotCode,
            zones: doc.zones,
            slots: spots.map(s => ({ code: s.spot_code, zone: s.zone, status: normalizeSpotStatus(s.status) }))
        };
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
