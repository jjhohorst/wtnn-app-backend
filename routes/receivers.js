const express = require('express');
const router = express.Router();
const { isValidObjectId } = require('mongoose');
const Receiver = require('../models/Receiver');
const {
  requireAuth,
  authorizeRoles,
  isCustomerUser,
  customerIdFromToken,
} = require('../middleware/auth');

const isSameCustomer = (a, b) => String(a) === String(b);

router.use(requireAuth);

router.post('/', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const receiverData = { ...req.body };

    if (!receiverData.receiverName) {
      return res.status(400).json({ message: 'Receiver name is required.' });
    }

    if (!receiverData.billingAddress1 || !receiverData.billingCity || !receiverData.billingState || !receiverData.billingZip) {
      return res.status(400).json({
        message: 'Main billing address is required (address, city, state, zip).',
      });
    }

    if (isCustomerUser(req)) {
      const tokenCustomerId = customerIdFromToken(req);
      if (!tokenCustomerId) {
        return res.status(403).json({ message: 'Customer scope is missing from token' });
      }
      receiverData.customerName = tokenCustomerId;
    }

    const newReceiver = new Receiver(receiverData);
    const savedReceiver = await newReceiver.save();
    res.status(201).json({ message: 'Receiver created successfully', receiver: savedReceiver });
  } catch (error) {
    console.error('Error creating receiver:', error);
    res.status(500).json({ message: 'Server error while creating receiver' });
  }
});

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

    const receivers = await Receiver.find(query).populate('customerName', 'customerName');
    res.status(200).json(receivers);
  } catch (error) {
    console.error('Error fetching receivers:', error);
    res.status(500).json({ message: 'Server error while fetching receivers' });
  }
});

router.get('/:id', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const receiver = await Receiver.findById(req.params.id).populate('customerName', 'customerName');
    if (!receiver) {
      return res.status(404).json({ message: 'Receiver not found' });
    }

    if (isCustomerUser(req)) {
      const tokenCustomerId = customerIdFromToken(req);
      if (!tokenCustomerId || !receiver.customerName || !isSameCustomer(receiver.customerName._id || receiver.customerName, tokenCustomerId)) {
        return res.status(403).json({ message: 'Access forbidden: receiver is outside customer scope' });
      }
    }

    res.status(200).json(receiver);
  } catch (error) {
    console.error('Error fetching receiver:', error);
    res.status(500).json({ message: 'Server error while fetching receiver' });
  }
});

router.put('/:id', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const existingReceiver = await Receiver.findById(req.params.id);
    if (!existingReceiver) {
      return res.status(404).json({ message: 'Receiver not found' });
    }

    if (isCustomerUser(req)) {
      const tokenCustomerId = customerIdFromToken(req);
      if (!tokenCustomerId || !existingReceiver.customerName || !isSameCustomer(existingReceiver.customerName, tokenCustomerId)) {
        return res.status(403).json({ message: 'Access forbidden: receiver is outside customer scope' });
      }
    }

    const payload = { ...req.body };
    if (isCustomerUser(req)) {
      delete payload.customerName;
    }

    const updatedReceiver = await Receiver.findByIdAndUpdate(req.params.id, payload, { new: true });
    res.status(200).json({ message: 'Receiver updated successfully', receiver: updatedReceiver });
  } catch (error) {
    console.error('Error updating receiver:', error);
    res.status(500).json({ message: 'Server error while updating receiver' });
  }
});

router.delete('/:id', authorizeRoles(['internal', 'admin']), async (req, res) => {
  try {
    const deletedReceiver = await Receiver.findByIdAndDelete(req.params.id);
    if (!deletedReceiver) {
      return res.status(404).json({ message: 'Receiver not found' });
    }
    res.status(200).json({ message: 'Receiver deleted successfully' });
  } catch (error) {
    console.error('Error deleting receiver:', error);
    res.status(500).json({ message: 'Server error while deleting receiver' });
  }
});

module.exports = router;
