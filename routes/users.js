const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const {
  requireAuth,
  authorizeRoles,
} = require('../middleware/auth');

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
    body('passwordHash').notEmpty().withMessage('Password is required'),
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
      const newUser = new User(req.body);
      const savedUser = await newUser.save();
      res.status(201).json({ message: 'User created successfully', user: savedUser });
    } catch (error) {
      console.error('Error creating user:', error);
      if (error.code === 11000) {
        return res.status(400).json({ message: 'Email already exists' });
      }
      res.status(500).json({ message: 'Server error while creating user' });
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
