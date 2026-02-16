const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { isValidObjectId } = require('mongoose');
const Material = require('../models/Material');
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
    body('materialName').notEmpty().withMessage('Material is required'),
    body('refNum').notEmpty().withMessage('Reference number is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const materialData = { ...req.body };
      if (isCustomerUser(req)) {
        const tokenCustomerId = customerIdFromToken(req);
        if (!tokenCustomerId) {
          return res.status(403).json({ message: 'Customer scope is missing from token' });
        }
        materialData.customerName = tokenCustomerId;
      } else if (!materialData.customerName) {
        return res.status(400).json({ message: 'Customer name is required' });
      }

      const newMaterial = new Material(materialData);
      const savedMaterial = await newMaterial.save();
      res.status(201).json({ message: 'Material created successfully', material: savedMaterial });
    } catch (err) {
      console.error('Error creating material:', err);
      res.status(500).json({ message: 'Server error while creating material' });
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

    const materials = await Material.find(query).populate('customerName', 'customerName');
    res.status(200).json(materials);
  } catch (err) {
    console.error('Error fetching materials:', err);
    res.status(500).json({ message: 'Server error while fetching materials' });
  }
});

router.get('/:id', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const material = await Material.findById(req.params.id).populate('customerName', 'customerName');
    if (!material) {
      return res.status(404).json({ message: 'Material not found' });
    }

    if (isCustomerUser(req)) {
      const tokenCustomerId = customerIdFromToken(req);
      if (!tokenCustomerId || !isSameCustomer(material.customerName?._id || material.customerName, tokenCustomerId)) {
        return res.status(403).json({ message: 'Access forbidden: material is outside customer scope' });
      }
    }

    res.status(200).json(material);
  } catch (err) {
    console.error('Error fetching material:', err);
    res.status(500).json({ message: 'Server error while fetching material' });
  }
});

router.put('/:id', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const existingMaterial = await Material.findById(req.params.id);
    if (!existingMaterial) {
      return res.status(404).json({ message: 'Material not found' });
    }

    if (isCustomerUser(req)) {
      const tokenCustomerId = customerIdFromToken(req);
      if (!tokenCustomerId || !existingMaterial.customerName || !isSameCustomer(existingMaterial.customerName, tokenCustomerId)) {
        return res.status(403).json({ message: 'Access forbidden: material is outside customer scope' });
      }
    }

    const payload = { ...req.body };
    if (isCustomerUser(req)) {
      delete payload.customerName;
    }

    const updatedMaterial = await Material.findByIdAndUpdate(req.params.id, payload, { new: true });
    if (!updatedMaterial) {
      return res.status(404).json({ message: 'Material not found' });
    }
    res.status(200).json({ message: 'Material updated successfully', material: updatedMaterial });
  } catch (err) {
    console.error('Error updating material:', err);
    res.status(500).json({ message: 'Server error while updating material' });
  }
});

router.delete('/:id', authorizeRoles(['internal', 'admin']), async (req, res) => {
  try {
    const deletedMaterial = await Material.findByIdAndDelete(req.params.id);
    if (!deletedMaterial) {
      return res.status(404).json({ message: 'Material not found' });
    }
    res.status(200).json({ message: 'Material deleted successfully' });
  } catch (err) {
    console.error('Error deleting material:', err);
    res.status(500).json({ message: 'Server error while deleting material' });
  }
});

module.exports = router;
