// models/parkingLot.js

class ParkingLot {
  constructor(id, name, address, totalSlots, availableSlots, pricePerHour, image, zones = [], amenities = [], coords = { lat: 10.776, lng: 106.664 }, rating = null, reviews = null) {
    this.id = id;
    this.name = name;
         this.address = address;
    this.totalSlots = totalSlots;
    this.availableSlots = availableSlots;
        this.pricePerHour = pricePerHour;
    this.image = image;
    this.zones = zones;
     this.amenities = amenities;
    this.coords = coords;
    this.rating = rating || Number((4.2 + Math.random() * 0.8).toFixed(1));
       this.reviews = reviews || Math.floor(Math.random() * 250) + 40;
  }

  getAvailabilityPercent() {
    return Math.round((this.availableSlots / this.totalSlots) * 100);
  }

      getStatus() {
    if (this.availableSlots === 0) return 'Hết chỗ';
    if (this.availableSlots <= 5) return 'Sắp hết';
    return 'Còn chỗ';
  }
}


const parkingLots = [
  new ParkingLot(
    'khu-a',
    'Khu A - Tầng Trệt (Gần Cổng)',
    '828 Sư Vạn Hạnh, P.13, Q.10, TP.HCM',
    150,
    45,
    15000,
    'https://images.unsplash.com/photo-1594051808233-e53957a02299?auto=format&fit=crop&q=80&w=600',
    ['A1', 'A2', 'A3', 'A4'],
    ['cctv', 'covered', 'ev_charging'],
    { lat: 10.7765, lng: 106.6645 },
    4.8,
    182
  ),


  new ParkingLot(
    'khu-b',
    'Khu B - Tầng Hầm B1',
    '828 Sư Vạn Hạnh, P.13, Q.10, TP.HCM',
    200,
    12,
    20000,
    'https://images.unsplash.com/photo-1590674899484-d5640e854abe?auto=format&fit=crop&q=80&w=600',
    ['B1', 'B2', 'B3'],
    ['cctv', 'covered'],
    { lat: 10.7758, lng: 106.6652 },
    4.5,
    215
  ),

  new ParkingLot(
    'khu-c',
    'Khu C - Tầng Hầm B2 (Dài Hạn)',
    '828 Sư Vạn Hạnh, P.13, Q.10, TP.HCM',
    300,
    125,
    12000,
    'https://images.unsplash.com/photo-1621905252507-b354bc25edac?auto=format&fit=crop&q=80&w=600',
    ['C1', 'C2', 'C3', 'C4'],
    ['covered', 'monthly'],
    { lat: 10.7762, lng: 106.6637 },
    4.2,
    98
  ),


  new ParkingLot(
    'khu-d',
    'Khu D - Tầng Lửng',
    '828 Sư Vạn Hạnh, P.13, Q.10, TP.HCM',
    100,
    8,
    18000,
    'https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?auto=format&fit=crop&q=80&w=600',
    ['D1', 'D2'],
    ['cctv', 'monthly'],
    { lat: 10.7770, lng: 106.6640 },
    4.3,
    57
  ),

  new ParkingLot(
    'khu-vip',
    'Khu VIP - Tầng Trệt Ưu Tiên',
    '828 Sư Vạn Hạnh, P.13, Q.10, TP.HCM',
    50,
    14,
    30000,
    'https://images.unsplash.com/photo-1604063155785-ee447a00178d?auto=format&fit=crop&q=80&w=600',
    ['VIP1', 'VIP2'],
    ['cctv', 'covered', 'valet'],
    { lat: 10.7768, lng: 106.6648 },
    4.9,
    312
  ),

  new ParkingLot(
    'khu-ev',
    'Khu EV - Sạc Điện',
    '828 Sư Vạn Hạnh, P.13, Q.10, TP.HCM',
    40,
    22,
    25000,
    'https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&q=80&w=600',
    ['EV1', 'EV2'],
    ['ev_charging', 'cctv'],
    { lat: 10.7759, lng: 106.6642 },
    4.7,
    64
  ),

  new ParkingLot(
    'lien-ket-van-hanh',
    'Bãi xe Liên kết - Hầm Vạn Hạnh Mall',
    '11 Sư Vạn Hạnh, Phường 12, Quận 10, TP.HCM',
    350,
    95,
    15000,
    'https://images.unsplash.com/photo-1553484771-047a44eee27f?auto=format&fit=crop&q=80&w=600',
    ['VH1', 'VH2', 'VH3'],
    ['cctv', 'covered', 'ev_charging', 'valet'],
    { lat: 10.7742, lng: 106.6675 },
    4.6,
    428
  ),

  new ParkingLot(
    'lien-ket-hung-vuong',
    'Bãi xe Liên kết - Hùng Vương Plaza',
    '126 Hồng Bàng, Phường 12, Quận 5, TP.HCM',
    250,
    115,
    20000,
    'https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&q=80&w=600',
    ['HV1', 'HV2'],
    ['cctv', 'covered'],
    { lat: 10.7565, lng: 106.6605 },
    4.4,
    156
  ),

    new ParkingLot(
      'lien-ket-viettel',
      'Bãi đỗ xe đối tác - Viettel Tower',
      '285 Cách Mạng Tháng Tám, Phường 12, Quận 10, TP.HCM',
      180,
      38,
      22000,
      'https://images.unsplash.com/photo-1573348722427-f1d6819fdf98?auto=format&fit=crop&q=80&w=600',
      ['VT1', 'VT2'],
      ['cctv', 'covered', 'ev_charging'],
      { lat: 10.7788, lng: 106.6782 },
      4.7,
      209
    ),

  new ParkingLot(
    'lien-ket-phu-tho',
    'Bãi xe thông minh - Nhà thi đấu Phú Thọ',
    '219 Lý Thường Kiệt, Phường 15, Quận 11, TP.HCM',
    400,
    192,
    10000,
    'https://images.unsplash.com/photo-1506521788723-888e227038e2?auto=format&fit=crop&q=80&w=600',
    ['PT1', 'PT2', 'PT3'],
    ['cctv', 'monthly'],
    { lat: 10.7695, lng: 106.6562 },
    4.1,
    83
  )
];

module.exports = { ParkingLot, parkingLots };
