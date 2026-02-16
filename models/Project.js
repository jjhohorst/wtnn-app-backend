const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  customerName: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    title: 'Customer Name',
  },
  receiverName: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Receiver',
    title: 'Receiver Name',
  },
  projectName: { type: String, required: true, title: 'Project Name' },
  projectAddress1: { type: String, required: true, title: 'Project Address 1' },
  projectAddress2: { type: String, title: 'Project Address 2' },
  projectCity: { type: String, required: true, title: 'Project City' },
  projectState: { type: String, required: true, title: 'Project State' },
  projectZip: { type: String, required: true, title: 'Project Zip Code' },
  siteContactName: { type: String, title: 'Site Contact Name' },
  siteContactPhone: { type: String, title: 'Site Contact Phone' },
  isActive: { type: Boolean, default: true, title: 'Is Active' },
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

projectSchema.virtual('fullAddress').get(function fullAddress() {
  const parts = [this.projectAddress1];
  if (this.projectAddress2) parts.push(this.projectAddress2);
  const cityStateZip = [this.projectCity, this.projectState, this.projectZip].filter(Boolean).join(' ');
  if (cityStateZip) parts.push(cityStateZip);
  return parts.filter(Boolean).join(', ');
});

module.exports = mongoose.model('Project', projectSchema);
