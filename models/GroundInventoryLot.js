const mongoose = require('mongoose');

const groundInventoryLotSchema = new mongoose.Schema({
  customerName: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true,
  },
  materialName: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Material',
    required: true,
    index: true,
  },
  sourceType: {
    type: String,
    enum: ['railcar_conversion', 'manual_adjustment'],
    default: 'railcar_conversion',
  },
  sourceRailcarDocId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Railcar',
  },
  sourceRailcarID: { type: String, default: '' },
  sourceRailShipmentBolNumber: { type: String, default: '' },
  conversionToken: { type: String, default: '' },
  locationName: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
  },
  startingWeight: { type: Number, required: true, min: 0 },
  remainingWeight: { type: Number, required: true, min: 0 },
  uom: { type: String, default: 'lbs' },
  receivedAt: { type: Date, default: Date.now },
  receivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  status: {
    type: String,
    enum: ['available', 'depleted', 'archived'],
    default: 'available',
    index: true,
  },
  notes: { type: String, default: '' },
}, {
  timestamps: true,
});

groundInventoryLotSchema.index(
  { conversionToken: 1 },
  {
    unique: true,
    partialFilterExpression: { conversionToken: { $exists: true, $type: 'string', $ne: '' } },
  }
);
groundInventoryLotSchema.index({ customerName: 1, materialName: 1, status: 1 });

module.exports = mongoose.model('GroundInventoryLot', groundInventoryLotSchema);
