const express = require('express');
const { body, validationResult } = require('express-validator');
const { isValidObjectId } = require('mongoose');
const router = express.Router();
const BOL = require('../models/BOL');
const Order = require('../models/Order');
const Railcar = require('../models/Railcar');
const Customer = require('../models/Customer');
const User = require('../models/User');
const GroundInventoryLot = require('../models/GroundInventoryLot');
const GroundInventoryAllocation = require('../models/GroundInventoryAllocation');
const { sendAppEmail } = require('../utils/email');
const { buildBolPdfAttachment } = require('../utils/bol-pdf');
const {
  requireAuth,
  authorizeRoles,
  isCustomerUser,
  customerIdFromToken,
} = require('../middleware/auth');

const isSameCustomer = (a, b) => String(a) === String(b);
const trimToString = (value) => String(value || '').trim();
const normalizeInventorySource = (value) => (String(value || '').trim().toLowerCase() === 'ground' ? 'ground' : 'railcar');
const toNumberOrNull = (value) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseMonthWindow = (yearValue, monthValue) => {
  const now = new Date();
  const year = Number(yearValue) || now.getFullYear();
  const month = Number(monthValue) || now.getMonth() + 1;

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { year, month, start, end };
};

const csvEscape = (value) => {
  if (value == null) return '';
  const raw = String(value);
  if (raw.includes('"') || raw.includes(',') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

const formatAddress = (entity = {}, fields = []) => fields.map((field) => entity?.[field]).filter(Boolean).join(', ');

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
  body('railcarID')
    .custom((value, { req }) => {
      const source = normalizeInventorySource(req.body.inventorySource);
      if (source === 'ground') return true;
      return Boolean(String(value || '').trim());
    })
    .withMessage('Railcar ID is required for railcar inventory source'),
  body('truckID').notEmpty().withMessage('Truck ID is required'),
  body('trailerID').notEmpty().withMessage('Trailer ID is required'),
  body('createdBy').notEmpty().isMongoId().withMessage('Created by is required and must be a valid user ID'),
  body('inventorySource')
    .optional()
    .isIn(['railcar', 'ground'])
    .withMessage('Inventory source must be railcar or ground'),
  body('groundInventoryLot')
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage('Ground inventory lot must be a valid ID'),
  body('secondaryGroundInventoryLot')
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage('Secondary ground inventory lot must be a valid ID'),
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

const ensureGroundInventoryLotIsUsable = async ({ lotId, customerId, materialId }) => {
  if (!lotId) return { ok: false, message: 'Ground inventory lot is required for ground-source BOLs' };
  if (!isValidObjectId(lotId)) return { ok: false, message: 'Ground inventory lot is invalid' };

  const lot = await GroundInventoryLot.findById(lotId).select('customerName materialName remainingWeight status');
  if (!lot) return { ok: false, message: 'Ground inventory lot not found' };
  if (String(lot.customerName || '') !== String(customerId || '')) {
    return { ok: false, message: 'Ground inventory lot does not belong to this customer' };
  }
  if (String(lot.materialName || '') !== String(materialId || '')) {
    return { ok: false, message: 'Ground inventory lot does not match this material' };
  }
  if (lot.status === 'archived' || Number(lot.remainingWeight || 0) <= 0) {
    return { ok: false, message: 'Ground inventory lot is not available' };
  }
  return { ok: true, lot };
};

const consumeGroundInventoryLot = async ({ lotId, customerId, materialId, weight }) => {
  const consumeWeight = Number(weight || 0);
  if (!Number.isFinite(consumeWeight) || consumeWeight < 0) {
    return { ok: false, message: 'Invalid ground inventory consume weight' };
  }
  if (consumeWeight === 0) {
    const lot = await GroundInventoryLot.findOne({
      _id: lotId,
      customerName: customerId,
      materialName: materialId,
      status: { $in: ['available', 'depleted'] },
    });
    if (!lot) return { ok: false, message: 'Ground inventory lot not found while completing BOL' };
    return { ok: true, lot, consumedWeight: 0 };
  }

  const lot = await GroundInventoryLot.findOneAndUpdate(
    {
      _id: lotId,
      customerName: customerId,
      materialName: materialId,
      status: { $in: ['available', 'depleted'] },
      remainingWeight: { $gte: consumeWeight },
    },
    {
      $inc: { remainingWeight: -consumeWeight },
      $set: { status: 'available' },
    },
    { new: true }
  );

  if (!lot) return { ok: false, message: 'Ground inventory lot does not have enough remaining weight to complete this BOL' };

  if (Number(lot.remainingWeight || 0) <= 0 && lot.status !== 'depleted') {
    lot.status = 'depleted';
    await lot.save();
  }

  return { ok: true, lot, consumedWeight: consumeWeight };
};

router.post('/', authorizeRoles(['internal', 'admin']), baseCreateValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const bolData = { ...req.body };
  bolData.inventorySource = normalizeInventorySource(bolData.inventorySource);

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
      if (draftTare < 0) {
        return res.status(400).json({ message: 'Draft tare weight cannot be negative' });
      }
      bolData.tareWeight = draftTare;
    } else {
      bolData.tareWeight = null;
    }
  }

  const createGrossWeight = toNumberOrNull(bolData.grossWeight);
  const createTareWeight = toNumberOrNull(bolData.tareWeight);
  const createSecondaryGrossWeight = toNumberOrNull(bolData.secondaryGrossWeight);
  const createSecondaryTareWeight = toNumberOrNull(bolData.secondaryTareWeight);

  if (createGrossWeight != null && createGrossWeight < 0) {
    return res.status(400).json({ message: 'Primary gross weight cannot be negative' });
  }
  if (createTareWeight != null && createTareWeight < 0) {
    return res.status(400).json({ message: 'Primary tare weight cannot be negative' });
  }
  if (createGrossWeight != null && createTareWeight != null && createGrossWeight < createTareWeight) {
    return res.status(400).json({ message: 'Primary gross weight must be greater than or equal to primary tare weight' });
  }
  if (createSecondaryGrossWeight != null && createSecondaryGrossWeight < 0) {
    return res.status(400).json({ message: 'Secondary gross weight cannot be negative' });
  }
  if (createSecondaryTareWeight != null && createSecondaryTareWeight < 0) {
    return res.status(400).json({ message: 'Secondary tare weight cannot be negative' });
  }
  if (
    createSecondaryGrossWeight != null
    && createSecondaryTareWeight != null
    && createSecondaryGrossWeight < createSecondaryTareWeight
  ) {
    return res.status(400).json({ message: 'Secondary gross weight must be greater than or equal to secondary tare weight' });
  }

  try {
    bolData.railcarID = bolData.inventorySource === 'ground' ? '' : trimToString(bolData.railcarID);
    bolData.railShipmentBolNumber = trimToString(bolData.railShipmentBolNumber);
    bolData.groundInventoryLot = bolData.groundInventoryLot || null;
    bolData.secondaryGroundInventoryLot = bolData.secondaryGroundInventoryLot || null;

    if (bolData.inventorySource === 'ground') {
      bolData.secondaryRailcarID = '';
      bolData.secondaryGrossWeight = null;
      bolData.secondaryTareWeight = null;
      bolData.secondaryNetWeight = null;
      bolData.secondaryTonWeight = null;
      bolData.railShipmentBolNumber = '';
      bolData.secondaryRailShipmentBolNumber = '';

      const lotCheck = await ensureGroundInventoryLotIsUsable({
        lotId: bolData.groundInventoryLot,
        customerId: bolData.customerName,
        materialId: bolData.materialName,
      });
      if (!lotCheck.ok) {
        return res.status(400).json({ message: lotCheck.message });
      }

      if (bolData.splitLoad) {
        if (!bolData.secondaryGroundInventoryLot) {
          return res.status(400).json({ message: 'Secondary ground inventory lot is required for split ground loads' });
        }
        if (String(bolData.secondaryGroundInventoryLot) === String(bolData.groundInventoryLot)) {
          return res.status(400).json({ message: 'Primary and secondary ground inventory lots must be different' });
        }
        const secondaryLotCheck = await ensureGroundInventoryLotIsUsable({
          lotId: bolData.secondaryGroundInventoryLot,
          customerId: bolData.customerName,
          materialId: bolData.materialName,
        });
        if (!secondaryLotCheck.ok) {
          return res.status(400).json({ message: secondaryLotCheck.message });
        }
      } else {
        bolData.secondaryGroundInventoryLot = null;
      }
    } else {
      bolData.secondaryGroundInventoryLot = null;
    }

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

router.get('/reports/truck-weigh-ins', authorizeRoles(['internal', 'admin']), async (req, res) => {
  try {
    const monthWindow = parseMonthWindow(req.query.year, req.query.month);
    if (!monthWindow) {
      return res.status(400).json({ message: 'Invalid year/month query parameters' });
    }

    const query = {
      weighInTime: { $gte: monthWindow.start, $lt: monthWindow.end },
    };

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

    const weighIns = await BOL.find(query)
      .sort({ weighInTime: -1 })
      .populate('customerName', 'customerName')
      .populate('materialName', 'materialName refNum')
      .populate('projectName', 'projectName')
      .populate('orderNumber', 'orderNumber')
      .lean();

    const rows = weighIns.map((bol) => {
      const customerId = String(bol.customerName?._id || bol.customerName || '');
      const customerName = bol.customerName?.customerName || 'Unknown Customer';
      const weighInTime = bol.weighInTime ? new Date(bol.weighInTime) : null;

      return {
        bolId: String(bol._id),
        customerId,
        customerName,
        orderNumber: bol.orderNumber?.orderNumber || '',
        bolDate: bol.bolDate || null,
        weighInTime: weighInTime ? weighInTime.toISOString() : null,
        truckID: bol.truckID || '',
        trailerID: bol.trailerID || '',
        railcarID: bol.railcarID || '',
        materialName: bol.materialName?.materialName || '',
        materialRefNum: bol.materialName?.refNum || '',
        locationName: bol.projectName?.projectName || '',
        tareWeight: Number(bol.tareWeight || 0),
        status: bol.status || 'Draft',
      };
    });

    const byCustomerMap = new Map();
    rows.forEach((row) => {
      if (!byCustomerMap.has(row.customerId)) {
        byCustomerMap.set(row.customerId, {
          customerId: row.customerId,
          customerName: row.customerName,
          weighInCount: 0,
        });
      }
      const bucket = byCustomerMap.get(row.customerId);
      bucket.weighInCount += 1;
    });

    const byCustomer = [...byCustomerMap.values()].sort((a, b) =>
      String(a.customerName).localeCompare(String(b.customerName), undefined, { sensitivity: 'base' })
    );

    const grandTotal = {
      weighInCount: rows.length,
    };

    if ((req.query.format || '').toLowerCase() === 'csv') {
      const header = [
        'Customer',
        'Order Number',
        'BOL ID',
        'BOL Date',
        'Weigh In Time',
        'Truck ID',
        'Trailer ID',
        'Railcar ID',
        'Material',
        'Material Ref',
        'Location',
        'Tare Weight',
        'Status',
      ];

      const csvRows = rows.map((row) => [
        row.customerName,
        row.orderNumber,
        row.bolId,
        row.bolDate || '',
        row.weighInTime || '',
        row.truckID,
        row.trailerID,
        row.railcarID,
        row.materialName,
        row.materialRefNum,
        row.locationName,
        row.tareWeight,
        row.status,
      ]);

      const content = [header, ...csvRows]
        .map((line) => line.map(csvEscape).join(','))
        .join('\n');

      const mm = String(monthWindow.month).padStart(2, '0');
      const fileName = `truck-weigh-ins-${monthWindow.year}-${mm}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.status(200).send(content);
    }

    return res.status(200).json({
      month: {
        year: monthWindow.year,
        month: monthWindow.month,
        start: monthWindow.start.toISOString(),
        end: monthWindow.end.toISOString(),
      },
      byCustomer,
      grandTotal,
      rows,
    });
  } catch (err) {
    console.error('Error generating truck weigh-in report:', err);
    return res.status(500).json({ message: 'Server error while generating truck weigh-in report' });
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
      .populate('groundInventoryLot', 'startingWeight remainingWeight status sourceType sourceRailcarID sourceRailShipmentBolNumber')
      .populate('secondaryGroundInventoryLot', 'startingWeight remainingWeight status sourceType sourceRailcarID sourceRailShipmentBolNumber')
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
      .populate('groundInventoryLot', 'startingWeight remainingWeight status sourceType sourceRailcarID sourceRailShipmentBolNumber')
      .populate('secondaryGroundInventoryLot', 'startingWeight remainingWeight status sourceType sourceRailcarID sourceRailShipmentBolNumber')
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
    const inventorySource = normalizeInventorySource(req.body.inventorySource || bol.inventorySource);
    const groundInventoryLotId = req.body.groundInventoryLot || bol.groundInventoryLot;
    const secondaryGroundInventoryLotId = req.body.secondaryGroundInventoryLot || bol.secondaryGroundInventoryLot;
    if (inventorySource === 'ground') {
      const lotCheck = await ensureGroundInventoryLotIsUsable({
        lotId: groundInventoryLotId,
        customerId: bol.customerName,
        materialId: bol.materialName,
      });
      if (!lotCheck.ok) {
        return res.status(400).json({ message: lotCheck.message });
      }

      if (splitLoad) {
        if (!secondaryGroundInventoryLotId) {
          return res.status(400).json({ message: 'Secondary ground inventory lot is required for split ground loads' });
        }
        if (String(secondaryGroundInventoryLotId) === String(groundInventoryLotId)) {
          return res.status(400).json({ message: 'Primary and secondary ground inventory lots must be different' });
        }
        const secondaryLotCheck = await ensureGroundInventoryLotIsUsable({
          lotId: secondaryGroundInventoryLotId,
          customerId: bol.customerName,
          materialId: bol.materialName,
        });
        if (!secondaryLotCheck.ok) {
          return res.status(400).json({ message: secondaryLotCheck.message });
        }
      }
    }

    if (inventorySource !== 'ground' && splitLoad) {
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

    if (inventorySource === 'ground' && splitLoad) {
      if (req.body.secondaryGrossWeight == null || req.body.secondaryGrossWeight === '') {
        return res.status(400).json({ message: 'Secondary gross weight is required for split loads' });
      }
    }

    const primaryGrossWeight = Number(req.body.grossWeight);
    const primaryTareWeight = Number(req.body.tareWeight);
    if (!Number.isFinite(primaryGrossWeight) || !Number.isFinite(primaryTareWeight)) {
      return res.status(400).json({ message: 'Primary gross/tare weights must be valid numbers' });
    }
    if (primaryGrossWeight < 0 || primaryTareWeight < 0) {
      return res.status(400).json({ message: 'Primary gross/tare weights cannot be negative' });
    }
    if (primaryGrossWeight < primaryTareWeight) {
      return res.status(400).json({ message: 'Primary gross weight must be greater than or equal to primary tare weight' });
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
      if (secondaryGrossWeight < 0 || secondaryTareWeight < 0) {
        return res.status(400).json({ message: 'Secondary gross/tare weights cannot be negative for split loads' });
      }
      if (secondaryGrossWeight < secondaryTareWeight) {
        return res.status(400).json({ message: 'Secondary gross weight must be greater than or equal to secondary tare weight for split loads' });
      }
    }

    bol.grossWeight = primaryGrossWeight;
    bol.tareWeight = primaryTareWeight;
    bol.inventorySource = inventorySource;
    bol.groundInventoryLot = inventorySource === 'ground' ? groundInventoryLotId : null;
    bol.secondaryGroundInventoryLot = inventorySource === 'ground' && splitLoad ? secondaryGroundInventoryLotId : null;
    bol.splitLoad = splitLoad;
    bol.railcarID = inventorySource === 'ground' ? '' : trimToString(bol.railcarID);
    bol.secondaryRailcarID = inventorySource === 'ground' ? '' : splitLoad ? String(req.body.secondaryRailcarID || '').trim() : '';
    bol.secondaryGrossWeight = splitLoad ? secondaryGrossWeight : null;
    bol.secondaryTareWeight = splitLoad ? secondaryTareWeight : null;
    bol.secondaryNetWeight = null;
    bol.secondaryTonWeight = null;
    bol.weighInTime = weighInTime;
    bol.weighOutTime = weighOutTime;
    bol.driverName = String(req.body.driverName || '').trim();
    bol.driverSignatureImage = req.body.driverSignatureImage;
    bol.signedAt = req.body.signedAt ? new Date(req.body.signedAt) : new Date();
    bol.comments = req.body.comments ?? bol.comments;

    if (inventorySource === 'railcar' && bol.customerName && bol.railcarID) {
      bol.railShipmentBolNumber = await findActiveRailcarShipmentBol({
        customerId: bol.customerName,
        railcarID: bol.railcarID,
      });
    } else {
      bol.railShipmentBolNumber = '';
    }

    if (inventorySource === 'railcar' && splitLoad && bol.customerName && bol.secondaryRailcarID) {
      bol.secondaryRailShipmentBolNumber = await findActiveRailcarShipmentBol({
        customerId: bol.customerName,
        railcarID: bol.secondaryRailcarID,
      });
    } else {
      bol.secondaryRailShipmentBolNumber = '';
    }

    let consumedWeight = null;
    let consumedPrimaryWeight = null;
    let consumedSecondaryWeight = null;
    let consumedPrimaryLot = null;
    let consumedSecondaryLot = null;
    if (inventorySource === 'ground') {
      consumedPrimaryWeight = primaryGrossWeight - primaryTareWeight;
      consumedSecondaryWeight = splitLoad ? (secondaryGrossWeight - secondaryTareWeight) : 0;
      consumedWeight = consumedPrimaryWeight + consumedSecondaryWeight;
      if (!Number.isFinite(consumedWeight)) {
        return res.status(400).json({ message: 'Unable to determine consumed ground inventory weight' });
      }
      if (consumedPrimaryWeight < 0 || consumedSecondaryWeight < 0 || consumedWeight < 0) {
        return res.status(400).json({ message: 'Computed ground inventory consumption cannot be negative' });
      }

      const consumePrimaryResult = await consumeGroundInventoryLot({
        lotId: bol.groundInventoryLot,
        customerId: bol.customerName,
        materialId: bol.materialName,
        weight: consumedPrimaryWeight,
      });
      if (!consumePrimaryResult.ok) {
        return res.status(400).json({ message: consumePrimaryResult.message });
      }
      consumedPrimaryLot = consumePrimaryResult.lot;

      if (splitLoad) {
        const consumeSecondaryResult = await consumeGroundInventoryLot({
          lotId: bol.secondaryGroundInventoryLot,
          customerId: bol.customerName,
          materialId: bol.materialName,
          weight: consumedSecondaryWeight,
        });
        if (!consumeSecondaryResult.ok) {
          if (consumedPrimaryLot && Number(consumedPrimaryWeight || 0) > 0) {
            await GroundInventoryLot.findByIdAndUpdate(consumedPrimaryLot._id, {
              $inc: { remainingWeight: consumedPrimaryWeight },
              $set: { status: 'available' },
            });
          }
          return res.status(400).json({ message: consumeSecondaryResult.message });
        }
        consumedSecondaryLot = consumeSecondaryResult.lot;
      }
    }

    bol.status = 'Completed';
    bol.completedAt = new Date();
    bol.completedBy = req.user.id;
    bol.groundInventoryAllocatedWeight = inventorySource === 'ground' ? consumedWeight : null;
    bol.secondaryGroundInventoryAllocatedWeight = inventorySource === 'ground' && splitLoad ? consumedSecondaryWeight : null;

    let saved;
    try {
      saved = await bol.save();
    } catch (saveErr) {
      if (inventorySource === 'ground') {
        if (consumedPrimaryLot && Number(consumedPrimaryWeight || 0) > 0) {
          await GroundInventoryLot.findByIdAndUpdate(consumedPrimaryLot._id, {
            $inc: { remainingWeight: consumedPrimaryWeight },
            $set: { status: 'available' },
          });
        }
        if (consumedSecondaryLot && Number(consumedSecondaryWeight || 0) > 0) {
          await GroundInventoryLot.findByIdAndUpdate(consumedSecondaryLot._id, {
            $inc: { remainingWeight: consumedSecondaryWeight },
            $set: { status: 'available' },
          });
        }
      }
      throw saveErr;
    }

    if (inventorySource === 'ground') {
      const allocationsToCreate = [];
      if (consumedPrimaryLot && Number(consumedPrimaryWeight || 0) > 0) {
        allocationsToCreate.push({
          lotId: consumedPrimaryLot._id,
          bolId: saved._id,
          customerName: saved.customerName,
          materialName: saved.materialName,
          allocatedWeight: consumedPrimaryWeight,
          allocationType: 'bol_completion',
          createdBy: req.user.id,
        });
      }
      if (consumedSecondaryLot && Number(consumedSecondaryWeight || 0) > 0) {
        allocationsToCreate.push({
          lotId: consumedSecondaryLot._id,
          bolId: saved._id,
          customerName: saved.customerName,
          materialName: saved.materialName,
          allocatedWeight: consumedSecondaryWeight,
          allocationType: 'bol_completion',
          createdBy: req.user.id,
        });
      }
      if (allocationsToCreate.length) {
        await GroundInventoryAllocation.insertMany(allocationsToCreate);
      }
    }

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

router.post('/:id/email', authorizeRoles(['internal', 'admin']), async (req, res) => {
  try {
    const bol = await BOL.findById(req.params.id)
      .populate({
        path: 'orderNumber',
        populate: [
          { path: 'customerName', select: 'customerName customerLogo customerAddress1 customerAddress2 customerCity customerState customerZip' },
          { path: 'shipperName', select: 'shipperName' },
          { path: 'receiverName', select: 'receiverName billingAddress1 billingAddress2 billingCity billingState billingZip fullBillingAddress' },
          { path: 'projectName', select: 'projectName fullAddress' },
          { path: 'materialName', select: 'materialName refNum' },
        ],
      })
      .populate('customerName', 'customerName customerLogo customerAddress1 customerAddress2 customerCity customerState customerZip');

    if (!bol) {
      return res.status(404).json({ message: 'BOL not found' });
    }

    if (bol.status !== 'Completed') {
      return res.status(400).json({ message: 'Only completed BOLs can be emailed' });
    }

    const customerId = String(bol.customerName?._id || bol.customerName || '');
    if (!customerId) {
      return res.status(400).json({ message: 'BOL is missing customer association' });
    }

    const recipients = await User.find({
      customerName: customerId,
      isActive: { $ne: false },
      receiveBols: true,
    }).select('email firstName lastName');

    if (!recipients.length) {
      return res.status(400).json({
        message: 'No active customer users are opted in to receive BOL emails.',
      });
    }

    const customer = bol.orderNumber?.customerName || bol.customerName || {};
    const receiver = bol.orderNumber?.receiverName || {};
    const project = bol.orderNumber?.projectName || {};
    const material = bol.orderNumber?.materialName || {};
    const shipper = bol.orderNumber?.shipperName || {};
    const orderNo = bol.orderNumber?.orderNumber || 'N/A';
    const bolDateText = bol.bolDate ? new Date(bol.bolDate).toLocaleString() : 'N/A';
    const weighOutText = bol.weighOutTime ? new Date(bol.weighOutTime).toLocaleString() : 'N/A';
    const webBaseUrl = process.env.WEB_BASE_URL || process.env.FRONTEND_BASE_URL || '';
    const bolLink = webBaseUrl ? `${webBaseUrl.replace(/\/$/, '')}/bols/${bol._id}` : '';

    const customerAddress = formatAddress(customer, [
      'customerAddress1',
      'customerAddress2',
      'customerCity',
      'customerState',
      'customerZip',
    ]) || 'N/A';

    const locationAddress = project.fullAddress || 'N/A';
    const subject = `Completed BOL ${orderNo} - ${customer.customerName || 'Customer'}`;

    const textLines = [
      'A BOL has been completed.',
      '',
      `Order Number: ${orderNo}`,
      `BOL ID: ${bol._id}`,
      `BOL Date: ${bolDateText}`,
      `Completed At: ${weighOutText}`,
      `Customer: ${customer.customerName || 'N/A'}`,
      `Customer Address: ${customerAddress}`,
      `Material: ${material.materialName || 'N/A'}${material.refNum ? ` (${material.refNum})` : ''}`,
      `Location: ${project.projectName || 'N/A'}`,
      `Location Address: ${locationAddress}`,
      `Shipper: ${shipper.shipperName || 'N/A'}`,
      `Railcar: ${bol.railcarID || 'N/A'}`,
      `Truck / Trailer: ${bol.truckID || 'N/A'} / ${bol.trailerID || 'N/A'}`,
      `Total Net Weight: ${bol.netWeight ?? 'N/A'}`,
      `Total Ton Weight: ${bol.tonWeight ?? 'N/A'}`,
      '',
      bolLink ? `View in portal: ${bolLink}` : 'Login to the portal to view and print this BOL.',
    ];

    const html = `
      <div style="font-family: Arial, sans-serif; color: #1f2937;">
        <h2 style="margin-bottom: 8px;">Completed BOL Notice</h2>
        <p style="margin-top: 0;">A BOL has been completed and is available for review.</p>
        <table style="border-collapse: collapse; width: 100%; max-width: 760px;">
          <tr><td style="padding: 6px; border: 1px solid #d1d5db;"><strong>Order Number</strong></td><td style="padding: 6px; border: 1px solid #d1d5db;">${orderNo}</td></tr>
          <tr><td style="padding: 6px; border: 1px solid #d1d5db;"><strong>BOL ID</strong></td><td style="padding: 6px; border: 1px solid #d1d5db;">${bol._id}</td></tr>
          <tr><td style="padding: 6px; border: 1px solid #d1d5db;"><strong>BOL Date</strong></td><td style="padding: 6px; border: 1px solid #d1d5db;">${bolDateText}</td></tr>
          <tr><td style="padding: 6px; border: 1px solid #d1d5db;"><strong>Completed At</strong></td><td style="padding: 6px; border: 1px solid #d1d5db;">${weighOutText}</td></tr>
          <tr><td style="padding: 6px; border: 1px solid #d1d5db;"><strong>Customer</strong></td><td style="padding: 6px; border: 1px solid #d1d5db;">${customer.customerName || 'N/A'}</td></tr>
          <tr><td style="padding: 6px; border: 1px solid #d1d5db;"><strong>Customer Address</strong></td><td style="padding: 6px; border: 1px solid #d1d5db;">${customerAddress}</td></tr>
          <tr><td style="padding: 6px; border: 1px solid #d1d5db;"><strong>Material</strong></td><td style="padding: 6px; border: 1px solid #d1d5db;">${material.materialName || 'N/A'}${material.refNum ? ` (${material.refNum})` : ''}</td></tr>
          <tr><td style="padding: 6px; border: 1px solid #d1d5db;"><strong>Location</strong></td><td style="padding: 6px; border: 1px solid #d1d5db;">${project.projectName || 'N/A'}</td></tr>
          <tr><td style="padding: 6px; border: 1px solid #d1d5db;"><strong>Location Address</strong></td><td style="padding: 6px; border: 1px solid #d1d5db;">${locationAddress}</td></tr>
          <tr><td style="padding: 6px; border: 1px solid #d1d5db;"><strong>Shipper</strong></td><td style="padding: 6px; border: 1px solid #d1d5db;">${shipper.shipperName || 'N/A'}</td></tr>
          <tr><td style="padding: 6px; border: 1px solid #d1d5db;"><strong>Railcar</strong></td><td style="padding: 6px; border: 1px solid #d1d5db;">${bol.railcarID || 'N/A'}</td></tr>
          <tr><td style="padding: 6px; border: 1px solid #d1d5db;"><strong>Truck / Trailer</strong></td><td style="padding: 6px; border: 1px solid #d1d5db;">${bol.truckID || 'N/A'} / ${bol.trailerID || 'N/A'}</td></tr>
          <tr><td style="padding: 6px; border: 1px solid #d1d5db;"><strong>Total Net Weight</strong></td><td style="padding: 6px; border: 1px solid #d1d5db;">${bol.netWeight ?? 'N/A'}</td></tr>
          <tr><td style="padding: 6px; border: 1px solid #d1d5db;"><strong>Total Ton Weight</strong></td><td style="padding: 6px; border: 1px solid #d1d5db;">${bol.tonWeight ?? 'N/A'}</td></tr>
        </table>
        ${bolLink ? `<p style="margin-top: 12px;"><a href="${bolLink}">Open BOL in portal</a></p>` : ''}
      </div>
    `;

    const recipientEmails = recipients.map((user) => user.email).filter(Boolean);
    const pdfAttachment = await buildBolPdfAttachment({
      bol,
      order: bol.orderNumber || {},
      customer,
      receiver,
      project,
      material,
      shipper,
    });
    const sendResult = await sendAppEmail({
      to: recipientEmails.join(','),
      subject,
      text: textLines.join('\n'),
      html,
      attachments: [pdfAttachment],
    });

    if (!sendResult.sent) {
      return res.status(500).json({ message: 'Failed to send BOL email' });
    }

    return res.status(200).json({
      message: `BOL email sent to ${recipientEmails.length} recipient(s).`,
      recipientCount: recipientEmails.length,
      recipients: recipientEmails,
      provider: sendResult.provider,
    });
  } catch (err) {
    console.error('Error sending BOL email:', err);
    return res.status(500).json({ message: 'Server error while sending BOL email' });
  }
});

router.delete('/:id', authorizeRoles(['internal', 'admin']), async (req, res) => {
  try {
    const existingBOL = await BOL.findById(req.params.id);
    if (!existingBOL) {
      return res.status(404).json({ message: 'BOL not found' });
    }

    if (existingBOL.status !== 'Draft') {
      return res.status(400).json({ message: 'Only Draft BOLs can be deleted' });
    }

    await BOL.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'BOL deleted successfully' });
  } catch (err) {
    console.error('Error deleting BOL:', err);
    res.status(500).json({ message: 'Server error while deleting BOL' });
  }
});

module.exports = router;




