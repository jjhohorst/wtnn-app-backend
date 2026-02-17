// models/User.js

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // User's first name
  firstName: { 
    type: String, 
    required: true 
  },
  // User's last name
  lastName: { 
    type: String, 
    required: true 
  },
  // User's Company
  customerName: { 
    type: mongoose.Schema.Types.ObjectId,
	ref: 'Customer',
    required: true 
  },
  // User's email address; must be unique
  email: { 
    type: String, 
    required: true, 
    unique: true 
  },
  // Hashed password for security
  passwordHash: { 
    type: String, 
    required: true 
  },
  // Role of the user (e.g., customer, admin, or internal user)
  role: { 
    type: String, 
    enum: ['customer', 'admin', 'internal'], 
    default: 'customer' 
  },
  // Preferred timezone for displaying operational timestamps
  timeZone: {
    type: String,
    default: 'America/Chicago',
  },
  // Preferred date format style for UI rendering
  dateFormat: {
    type: String,
    enum: ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'],
    default: 'MM/DD/YYYY',
  },
  // Preferred time format style for UI rendering
  timeFormat: {
    type: String,
    enum: ['12h', '24h'],
    default: '12h',
  },
  // Preferred first day of week in calendar views
  weekStartsOn: {
    type: String,
    enum: ['sunday', 'monday'],
    default: 'monday',
  },
  // In-app notification preferences
  notifyNewOrders: {
    type: Boolean,
    default: true,
  },
  notifySound: {
    type: Boolean,
    default: true,
  },
  notifyDesktop: {
    type: Boolean,
    default: false,
  },
  // Customer user preference for receiving completed BOL emails
  receiveBols: {
    type: Boolean,
    default: false,
  },
  // Indicates whether the user is active
  isActive: { 
    type: Boolean, 
    default: true 
  },
  // Timestamp when the user was created
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  // Timestamp when the user was last updated
  updatedAt: { 
    type: Date, 
    default: Date.now 
  },
  // Field to store the password reset token
  resetPasswordToken: {
    type: String
  },
  // Field to store the expiration time for the password reset token
  resetPasswordExpires: {
    type: Date
  }}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Pre-save hook to update the 'updatedAt' field on each save
userSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});


module.exports = mongoose.model('User', userSchema);
