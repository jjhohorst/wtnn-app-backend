const mongoose = require('mongoose');

const groundInventoryAllocationSchema = new mongoose.Schema({
  lotId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GroundInventoryLot',
    required: true,
    index: true,
  },
  bolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BOL',
    required: true,
    index: true,
  },
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
  allocatedWeight: { type: Number, required: true, min: 0 },
  allocationType: {
    type: String,
    enum: ['bol_completion', 'manual_adjustment'],
    default: 'bol_completion',
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  notes: { type: String, default: '' },
}, {
  timestamps: true,
});

module.exports = mongoose.model('GroundInventoryAllocation', groundInventoryAllocationSchema);
