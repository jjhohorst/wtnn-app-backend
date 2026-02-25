// models/Customer.js

const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  customerName: { type: String, required: true , title: 'Company Name'},
  customerCode: { type: String, trim: true, uppercase: true, title: 'Customer Code' },
  customerAddress1: { type: String, required: true , title: 'Company Address 1'},
  customerAddress2: { type: String, title: 'Company Address 2'},
  customerCity: { type: String, required: true , title: 'Company City'},
  customerState: { type: String, required: true , title: 'Company State'},
  customerZip: { type: String, required: true , title: 'Company ZIP'},
  customerLogo: { type: String, default: '' },
  loadGoalMinutes: {
    type: Number,
    default: 90,
    min: 1,
    max: 180,
    title: 'Average Load Goal (minutes)',
  },
  enableGroundInventory: {
    type: Boolean,
    default: false,
    title: 'Enable Ground Inventory',
  },

});

// Customer code is optional; enforce uniqueness only when a non-empty code exists.
customerSchema.index(
  { customerCode: 1 },
  {
    unique: true,
    partialFilterExpression: { customerCode: { $exists: true, $type: 'string', $ne: '' } },
  }
);

module.exports = mongoose.model('Customer', customerSchema);
