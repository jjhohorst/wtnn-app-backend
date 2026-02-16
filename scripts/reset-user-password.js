#!/usr/bin/env node
require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const main = async () => {
  const emailArg = process.argv[2];
  const passwordArg = process.argv[3];

  if (!emailArg || !passwordArg) {
    console.error('Usage: node scripts/reset-user-password.js <email> <newPassword>');
    process.exit(1);
  }

  if (!process.env.DB_URI) {
    console.error('DB_URI is not set.');
    process.exit(1);
  }

  if (String(passwordArg).length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const email = normalizeEmail(emailArg);

  await mongoose.connect(process.env.DB_URI);

  try {
    let user = await User.findOne({ email });

    if (!user) {
      user = await User.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    }

    if (!user) {
      console.error(`User not found for email: ${email}`);
      process.exitCode = 1;
      return;
    }

    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(passwordArg, salt);
    user.email = email;
    user.isActive = true;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    console.log(`Password reset successful for ${user.email} (${user.role})`);
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((err) => {
  console.error('Failed to reset password:', err.message || err);
  process.exit(1);
});

