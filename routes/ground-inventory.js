const express = require('express');
const { body, validationResult } = require('express-validator');
const { isValidObjectId } = require('mongoose');
const GroundInventoryLot = require('../models/GroundInventoryLot');
const GroundInventoryAllocation = require('../models/GroundInventoryAllocation');
const Customer = require('../models/Customer');
const Material = require('../models/Material');
const {
  requireAuth,
  authorizeRoles,
  isCustomerUser,
  customerIdFromToken,
} = require('../middleware/auth');

const router = express.Router();

const parseStatusFilter = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (['available', 'depleted', 'archived'].includes(raw)) return raw;
  return null;
};

router.use(requireAuth);

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

    if (req.query.materialId) {
      if (!isValidObjectId(req.query.materialId)) {
        return res.status(400).json({ message: 'Invalid materialId query parameter' });
      }
      query.materialName = req.query.materialId;
    }

    const statusFilter = parseStatusFilter(req.query.status);
    if (statusFilter) {
      query.status = statusFilter;
    } else if (String(req.query.includeAllStatuses || '').toLowerCase() !== 'true') {
      query.status = { $ne: 'archived' };
    }

    const lots = await GroundInventoryLot.find(query)
      .sort({ status: 1, receivedAt: -1, createdAt: -1 })
      .populate('customerName', 'customerName')
      .populate('materialName', 'materialName refNum')
      .populate('locationName', 'projectName')
      .populate('receivedBy', 'firstName lastName fullName email');

    const summaryMap = new Map();
    lots.forEach((lot) => {
      const materialId = String(lot.materialName?._id || lot.materialName || '');
      const key = materialId || String(lot._id);
      const existing = summaryMap.get(key) || {
        materialId,
        materialName: lot.materialName?.materialName || 'Material',
        refNum: lot.materialName?.refNum || '',
        totalStartingWeight: 0,
        totalRemainingWeight: 0,
        lotCount: 0,
      };
      existing.totalStartingWeight += Number(lot.startingWeight || 0);
      existing.totalRemainingWeight += Number(lot.remainingWeight || 0);
      existing.lotCount += 1;
      summaryMap.set(key, existing);
    });

    const summaryByMaterial = [...summaryMap.values()].sort((a, b) =>
      String(a.materialName).localeCompare(String(b.materialName), undefined, { sensitivity: 'base' })
    );

    const totalRemainingWeight = summaryByMaterial.reduce((acc, row) => acc + Number(row.totalRemainingWeight || 0), 0);
    const totalStartingWeight = summaryByMaterial.reduce((acc, row) => acc + Number(row.totalStartingWeight || 0), 0);

    return res.status(200).json({
      lots,
      summaryByMaterial,
      totals: {
        totalStartingWeight,
        totalRemainingWeight,
      },
    });
  } catch (err) {
    console.error('Error fetching ground inventory lots:', err);
    return res.status(500).json({ message: 'Server error while fetching ground inventory lots' });
  }
});

router.post(
  '/adjustments',
  authorizeRoles(['internal', 'admin']),
  [
    body('customerName').notEmpty().isMongoId().withMessage('Customer is required'),
    body('materialName').notEmpty().isMongoId().withMessage('Material is required'),
    body('startingWeight').exists().withMessage('Starting weight is required').bail().isFloat({ min: 0 }).withMessage('Starting weight must be a non-negative number'),
    body('remainingWeight').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Remaining weight must be non-negative'),
    body('sourceRailcarID').optional().isString().withMessage('Railcar ID must be text'),
    body('notes').optional().isString().withMessage('Notes must be text'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const [customer, material] = await Promise.all([
        Customer.findById(req.body.customerName).select('_id enableGroundInventory'),
        Material.findById(req.body.materialName).select('_id customerName isActive'),
      ]);

      if (!customer) return res.status(404).json({ message: 'Customer not found' });
      if (!material) return res.status(404).json({ message: 'Material not found' });
      if (material.isActive === false) return res.status(400).json({ message: 'Inactive material cannot be adjusted' });
      if (String(material.customerName || '') !== String(customer._id)) {
        return res.status(400).json({ message: 'Material must belong to the selected customer' });
      }

      const startingWeight = Number(req.body.startingWeight);
      const remainingWeight = req.body.remainingWeight == null ? startingWeight : Number(req.body.remainingWeight);
      if (remainingWeight > startingWeight) {
        return res.status(400).json({ message: 'Remaining weight cannot exceed starting weight' });
      }

      const lot = await GroundInventoryLot.create({
        customerName: customer._id,
        materialName: material._id,
        sourceType: 'manual_adjustment',
        sourceRailcarID: String(req.body.sourceRailcarID || '').trim(),
        startingWeight,
        remainingWeight,
        receivedAt: new Date(),
        receivedBy: req.user?.id || null,
        status: remainingWeight > 0 ? 'available' : 'depleted',
        notes: String(req.body.notes || '').trim(),
      });

      await lot.populate('customerName', 'customerName');
      await lot.populate('materialName', 'materialName refNum');
      return res.status(201).json({ message: 'Ground inventory adjustment created', lot });
    } catch (err) {
      console.error('Error creating ground inventory adjustment:', err);
      return res.status(500).json({ message: 'Server error while creating ground inventory adjustment' });
    }
  }
);

router.put(
  '/adjustments/:id',
  authorizeRoles(['internal', 'admin']),
  [
    body('customerName').notEmpty().isMongoId().withMessage('Customer is required'),
    body('materialName').notEmpty().isMongoId().withMessage('Material is required'),
    body('startingWeight').exists().withMessage('Starting weight is required').bail().isFloat({ min: 0 }).withMessage('Starting weight must be a non-negative number'),
    body('remainingWeight').exists().withMessage('Remaining weight is required').bail().isFloat({ min: 0 }).withMessage('Remaining weight must be a non-negative number'),
    body('sourceRailcarID').optional().isString().withMessage('Railcar ID must be text'),
    body('notes').optional().isString().withMessage('Notes must be text'),
  ],
  async (req, res) => {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid lot id' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const lot = await GroundInventoryLot.findById(req.params.id);
      if (!lot) return res.status(404).json({ message: 'Ground inventory lot not found' });
      if (lot.sourceType !== 'manual_adjustment') {
        return res.status(400).json({ message: 'Only manual adjustment lots can be edited' });
      }

      const [customer, material] = await Promise.all([
        Customer.findById(req.body.customerName).select('_id'),
        Material.findById(req.body.materialName).select('_id customerName isActive'),
      ]);

      if (!customer) return res.status(404).json({ message: 'Customer not found' });
      if (!material) return res.status(404).json({ message: 'Material not found' });
      if (material.isActive === false) return res.status(400).json({ message: 'Inactive material cannot be used' });
      if (String(material.customerName || '') !== String(customer._id)) {
        return res.status(400).json({ message: 'Material must belong to the selected customer' });
      }

      const startingWeight = Number(req.body.startingWeight);
      const remainingWeight = Number(req.body.remainingWeight);

      if (remainingWeight > startingWeight) {
        return res.status(400).json({ message: 'Remaining weight cannot exceed starting weight' });
      }

      const allocations = await GroundInventoryAllocation.aggregate([
        { $match: { lotId: lot._id } },
        { $group: { _id: null, totalAllocatedWeight: { $sum: '$allocatedWeight' } } },
      ]);
      const allocatedWeight = Number(allocations[0]?.totalAllocatedWeight || 0);
      if (startingWeight < allocatedWeight) {
        return res.status(400).json({
          message: `Starting weight cannot be less than allocated weight (${allocatedWeight})`,
        });
      }

      lot.customerName = customer._id;
      lot.materialName = material._id;
      lot.sourceRailcarID = String(req.body.sourceRailcarID || '').trim();
      lot.startingWeight = startingWeight;
      lot.remainingWeight = remainingWeight;
      lot.status = remainingWeight > 0 ? 'available' : 'depleted';
      lot.notes = String(req.body.notes || '').trim();

      await lot.save();
      await lot.populate('customerName', 'customerName');
      await lot.populate('materialName', 'materialName refNum');

      return res.status(200).json({ message: 'Ground inventory adjustment updated', lot });
    } catch (err) {
      console.error('Error updating ground inventory adjustment:', err);
      return res.status(500).json({ message: 'Server error while updating ground inventory adjustment' });
    }
  }
);

router.delete('/adjustments/:id', authorizeRoles(['internal', 'admin']), async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid lot id' });
  }

  try {
    const lot = await GroundInventoryLot.findById(req.params.id).select('_id sourceType');
    if (!lot) return res.status(404).json({ message: 'Ground inventory lot not found' });
    if (lot.sourceType !== 'manual_adjustment') {
      return res.status(400).json({ message: 'Only manual adjustment lots can be deleted' });
    }

    const allocationCount = await GroundInventoryAllocation.countDocuments({ lotId: lot._id });
    if (allocationCount > 0) {
      return res.status(409).json({ message: 'Cannot delete lot with existing allocations' });
    }

    await GroundInventoryLot.deleteOne({ _id: lot._id });
    return res.status(200).json({ message: 'Ground inventory adjustment deleted' });
  } catch (err) {
    console.error('Error deleting ground inventory adjustment:', err);
    return res.status(500).json({ message: 'Server error while deleting ground inventory adjustment' });
  }
});

router.get('/allocations', authorizeRoles(['internal', 'admin']), async (req, res) => {
  try {
    const query = {};
    if (req.query.customerId) {
      if (!isValidObjectId(req.query.customerId)) {
        return res.status(400).json({ message: 'Invalid customerId query parameter' });
      }
      query.customerName = req.query.customerId;
    }

    if (req.query.bolId) {
      if (!isValidObjectId(req.query.bolId)) {
        return res.status(400).json({ message: 'Invalid bolId query parameter' });
      }
      query.bolId = req.query.bolId;
    }

    if (req.query.lotId) {
      if (!isValidObjectId(req.query.lotId)) {
        return res.status(400).json({ message: 'Invalid lotId query parameter' });
      }
      query.lotId = req.query.lotId;
    }

    const allocations = await GroundInventoryAllocation.find(query)
      .sort({ createdAt: -1 })
      .populate('lotId')
      .populate({
        path: 'bolId',
        select: 'orderNumber projectName bolDate status netWeight tonWeight',
        populate: [
          {
            path: 'orderNumber',
            select: 'orderNumber projectName',
            populate: {
              path: 'projectName',
              select: 'projectName',
            },
          },
          {
            path: 'projectName',
            select: 'projectName',
          },
        ],
      })
      .populate('customerName', 'customerName')
      .populate('materialName', 'materialName refNum')
      .populate('createdBy', 'firstName lastName fullName email');

    return res.status(200).json(allocations);
  } catch (err) {
    console.error('Error fetching ground inventory allocations:', err);
    return res.status(500).json({ message: 'Server error while fetching ground inventory allocations' });
  }
});

module.exports = router;
