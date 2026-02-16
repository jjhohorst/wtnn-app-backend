// JavaScript Document
// models/Order.js

const mongoose = require('mongoose');

// Define a schema for orders
const orderSchema = new mongoose.Schema({
  customerName: { type: mongoose.Schema.Types.ObjectId,
                ref: 'Customer',
                required: true },
  orderDate: { type: Date, title: 'Order Date'},
  orderNumber: { type: String, title: 'Order Number', required: true},
  shipperName: { type: mongoose.Schema.Types.ObjectId,
				 ref: 'Shipper',
				 required: true },
  receiverName: { type: mongoose.Schema.Types.ObjectId,
				  ref: 'Receiver',
				  required: true },
  projectName: { type: mongoose.Schema.Types.ObjectId,
				 ref: 'Project',
				 required: true },
  materialName: { type: mongoose.Schema.Types.ObjectId,
				 ref: 'Material',
				 required: true },
  railcarID: { type: String, default: '', title: 'Preferred Railcar #' },
  splitLoad: { type: Boolean, default: false, title: 'Split Load' },
  secondaryRailcarID: { type: String, default: '', title: 'Secondary Preferred Railcar #' },

  pickUpDate: { type: Date, required: true, label: "Pick Up Date"},
  deliveryDate: {type: Date, required: true, label: "Delivery Date"},
  accessCode: {type: String, label: "Access Code"},
  orderStatus: {type: String,
    enum: ['Draft', 'Submitted', 'Shipped', 'Cancelled'],
    default: 'Draft',
    required: true,
   },
  notes: { type: String, label: "Notes" },	
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId,
  			   ref: 'User', // references the Users model
  			   required: true}
});

// Create and export the Order model
module.exports = mongoose.model('Order', orderSchema);
