// models/Shippers.js

const mongoose = require('mongoose');

const shipperSchema = new mongoose.Schema({
  customerName: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    title: 'Customer Name',
  },
  shipperName: { type: String, required: true , title: 'Shipper Name'},
  shipperContactName: { type: String, required: true , title: 'Shipper Contact Name'},
  shipperEmail: { type: String, title: "Shipper Email"},
  shipperPhone: { type: String, title: 'Shipper Phone Number'},
  isActive: { type: Boolean, default: true, title: 'Is Active' },
	
});

module.exports = mongoose.model('Shipper', shipperSchema);
