const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const looksLikeBcryptHash = (value) => /^\$2[aby]\$\d{2}\$/.test(String(value || ''));

const tokenAuthMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'Token required' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Token required' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = decoded;
    next();
  });
};

const sendResetPasswordEmail = async ({ to, resetUrl }) => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || smtpUser;

  if (!host || !from) {
    return false;
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (err) {
    console.warn('Password reset email skipped: nodemailer is not installed');
    return false;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
  });

  const subject = 'Reset your WTNN Shipment Portal password';
  const text = [
    'A request was received to reset your password.',
    '',
    'Use this link to reset your password (valid for 60 minutes):',
    resetUrl,
    '',
    'If you did not request this, you can ignore this message.',
  ].join('\n');

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
  });

  return true;
};

router.post(
  '/register',
  [
    body('firstName').notEmpty().withMessage('First name is required'),
    body('lastName').notEmpty().withMessage('Last name is required'),
    body('customerName').notEmpty().withMessage('Customer name is required'),
    body('email').notEmpty().isEmail().withMessage('Must be a valid email'),
    body('password').notEmpty().withMessage('Password is required'),
    body('role')
      .optional()
      .isIn(['customer'])
      .withMessage('Customer-linked registrations can only use role: customer'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { firstName, lastName, customerName, password } = req.body;
      const email = normalizeEmail(req.body.email);

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: 'Email already registered.' });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const newUser = new User({
        firstName,
        lastName,
        customerName,
        email,
        passwordHash: hashedPassword,
        role: 'customer',
      });

      const savedUser = await newUser.save();
      res.status(201).json({ message: 'User registered successfully', user: savedUser });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/login',
  [
    body('email').notEmpty().isEmail().withMessage('Must be a valid email'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const email = normalizeEmail(req.body.email);
      const password = String(req.body.password || '');

      const user = await User.findOne({ email }).populate('customerName', 'customerName customerLogo');
      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      let isMatch = false;
      const storedPasswordHash = String(user.passwordHash || '');

      if (looksLikeBcryptHash(storedPasswordHash)) {
        isMatch = await bcrypt.compare(password, storedPasswordHash);
      } else {
        // Legacy support: if plain text was stored in passwordHash, allow one login and upgrade to bcrypt.
        isMatch = storedPasswordHash === password;
        if (isMatch) {
          const salt = await bcrypt.genSalt(10);
          user.passwordHash = await bcrypt.hash(password, salt);
          await user.save();
        }
      }

      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      const payload = {
        id: user._id,
        role: user.role,
        email: user.email,
        customerId: user.customerName?._id || null,
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });

      res.status(200).json({
        message: 'Login successful',
        token,
        user: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: `${user.firstName} ${user.lastName}`.trim(),
          email: user.email,
          role: user.role,
          customerName: user.customerName?._id || null,
          customer: user.customerName || null,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/forgot-password',
  [body('email').notEmpty().isEmail().withMessage('Must be a valid email')],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const genericMessage = 'If that email exists, a password reset link has been sent.';

    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      const user = await User.findOne({ email, isActive: { $ne: false } });

      if (!user) {
        return res.status(200).json({ message: genericMessage });
      }

      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      user.resetPasswordToken = tokenHash;
      user.resetPasswordExpires = expiresAt;
      await user.save();

      const webBaseUrl = process.env.WEB_BASE_URL || process.env.FRONTEND_BASE_URL || 'https://localhost:3000';
      const resetUrl = `${webBaseUrl.replace(/\/$/, '')}/login?resetToken=${rawToken}`;

      let emailSent = false;
      try {
        emailSent = await sendResetPasswordEmail({ to: user.email, resetUrl });
      } catch (mailErr) {
        console.error('Failed to send password reset email:', mailErr);
      }

      const response = { message: genericMessage };
      if (!emailSent && process.env.NODE_ENV !== 'production') {
        response.devResetUrl = resetUrl;
      }

      return res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/reset-password',
  [
    body('token').notEmpty().withMessage('Reset token is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const token = String(req.body.token || '').trim();
      const password = String(req.body.password || '');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const user = await User.findOne({
        resetPasswordToken: tokenHash,
        resetPasswordExpires: { $gt: new Date() },
        isActive: { $ne: false },
      });

      if (!user) {
        return res.status(400).json({ message: 'Reset token is invalid or expired.' });
      }

      const salt = await bcrypt.genSalt(10);
      user.passwordHash = await bcrypt.hash(password, salt);
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();

      return res.status(200).json({ message: 'Password reset successful.' });
    } catch (error) {
      next(error);
    }
  }
);

router.put('/self', tokenAuthMiddleware, async (req, res, next) => {
  try {
    const updatedUser = await User.findByIdAndUpdate(req.user.id, req.body, { new: true });
    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.status(200).json({ message: 'User updated successfully', user: updatedUser });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
