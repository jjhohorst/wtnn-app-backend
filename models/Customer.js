// models/Customer.js

const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  customerName: { type: String, required: true , title: 'Company Name'},
  customerCode: { type: String, required: true, unique: true, trim: true, uppercase: true, title: 'Customer Code' },
  customerAddress1: { type: String, required: true , title: 'Company Address 1'},
  customerAddress2: { type: String, title: 'Company Address 2'},
  customerCity: { type: String, required: true , title: 'Company City'},
  customerState: { type: String, required: true , title: 'Company State'},
  customerZip: { type: String, required: true , title: 'Company ZIP'},
  customerLogo: { type: String, default: '' }

});

module.exports = mongoose.model('Customer', customerSchema);
