// models/Materials.js

const mongoose = require('mongoose');

const materialSchema = new mongoose.Schema({
  customerName: { type: mongoose.Schema.Types.ObjectId,
                ref: 'Customer',
                required: true,
                title: 'Customer Name'},
  materialName: { type: String, required: true , title: 'Material Name'},
  refNum: { type: String, required: true , title: 'Reference Number'},
  truckType: { type: String,  title: 'Truck Type'},
  isActive: { type: Boolean, default: true, title: 'Is Active' },
	
});

module.exports = mongoose.model('Material', materialSchema);// JavaScript Document
