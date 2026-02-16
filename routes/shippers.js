const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { isValidObjectId } = require('mongoose');
const Shippers = require('../models/Shipper');
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
  authorizeRoles(['customer', 'internal', 'admin']),
  [
    body('shipperName').notEmpty().withMessage('Shipper Name is required'),
    body('shipperContactName').notEmpty().withMessage('Shipper Contact Name is required'),
    body('shipperEmail')
      .optional({ checkFalsy: true })
      .isEmail().withMessage('Invalid email address format'),
    body('shipperPhone')
      .optional({ checkFalsy: true })
      .matches(/^\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})$/)
      .withMessage('Invalid phone number format (e.g., 123-456-7890)'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const shipperData = { ...req.body };
      if (isCustomerUser(req)) {
        const tokenCustomerId = customerIdFromToken(req);
        if (!tokenCustomerId) {
          return res.status(403).json({ message: 'Customer scope is missing from token' });
        }
        shipperData.customerName = tokenCustomerId;
      }

      const newShipper = new Shippers(shipperData);
      const savedShipper = await newShipper.save();
      res.status(201).json({ message: 'Shipper created successfully', shipper: savedShipper });
    } catch (error) {
      console.error('Error creating shipper:', error);
      res.status(500).json({ message: 'Server error while creating shipper' });
    }
  }
);

router.get('/', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const query = {};
    if (isCustomerUser(req)) {
      const tokenCustomerId = customerIdFromToken(req);
      if (!tokenCustomerId) {
        return res.status(403).json({ message: 'Customer scope is missing from token' });
      }
      query.customerName = tokenCustomerId;
    } else if (req.query.customerId) {
      if (!isValidObjectId(req.query.customerId)) {
        return res.status(400).json({ message: 'Invalid customerId query parameter' });
      }
      query.customerName = req.query.customerId;
    }

    const shippers = await Shippers.find(query).populate('customerName', 'customerName');
    res.status(200).json(shippers);
  } catch (error) {
    console.error('Error fetching shippers:', error);
    res.status(500).json({ message: 'Server error while fetching shippers' });
  }
});

router.get('/:id', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const shipper = await Shippers.findById(req.params.id).populate('customerName', 'customerName');
    if (!shipper) {
      return res.status(404).json({ message: 'Shipper not found' });
    }

    if (isCustomerUser(req)) {
      const tokenCustomerId = customerIdFromToken(req);
      if (!tokenCustomerId || !shipper.customerName || !isSameCustomer(shipper.customerName._id || shipper.customerName, tokenCustomerId)) {
        return res.status(403).json({ message: 'Access forbidden: shipper is outside customer scope' });
      }
    }

    res.status(200).json(shipper);
  } catch (error) {
    console.error('Error fetching shipper:', error);
    res.status(500).json({ message: 'Server error while fetching shipper' });
  }
});

router.put('/:id', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const existingShipper = await Shippers.findById(req.params.id);
    if (!existingShipper) {
      return res.status(404).json({ message: 'Shipper not found' });
    }

    if (isCustomerUser(req)) {
      const tokenCustomerId = customerIdFromToken(req);
      if (!tokenCustomerId || !existingShipper.customerName || !isSameCustomer(existingShipper.customerName, tokenCustomerId)) {
        return res.status(403).json({ message: 'Access forbidden: shipper is outside customer scope' });
      }
    }

    const payload = { ...req.body };
    if (isCustomerUser(req)) {
      delete payload.customerName;
    }

    const updatedShipper = await Shippers.findByIdAndUpdate(req.params.id, payload, { new: true });
    res.status(200).json({ message: 'Shipper updated successfully', shipper: updatedShipper });
  } catch (error) {
    console.error('Error updating shipper:', error);
    res.status(500).json({ message: 'Server error while updating shipper' });
  }
});

router.delete('/:id', authorizeRoles(['internal', 'admin']), async (req, res) => {
  try {
    const deletedShipper = await Shippers.findByIdAndDelete(req.params.id);
    if (!deletedShipper) {
      return res.status(404).json({ message: 'Shipper not found' });
    }
    res.status(200).json({ message: 'Shipper deleted successfully' });
  } catch (error) {
    console.error('Error deleting shipper:', error);
    res.status(500).json({ message: 'Server error while deleting shipper' });
  }
});

module.exports = router;
