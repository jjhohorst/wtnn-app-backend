const mongoose = require('mongoose');

const bolSchema = new mongoose.Schema({
  orderNumber: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    title: 'BOL Number',
  },
  bolDate: { type: Date, required: true, title: 'BOL Date' },
  customerName: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
  },
  customerLogo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
  },
  shipperName: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shipper',
    required: true,
  },
  projectName: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
  },
  materialName: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Material',
    required: true,
  },
  inventorySource: {
    type: String,
    enum: ['railcar', 'ground'],
    default: 'railcar',
    title: 'Inventory Source',
  },
  groundInventoryLot: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GroundInventoryLot',
    title: 'Ground Inventory Lot',
  },
  secondaryGroundInventoryLot: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GroundInventoryLot',
    title: 'Secondary Ground Inventory Lot',
  },
  groundInventoryAllocatedWeight: { type: Number, title: 'Ground Inventory Allocated Weight' },
  secondaryGroundInventoryAllocatedWeight: { type: Number, title: 'Secondary Ground Inventory Allocated Weight' },
  status: {
    type: String,
    enum: ['Draft', 'Completed'],
    default: 'Draft',
    required: true,
  },
  grossWeight: { type: Number, title: 'Gross Weight' },
  tareWeight: { type: Number, title: 'Tare Weight' },
  primaryNetWeight: { type: Number, title: 'Primary Net Weight' },
  primaryTonWeight: { type: Number, title: 'Primary Ton Weight' },
  splitLoad: { type: Boolean, default: false, title: 'Split Load' },
  secondaryRailcarID: { type: String, title: 'Secondary Railcar #' },
  secondaryGrossWeight: { type: Number, title: 'Secondary Gross Weight' },
  secondaryTareWeight: { type: Number, title: 'Secondary Tare Weight' },
  secondaryNetWeight: { type: Number, title: 'Secondary Net Weight' },
  secondaryTonWeight: { type: Number, title: 'Secondary Ton Weight' },
  netWeight: { type: Number, title: 'Net Weight' },
  tonWeight: { type: Number, title: 'Ton Weight' },
  weighInTime: { type: Date, title: 'Weigh In Time' },
  weighOutTime: { type: Date, title: 'Weigh Out Time' },
  driverName: { type: String, title: 'Driver Name' },
  driverSignatureImage: { type: String, title: 'Driver Signature Image (Data URL)' },
  signedAt: { type: Date, title: 'Driver Signed At' },
  railcarID: {
    type: String,
    required() {
      return this.inventorySource !== 'ground';
    },
    title: 'Railcar #',
  },
  railShipmentBolNumber: { type: String, title: 'Rail Shipment BOL Number (Primary)' },
  secondaryRailShipmentBolNumber: { type: String, title: 'Rail Shipment BOL Number (Secondary)' },
  truckID: { type: String, required: true, title: 'Truck #' },
  trailerID: { type: String, required: true, title: 'Trailer #' },
  comments: { type: String, title: 'Comments' },
  createdAt: { type: Date, default: Date.now },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  completedAt: { type: Date },
  completedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
});

bolSchema.pre('validate', function (next) {
  if (this.inventorySource === 'ground') {
    this.secondaryRailcarID = '';
    this.railShipmentBolNumber = '';
    this.secondaryRailShipmentBolNumber = '';
  } else {
    this.secondaryGroundInventoryLot = null;
    this.secondaryGroundInventoryAllocatedWeight = null;
  }

  const hasPrimaryWeights = this.grossWeight != null && this.tareWeight != null;
  const hasSecondaryWeights = Boolean(this.splitLoad) && this.secondaryGrossWeight != null && this.secondaryTareWeight != null;

  if (hasPrimaryWeights) {
    this.primaryNetWeight = this.grossWeight - this.tareWeight;
    this.primaryTonWeight = this.primaryNetWeight / 2000;
  } else {
    this.primaryNetWeight = null;
    this.primaryTonWeight = null;
  }

  if (hasSecondaryWeights) {
    this.secondaryNetWeight = this.secondaryGrossWeight - this.secondaryTareWeight;
    this.secondaryTonWeight = this.secondaryNetWeight / 2000;
  } else {
    this.secondaryNetWeight = null;
    this.secondaryTonWeight = null;
  }

  if (hasPrimaryWeights) {
    const secondaryNet = hasSecondaryWeights ? this.secondaryNetWeight : 0;
    this.netWeight = this.primaryNetWeight + secondaryNet;
    this.tonWeight = this.netWeight / 2000;
  } else {
    this.netWeight = null;
    this.tonWeight = null;
  }

  next();
});

module.exports = mongoose.model('BOL', bolSchema);
