const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { isValidObjectId } = require('mongoose');
const Customer = require('../models/Customer');
const User = require('../models/User');
const {
  requireAuth,
  authorizeRoles,
  isCustomerUser,
  customerIdFromToken,
} = require('../middleware/auth');

const isSameCustomer = (a, b) => String(a) === String(b);

router.use(requireAuth);

router.post(
  '/',
  authorizeRoles(['internal', 'admin']),
  [
    body('customerName').notEmpty().withMessage('Customer Name required'),
    body('customerCode').notEmpty().withMessage('Customer Code is required'),
    body('customerAddress1').notEmpty().withMessage('Customer Address is required'),
    body('customerCity').notEmpty().withMessage('Customer City is required'),
    body('customerState').notEmpty().withMessage('Customer State is required'),
    body('customerZip').notEmpty().withMessage('Customer ZIP is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      if (req.body.customerCode) {
        req.body.customerCode = String(req.body.customerCode).trim().toUpperCase();
      }
      const newCustomer = new Customer(req.body);
      const savedCustomer = await newCustomer.save();
      res.status(201).json({ message: 'Customer created successfully', customer: savedCustomer });
    } catch (error) {
      console.error('Error creating customer:', error);
      if (error?.code === 11000 && error?.keyPattern?.customerCode) {
        return res.status(400).json({ message: 'Customer Code already exists' });
      }
      res.status(500).json({ message: 'Server error while creating customer' });
    }
  }
);

router.get('/', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    if (isCustomerUser(req)) {
      const tokenCustomerId = customerIdFromToken(req);
      if (!tokenCustomerId) {
        return res.status(403).json({ message: 'Customer scope is missing from token' });
      }

      const customer = await Customer.findById(tokenCustomerId);
      return res.status(200).json(customer ? [customer] : []);
    }

    const customers = await Customer.find();
    res.status(200).json(customers);
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ message: 'Server error while fetching customers' });
  }
});

router.get('/:id', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid customer ID' });
  }

  if (isCustomerUser(req)) {
    const tokenCustomerId = customerIdFromToken(req);
    if (!tokenCustomerId || !isSameCustomer(req.params.id, tokenCustomerId)) {
      return res.status(403).json({ message: 'Access forbidden: customer is outside scope' });
    }
  }

  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.status(200).json(customer);
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({ message: 'Server error while fetching customer' });
  }
});

router.get('/:id/users', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid customer ID' });
  }

  if (isCustomerUser(req)) {
    const tokenCustomerId = customerIdFromToken(req);
    if (!tokenCustomerId || !isSameCustomer(req.params.id, tokenCustomerId)) {
      return res.status(403).json({ message: 'Access forbidden: customer is outside scope' });
    }
  }

  try {
    const users = await User.find({ customerName: req.params.id });
    res.status(200).json(users);
  } catch (error) {
    console.error('Error fetching users for customer:', error);
    res.status(500).json({ message: 'Server error while fetching associated users' });
  }
});

router.put('/:id', authorizeRoles(['internal', 'admin']), async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid customer ID' });
  }

  try {
    const payload = { ...req.body };
    if (payload.customerCode) {
      payload.customerCode = String(payload.customerCode).trim().toUpperCase();
    }

    const updatedCustomer = await Customer.findByIdAndUpdate(req.params.id, payload, { new: true });
    if (!updatedCustomer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.status(200).json({ message: 'Customer updated successfully', customer: updatedCustomer });
  } catch (error) {
    console.error('Error updating customer:', error);
    if (error?.code === 11000 && error?.keyPattern?.customerCode) {
      return res.status(400).json({ message: 'Customer Code already exists' });
    }
    res.status(500).json({ message: 'Server error while updating customer' });
  }
});

router.delete('/:id', authorizeRoles(['internal', 'admin']), async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid customer ID' });
  }

  try {
    const deletedCustomer = await Customer.findByIdAndDelete(req.params.id);
    if (!deletedCustomer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.status(200).json({ message: 'Customer deleted successfully' });
  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).json({ message: 'Server error while deleting customer' });
  }
});

module.exports = router;
