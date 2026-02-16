const mongoose = require('mongoose');

const receiverSchema = new mongoose.Schema({
  customerName: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    title: 'Customer Name',
  },
  receiverName: { type: String, required: true, title: 'Receiver Name' },
  billingAddress1: { type: String, title: 'Billing Address 1' },
  billingAddress2: { type: String, title: 'Billing Address 2' },
  billingCity: { type: String, title: 'Billing City' },
  billingState: { type: String, title: 'Billing State' },
  billingZip: { type: String, title: 'Billing ZIP' },
  isActive: { type: Boolean, default: true, title: 'Is Active' },
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

receiverSchema.virtual('fullBillingAddress').get(function fullBillingAddress() {
  const parts = [this.billingAddress1];
  if (this.billingAddress2) parts.push(this.billingAddress2);

  const cityStateZip = [this.billingCity, this.billingState, this.billingZip].filter(Boolean).join(' ');
  if (cityStateZip) parts.push(cityStateZip);

  return parts.filter(Boolean).join(', ');
});

module.exports = mongoose.model('Receiver', receiverSchema);
