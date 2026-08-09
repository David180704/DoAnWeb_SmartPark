// Builds an evenly-distributed slot grid for a parking lot, marking the
// first `availableSlots` of them as available and the rest as occupied.
// Shared by the DB seed script and the in-memory fallback repository so
// both produce the same slot codes/layout for a given lot.
function buildSlotsForLot(lot) {
    const zones = lot.zones && lot.zones.length ? lot.zones : ['A'];
    const slots = [];
    for (let i = 0; i < lot.totalSlots; i++) {
        const zone = zones[i % zones.length];
        const seq = Math.floor(i / zones.length) + 1;
        slots.push({
            code: `${zone}-${String(seq).padStart(2, '0')}`,
            zone,
            status: i < lot.availableSlots ? 'available' : 'occupied'
        });
    }
    return slots;
}

module.exports = { buildSlotsForLot };
