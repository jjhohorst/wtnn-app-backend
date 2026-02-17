const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const { sendAppEmail } = require('../utils/email');
const {
  requireAuth,
  authorizeRoles,
} = require('../middleware/auth');

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const generateTemporaryPassword = () => {
  const random = crypto.randomBytes(18).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
  // Ensure a minimum of 12 chars while keeping mixed case + digits.
  return `${random.slice(0, 8)}A1!${random.slice(8, 14)}`;
};

const sendWelcomeUserEmail = async ({ to, firstName, loginUrl, temporaryPassword }) => {
  const subject = 'Welcome to TRS Transload Portal';
  const text = [
    `Hello ${firstName || 'User'},`,
    '',
    'Your account has been created.',
    '',
    `Username: ${to}`,
    `Temporary Password: ${temporaryPassword}`,
    '',
    `Login: ${loginUrl}`,
    '',
    'For security, please sign in and update your password as soon as possible.',
  ].join('\n');

  const result = await sendAppEmail({
    to,
    subject,
    text,
  });

  return result.sent;
};

const sanitizeSelfUpdate = (payload = {}) => {
  const blocked = ['role', 'customerName', 'passwordHash', 'email'];
  const next = { ...payload };
  blocked.forEach((key) => delete next[key]);
  return next;
};

router.use(requireAuth);

router.post(
  '/',
  authorizeRoles(['internal', 'admin']),
  [
    body('firstName').notEmpty().withMessage('First name is required'),
    body('lastName').notEmpty().withMessage('Last name is required'),
    body('customerName').notEmpty().withMessage('Customer name is required'),
    body('email').notEmpty().isEmail().withMessage('Invalid email format'),
    body('password')
      .optional({ checkFalsy: true })
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long'),
    body('passwordHash')
      .optional({ checkFalsy: true })
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long'),
    body('role')
      .notEmpty()
      .isIn(['customer', 'admin', 'internal'])
      .withMessage('Role must be one of: customer, admin, internal'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const email = normalizeEmail(req.body.email);
      const providedPassword = String(req.body.password || req.body.passwordHash || '').trim();
      const rawPassword = providedPassword || generateTemporaryPassword();

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: 'Email already exists' });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(rawPassword, salt);

      const newUser = new User({
        ...req.body,
        email,
        passwordHash: hashedPassword,
      });
      const savedUser = await newUser.save();

      const webBaseUrl = process.env.WEB_BASE_URL || process.env.FRONTEND_BASE_URL || 'https://localhost:3000';
      const loginUrl = `${webBaseUrl.replace(/\/$/, '')}/login`;
      let welcomeEmailSent = false;

      try {
        welcomeEmailSent = await sendWelcomeUserEmail({
          to: email,
          firstName: savedUser.firstName,
          loginUrl,
          temporaryPassword: rawPassword,
        });
      } catch (mailErr) {
        console.error('Error sending welcome email:', mailErr);
      }

      const response = {
        message: welcomeEmailSent
          ? 'User created successfully. Welcome email sent.'
          : 'User created successfully. Welcome email not sent.',
        user: savedUser,
        welcomeEmailSent,
      };

      if (!welcomeEmailSent && !providedPassword) {
        response.temporaryPassword = rawPassword;
      }

      res.status(201).json(response);
    } catch (error) {
      console.error('Error creating user:', error);
      if (error.code === 11000) {
        return res.status(400).json({ message: 'Email already exists' });
      }
      res.status(500).json({ message: 'Server error while creating user' });
    }
  }
);

router.post(
  '/internal',
  authorizeRoles(['admin']),
  [
    body('firstName').notEmpty().withMessage('First name is required'),
    body('lastName').notEmpty().withMessage('Last name is required'),
    body('customerName').notEmpty().withMessage('Customer name is required'),
    body('email').notEmpty().isEmail().withMessage('Invalid email format'),
    body('password')
      .optional({ checkFalsy: true })
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const email = normalizeEmail(req.body.email);
      const providedPassword = String(req.body.password || '').trim();
      const rawPassword = providedPassword || generateTemporaryPassword();
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: 'Email already exists' });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(rawPassword, salt);

      const newUser = new User({
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        customerName: req.body.customerName,
        email,
        passwordHash: hashedPassword,
        role: 'internal',
        isActive: true,
      });

      const savedUser = await newUser.save();

      const webBaseUrl = process.env.WEB_BASE_URL || process.env.FRONTEND_BASE_URL || 'https://localhost:3000';
      const loginUrl = `${webBaseUrl.replace(/\/$/, '')}/login`;
      let welcomeEmailSent = false;

      try {
        welcomeEmailSent = await sendWelcomeUserEmail({
          to: email,
          firstName: savedUser.firstName,
          loginUrl,
          temporaryPassword: rawPassword,
        });
      } catch (mailErr) {
        console.error('Error sending welcome email:', mailErr);
      }

      const response = {
        message: welcomeEmailSent
          ? 'Internal user created successfully. Welcome email sent.'
          : 'Internal user created successfully. Welcome email not sent.',
        user: savedUser,
        welcomeEmailSent,
      };

      if (!welcomeEmailSent && !providedPassword) {
        response.temporaryPassword = rawPassword;
      }

      return res.status(201).json(response);
    } catch (error) {
      console.error('Error creating internal user:', error);
      if (error.code === 11000) {
        return res.status(400).json({ message: 'Email already exists' });
      }
      return res.status(500).json({ message: 'Server error while creating internal user' });
    }
  }
);

router.get('/', authorizeRoles(['internal', 'admin']), async (req, res) => {
  try {
    const users = await User.find().populate('customerName', 'customerName');
    res.status(200).json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Server error while fetching users' });
  }
});

router.get('/:id', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    if (req.user.role === 'customer' && String(req.user.id) !== String(req.params.id)) {
      return res.status(403).json({ message: 'Access forbidden: user is outside scope' });
    }

    const user = await User.findById(req.params.id).populate('customerName', 'customerName');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ message: 'Server error while fetching user' });
  }
});

router.put('/:id', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const isSelf = String(req.user.id) === String(req.params.id);

    if (!isSelf && !['internal', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access forbidden: insufficient rights' });
    }

    const updatePayload = isSelf && req.user.role === 'customer' ? sanitizeSelfUpdate(req.body) : req.body;

    const updatedUser = await User.findByIdAndUpdate(req.params.id, updatePayload, { new: true });
    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({ message: 'User updated successfully', user: updatedUser });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Server error while updating user' });
  }
});

router.delete('/:id', authorizeRoles(['internal', 'admin']), async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.id);
    if (!deletedUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Server error while deleting user' });
  }
});

module.exports = router;
