const mongoose = require('mongoose');

const railcarSchema = new mongoose.Schema({
  customerName: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    title: 'Customer Name',
  },
  carInitial: { type: String, required: true, title: 'Car Initial' },
  carNumber: { type: String, required: true, title: 'Car Number' },
  railcarID: { type: String, required: true, title: 'Railcar ID' },
  commodity: { type: String, title: 'Commodity' },
  railcarBolNumber: { type: String, title: 'Railcar Shipment BOL Number' },
  leStatus: { type: String, title: 'LE Status' },
  currentStatus: {
    type: String,
    enum: ['Inbound', 'Available', 'Released'],
    default: 'Inbound',
    title: 'Current Status',
  },
  status: { type: String, title: 'Status (legacy compatibility)' },
  station: { type: String, title: 'Station' },
  track: { type: String, title: 'Track' },
  trackPosition: { type: String, title: 'Track Position' },
  materialName: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Material',
    title: 'Associated Material',
  },
  batchNumber: { type: String, title: 'Batch Number' },
  reportedWeight: { type: Number, title: 'Reported Weight' },
  releasedAsEmptyAt: { type: Date, title: 'Released As Empty At' },
  releasedAsEmptyBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', title: 'Released As Empty By' },
  isActive: { type: Boolean, default: true, title: 'Is Active' },
}, {
  timestamps: true,
});

railcarSchema.pre('validate', function ensureRailcarId(next) {
  const initial = String(this.carInitial || '').trim().toUpperCase();
  const number = String(this.carNumber || '').trim();
  if (initial && number) {
    this.carInitial = initial;
    this.carNumber = number;
    this.railcarID = `${initial} ${number}`;
  } else if (!this.railcarID) {
    return next(new Error('Railcar requires Car Initial and Car Number'));
  }

  if (!this.status) {
    this.status = this.currentStatus || 'Inbound';
  }
  next();
});

railcarSchema.index({ customerName: 1, carInitial: 1, carNumber: 1 }, { unique: true });

module.exports = mongoose.model('Railcar', railcarSchema);
