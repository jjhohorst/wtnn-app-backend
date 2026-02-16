const express = require('express');
const { body, validationResult } = require('express-validator');
const { isValidObjectId } = require('mongoose');
const router = express.Router();
const BOL = require('../models/BOL');
const Order = require('../models/Order');
const Railcar = require('../models/Railcar');
const {
  requireAuth,
  authorizeRoles,
  isCustomerUser,
  customerIdFromToken,
} = require('../middleware/auth');

const isSameCustomer = (a, b) => String(a) === String(b);
const trimToString = (value) => String(value || '').trim();

const findActiveRailcarShipmentBol = async ({ customerId, railcarID }) => {
  const normalizedCustomerId = trimToString(customerId);
  const normalizedRailcarID = trimToString(railcarID);
  if (!normalizedCustomerId || !normalizedRailcarID) return '';

  const railcar = await Railcar.findOne({
    customerName: normalizedCustomerId,
    railcarID: normalizedRailcarID,
    isActive: { $ne: false },
  }).select('railcarBolNumber');

  return trimToString(railcar?.railcarBolNumber);
};

const baseCreateValidation = [
  body('orderNumber').notEmpty().isMongoId().withMessage('Order number is required and must be a valid ID'),
  body('customerName').notEmpty().isMongoId().withMessage('Customer name is required and must be a valid ID'),
  body('shipperName').notEmpty().isMongoId().withMessage('Shipper name is required and must be a valid ID'),
  body('projectName').notEmpty().isMongoId().withMessage('Project name is required and must be a valid ID'),
  body('materialName').notEmpty().isMongoId().withMessage('Material name is required and must be a valid ID'),
  body('bolDate').notEmpty().isISO8601().withMessage('BOL date is required and must be valid'),
  body('railcarID').notEmpty().withMessage('Railcar ID is required'),
  body('truckID').notEmpty().withMessage('Truck ID is required'),
  body('trailerID').notEmpty().withMessage('Trailer ID is required'),
  body('createdBy').notEmpty().isMongoId().withMessage('Created by is required and must be a valid user ID'),
];

const completionValidation = [
  body('grossWeight').notEmpty().isNumeric().withMessage('Gross weight is required and must be numeric'),
  body('tareWeight').notEmpty().isNumeric().withMessage('Tare weight is required and must be numeric'),
  body('weighInTime').notEmpty().isISO8601().withMessage('Weigh in time is required and must be valid'),
  body('weighOutTime').notEmpty().isISO8601().withMessage('Weigh out time is required and must be valid'),
  body('driverName').notEmpty().withMessage('Driver name is required'),
  body('driverSignatureImage').notEmpty().withMessage('Driver signature is required'),
  body('splitLoad').optional().isBoolean().withMessage('Split load must be true or false'),
  body('secondaryRailcarID')
    .optional({ checkFalsy: true })
    .isString()
    .withMessage('Secondary railcar ID must be text'),
  body('secondaryGrossWeight')
    .optional({ checkFalsy: true })
    .isNumeric()
    .withMessage('Secondary gross weight must be numeric'),
  body('secondaryTareWeight')
    .optional({ checkFalsy: true })
    .isNumeric()
    .withMessage('Secondary tare weight must be numeric'),
];

router.use(requireAuth);

router.post('/', authorizeRoles(['internal', 'admin']), baseCreateValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const bolData = { ...req.body };

  const requestedStatus = bolData.status || 'Draft';
  if (!['Draft', 'Completed'].includes(requestedStatus)) {
    return res.status(400).json({ message: 'Invalid status. Use Draft or Completed.' });
  }

  if (requestedStatus === 'Completed') {
    for (const field of ['grossWeight', 'tareWeight', 'weighInTime', 'weighOutTime']) {
      if (bolData[field] == null || bolData[field] === '') {
        return res.status(400).json({ message: `Missing required completion field: ${field}` });
      }
    }
    bolData.status = 'Completed';
    bolData.completedAt = new Date();
    bolData.completedBy = bolData.completedBy || req.user.id;
  } else {
    bolData.status = 'Draft';
    if (bolData.tareWeight != null && bolData.tareWeight !== '') {
      const draftTare = Number(bolData.tareWeight);
      if (!Number.isFinite(draftTare)) {
        return res.status(400).json({ message: 'Draft tare weight must be numeric' });
      }
      bolData.tareWeight = draftTare;
    } else {
      bolData.tareWeight = null;
    }
  }

  try {
    bolData.railcarID = trimToString(bolData.railcarID);
    bolData.railShipmentBolNumber = trimToString(bolData.railShipmentBolNumber);

    if (!bolData.railShipmentBolNumber && bolData.customerName && bolData.railcarID) {
      bolData.railShipmentBolNumber = await findActiveRailcarShipmentBol({
        customerId: bolData.customerName,
        railcarID: bolData.railcarID,
      });
    }

    const newBOL = new BOL(bolData);
    const savedBOL = await newBOL.save();
    res.status(201).json({ message: 'BOL created successfully', bol: savedBOL });
  } catch (err) {
    console.error('Error creating BOL:', err);
    res.status(500).json({ message: 'Server error while creating BOL' });
  }
});

router.get('/railcars/unloads', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const match = { status: 'Completed' };

    if (isCustomerUser(req)) {
      const tokenCustomerId = customerIdFromToken(req);
      if (!tokenCustomerId) {
        return res.status(403).json({ message: 'Customer scope is missing from token' });
      }
      match.customerName = tokenCustomerId;
    } else if (req.query.customerId) {
      if (!isValidObjectId(req.query.customerId)) {
        return res.status(400).json({ message: 'Invalid customerId query parameter' });
      }
      match.customerName = req.query.customerId;
    }

    const summary = await BOL.aggregate([
      { $match: match },
      {
        $project: {
          weighOutTime: 1,
          railcarEntries: [
            {
              railcarID: '$railcarID',
              netWeight: {
                $ifNull: ['$primaryNetWeight', { $ifNull: ['$netWeight', 0] }],
              },
            },
            {
              railcarID: '$secondaryRailcarID',
              netWeight: { $ifNull: ['$secondaryNetWeight', 0] },
            },
          ],
        },
      },
      { $unwind: '$railcarEntries' },
      {
        $match: {
          'railcarEntries.railcarID': { $exists: true, $ne: '' },
        },
      },
      {
        $group: {
          _id: '$railcarEntries.railcarID',
          unloadCount: { $sum: 1 },
          totalNetWeight: { $sum: { $ifNull: ['$railcarEntries.netWeight', 0] } },
          totalTons: { $sum: { $divide: [{ $ifNull: ['$railcarEntries.netWeight', 0] }, 2000] } },
          latestUnloadAt: { $max: '$weighOutTime' },
        },
      },
      { $sort: { latestUnloadAt: -1 } },
    ]);

    res.status(200).json(
      summary.map((entry) => ({
        railcarID: entry._id,
        unloadCount: entry.unloadCount,
        totalNetWeight: entry.totalNetWeight,
        totalTons: entry.totalTons,
        latestUnloadAt: entry.latestUnloadAt,
      }))
    );
  } catch (err) {
    console.error('Error fetching railcar unload summary:', err);
    res.status(500).json({ message: 'Server error while fetching railcar unload summary' });
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

    if (req.query.status) {
      query.status = req.query.status;
    }

    if (req.query.railcarID) {
      query.$or = [
        { railcarID: req.query.railcarID },
        { secondaryRailcarID: req.query.railcarID },
      ];
    }

    if (req.query.railShipmentBolNumber) {
      const shipmentBol = trimToString(req.query.railShipmentBolNumber);
      if (shipmentBol) {
        const shipmentMatch = {
          $or: [
            { railShipmentBolNumber: shipmentBol },
            { secondaryRailShipmentBolNumber: shipmentBol },
          ],
        };
        if (query.$and) {
          query.$and.push(shipmentMatch);
        } else {
          query.$and = [shipmentMatch];
        }
      }
    }

    if (req.query.orderId) {
      if (!isValidObjectId(req.query.orderId)) {
        return res.status(400).json({ message: 'Invalid orderId query parameter' });
      }
      query.orderNumber = req.query.orderId;
    }

    const bols = await BOL.find(query)
      .sort({ createdAt: -1 })
      .populate({
        path: 'orderNumber',
        populate: [
          { path: 'customerName', select: 'customerName customerCode customerLogo customerAddress1 customerAddress2 customerCity customerState customerZip' },
          { path: 'shipperName', select: 'shipperName' },
          { path: 'receiverName', select: 'receiverName billingAddress1 billingAddress2 billingCity billingState billingZip fullBillingAddress' },
          { path: 'projectName', select: 'projectName fullAddress' },
          { path: 'materialName', select: 'materialName refNum truckType' },
        ],
      })
      .populate('customerName', 'customerName customerCode customerLogo customerAddress1 customerAddress2 customerCity customerState customerZip')
      .populate('createdBy', 'firstName lastName fullName')
      .populate('completedBy', 'firstName lastName fullName');

    res.status(200).json(bols);
  } catch (err) {
    console.error('Error fetching BOLs:', err);
    res.status(500).json({ message: 'Server error while fetching BOLs' });
  }
});

router.get('/:id', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const bol = await BOL.findById(req.params.id)
      .populate({
        path: 'orderNumber',
        populate: [
          { path: 'customerName', select: 'customerName customerCode customerLogo customerAddress1 customerAddress2 customerCity customerState customerZip' },
          { path: 'shipperName', select: 'shipperName' },
          { path: 'receiverName', select: 'receiverName billingAddress1 billingAddress2 billingCity billingState billingZip fullBillingAddress' },
          { path: 'projectName', select: 'projectName fullAddress' },
          { path: 'materialName', select: 'materialName refNum truckType' },
        ],
      })
      .populate('customerName', 'customerName customerCode customerLogo customerAddress1 customerAddress2 customerCity customerState customerZip')
      .populate('createdBy', 'firstName lastName fullName')
      .populate('completedBy', 'firstName lastName fullName');

    if (!bol) {
      return res.status(404).json({ message: 'BOL not found' });
    }

    if (isCustomerUser(req)) {
      const tokenCustomerId = customerIdFromToken(req);
      if (!tokenCustomerId || !isSameCustomer(bol.customerName?._id || bol.customerName, tokenCustomerId)) {
        return res.status(403).json({ message: 'Access forbidden: BOL is outside customer scope' });
      }
    }

    res.status(200).json(bol);
  } catch (err) {
    console.error('Error fetching BOL:', err);
    res.status(500).json({ message: 'Server error while fetching BOL' });
  }
});

router.put('/:id/complete', authorizeRoles(['internal', 'admin']), completionValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const bol = await BOL.findById(req.params.id);
    if (!bol) {
      return res.status(404).json({ message: 'BOL not found' });
    }

    if (bol.status === 'Completed') {
      return res.status(400).json({ message: 'Completed BOLs are locked and cannot be modified' });
    }

    const requiredRefFields = ['customerName', 'shipperName', 'projectName', 'materialName'];
    const missingBeforeBackfill = requiredRefFields.filter((field) => !bol[field]);

    if (missingBeforeBackfill.length > 0 && bol.orderNumber) {
      const linkedOrder = await Order.findById(bol.orderNumber)
        .select('customerName shipperName projectName materialName orderDate')
        .lean();

      if (linkedOrder) {
        if (!bol.customerName && linkedOrder.customerName) bol.customerName = linkedOrder.customerName;
        if (!bol.shipperName && linkedOrder.shipperName) bol.shipperName = linkedOrder.shipperName;
        if (!bol.projectName && linkedOrder.projectName) bol.projectName = linkedOrder.projectName;
        if (!bol.materialName && linkedOrder.materialName) bol.materialName = linkedOrder.materialName;
        if (!bol.bolDate) bol.bolDate = linkedOrder.orderDate || new Date();
      }
    }

    const missingAfterBackfill = requiredRefFields.filter((field) => !bol[field]);
    if (missingAfterBackfill.length > 0) {
      return res.status(400).json({
        message: `BOL is missing required fields: ${missingAfterBackfill.join(', ')}`,
      });
    }

    const splitLoad = req.body.splitLoad === true || req.body.splitLoad === 'true';
    if (splitLoad) {
      const secondaryRailcarID = String(req.body.secondaryRailcarID || '').trim();
      if (!secondaryRailcarID) {
        return res.status(400).json({ message: 'Secondary railcar ID is required for split loads' });
      }
      if (secondaryRailcarID === bol.railcarID) {
        return res.status(400).json({ message: 'Secondary railcar ID must be different from primary railcar ID' });
      }
      if (req.body.secondaryGrossWeight == null || req.body.secondaryGrossWeight === '') {
        return res.status(400).json({ message: 'Secondary gross weight is required for split loads' });
      }
    }

    const primaryGrossWeight = Number(req.body.grossWeight);
    const primaryTareWeight = Number(req.body.tareWeight);
    if (!Number.isFinite(primaryGrossWeight) || !Number.isFinite(primaryTareWeight)) {
      return res.status(400).json({ message: 'Primary gross/tare weights must be valid numbers' });
    }

    const weighInTime = new Date(req.body.weighInTime);
    const weighOutTime = new Date(req.body.weighOutTime);
    if (Number.isNaN(weighInTime.getTime()) || Number.isNaN(weighOutTime.getTime())) {
      return res.status(400).json({ message: 'Weigh in/out times must be valid dates' });
    }

    let secondaryGrossWeight = null;
    let secondaryTareWeight = null;
    if (splitLoad) {
      secondaryGrossWeight = Number(req.body.secondaryGrossWeight);
      secondaryTareWeight = primaryGrossWeight;
      if (!Number.isFinite(secondaryGrossWeight)) {
        return res.status(400).json({ message: 'Secondary gross weight must be a valid number for split loads' });
      }
    }

    bol.grossWeight = primaryGrossWeight;
    bol.tareWeight = primaryTareWeight;
    bol.splitLoad = splitLoad;
    bol.secondaryRailcarID = splitLoad ? String(req.body.secondaryRailcarID || '').trim() : '';
    bol.secondaryGrossWeight = secondaryGrossWeight;
    bol.secondaryTareWeight = secondaryTareWeight;
    bol.secondaryNetWeight = null;
    bol.secondaryTonWeight = null;
    bol.weighInTime = weighInTime;
    bol.weighOutTime = weighOutTime;
    bol.driverName = String(req.body.driverName || '').trim();
    bol.driverSignatureImage = req.body.driverSignatureImage;
    bol.signedAt = req.body.signedAt ? new Date(req.body.signedAt) : new Date();
    bol.comments = req.body.comments ?? bol.comments;

    if (bol.customerName && bol.railcarID) {
      bol.railShipmentBolNumber = await findActiveRailcarShipmentBol({
        customerId: bol.customerName,
        railcarID: bol.railcarID,
      });
    }

    if (splitLoad && bol.customerName && bol.secondaryRailcarID) {
      bol.secondaryRailShipmentBolNumber = await findActiveRailcarShipmentBol({
        customerId: bol.customerName,
        railcarID: bol.secondaryRailcarID,
      });
    } else {
      bol.secondaryRailShipmentBolNumber = '';
    }

    bol.status = 'Completed';
    bol.completedAt = new Date();
    bol.completedBy = req.user.id;

    const saved = await bol.save();

    res.status(200).json({ message: 'BOL completed successfully', bol: saved });
  } catch (err) {
    console.error('Error completing BOL:', err);

    if (err?.name === 'ValidationError' || err?.name === 'CastError') {
      return res.status(400).json({ message: err.message });
    }

    if (err?.code === 11000) {
      return res.status(400).json({ message: 'Duplicate value error while completing BOL' });
    }

    res.status(500).json({ message: err?.message || 'Server error while completing BOL' });
  }
});

router.put('/:id', authorizeRoles(['internal', 'admin']), async (req, res) => {
  try {
    const existingBOL = await BOL.findById(req.params.id);
    if (!existingBOL) {
      return res.status(404).json({ message: 'BOL not found' });
    }

    if (existingBOL.status === 'Completed') {
      return res.status(400).json({ message: 'Completed BOLs are locked and cannot be modified' });
    }

    const updatedBOL = await BOL.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.status(200).json({ message: 'BOL updated successfully', bol: updatedBOL });
  } catch (err) {
    console.error('Error updating BOL:', err);
    res.status(500).json({ message: 'Server error while updating BOL' });
  }
});

router.delete('/:id', authorizeRoles(['internal', 'admin']), async (req, res) => {
  try {
    const existingBOL = await BOL.findById(req.params.id);
    if (!existingBOL) {
      return res.status(404).json({ message: 'BOL not found' });
    }

    if (existingBOL.status === 'Completed') {
      return res.status(400).json({ message: 'Completed BOLs are locked and cannot be deleted' });
    }

    await BOL.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'BOL deleted successfully' });
  } catch (err) {
    console.error('Error deleting BOL:', err);
    res.status(500).json({ message: 'Server error while deleting BOL' });
  }
});

module.exports = router;




