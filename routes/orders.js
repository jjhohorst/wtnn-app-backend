const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { isValidObjectId } = require('mongoose');
const Order = require('../models/Order');
const Project = require('../models/Project');
const Receiver = require('../models/Receiver');
const Railcar = require('../models/Railcar');
const {
  requireAuth,
  authorizeRoles,
  isCustomerUser,
  customerIdFromToken,
} = require('../middleware/auth');

const isSameCustomer = (a, b) => String(a) === String(b);

const normalizeSplitLoadPayload = (payload = {}) => {
  const hasSplitLoad = Object.prototype.hasOwnProperty.call(payload, 'splitLoad');
  const hasPrimary = Object.prototype.hasOwnProperty.call(payload, 'railcarID');
  const hasSecondary = Object.prototype.hasOwnProperty.call(payload, 'secondaryRailcarID');
  const splitLoad = hasSplitLoad ? payload.splitLoad === true || payload.splitLoad === 'true' : undefined;

  const normalized = { ...payload };
  if (hasSplitLoad) normalized.splitLoad = splitLoad;
  if (hasPrimary) normalized.railcarID = String(payload.railcarID || '').trim();
  if (hasSecondary) {
    normalized.secondaryRailcarID = splitLoad === false ? '' : String(payload.secondaryRailcarID || '').trim();
  }

  return normalized;
};

const validatePreferredRailcars = async ({ customerId, railcarID, splitLoad, secondaryRailcarID }) => {
  const primary = String(railcarID || '').trim();
  const secondary = String(secondaryRailcarID || '').trim();

  if (splitLoad && !secondary) {
    return 'Secondary railcar is required when split load is enabled';
  }

  if (primary && secondary && primary === secondary) {
    return 'Primary and secondary railcars must be different';
  }

  const requested = [primary, secondary].filter(Boolean);
  for (const requestedRailcar of requested) {
    const railcar = await Railcar.findOne({
      customerName: customerId,
      railcarID: requestedRailcar,
      status: 'Available',
      isActive: { $ne: false },
    });

    if (!railcar) {
      return `Selected railcar "${requestedRailcar}" is not available for this customer`;
    }
  }

  return null;
};

router.use(requireAuth);

router.post(
  '/',
  authorizeRoles(['customer', 'internal', 'admin']),
  [
    body('customerName').notEmpty().isMongoId().withMessage('Customer name must be a valid ID'),
    body('projectName').notEmpty().isMongoId().withMessage('Project name must be a valid ID'),
    body('materialName').notEmpty().isMongoId().withMessage('Material name must be a valid ID'),
    body('shipperName').notEmpty().isMongoId().withMessage('Shipper name must be a valid ID'),
    body('receiverName').notEmpty().isMongoId().withMessage('Receiver name must be a valid ID'),
    body('orderNumber').notEmpty().withMessage('Order number is required'),
    body('pickUpDate').notEmpty().isISO8601().withMessage('Pick up date must be a valid date'),
    body('deliveryDate').notEmpty().isISO8601().withMessage('Delivery date must be a valid date'),
    body('createdBy').notEmpty().isMongoId().withMessage('Created by must be a valid user ID'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (isCustomerUser(req)) {
      const tokenCustomerId = customerIdFromToken(req);
      if (!tokenCustomerId) {
        return res.status(403).json({ message: 'Customer scope is missing from token' });
      }

      if (!isSameCustomer(req.body.customerName, tokenCustomerId)) {
        return res.status(403).json({ message: 'Customers can only create orders for their own account' });
      }

      if (String(req.body.createdBy) !== String(req.user.id)) {
        return res.status(403).json({ message: 'Customers can only create orders as themselves' });
      }
    }

    try {
      const normalizedPayload = normalizeSplitLoadPayload(req.body);
      req.body.splitLoad = normalizedPayload.splitLoad;
      req.body.railcarID = normalizedPayload.railcarID;
      req.body.secondaryRailcarID = normalizedPayload.secondaryRailcarID;

      const railcarValidationError = await validatePreferredRailcars({
        customerId: req.body.customerName,
        railcarID: req.body.railcarID,
        splitLoad: req.body.splitLoad,
        secondaryRailcarID: req.body.secondaryRailcarID,
      });
      if (railcarValidationError) {
        return res.status(400).json({ message: railcarValidationError });
      }

      const [project, receiver] = await Promise.all([
        Project.findById(req.body.projectName),
        Receiver.findById(req.body.receiverName),
      ]);

      if (!project) {
        return res.status(400).json({ message: 'Selected location was not found' });
      }

      if (!receiver) {
        return res.status(400).json({ message: 'Selected receiver was not found' });
      }

      if (!project.receiverName || String(project.receiverName) !== String(req.body.receiverName)) {
        return res.status(400).json({ message: 'Selected location is not associated with the selected receiver' });
      }

      if (isCustomerUser(req)) {
        const tokenCustomerId = customerIdFromToken(req);
        if (
          !project.customerName ||
          String(project.customerName) !== String(tokenCustomerId) ||
          !receiver.customerName ||
          String(receiver.customerName) !== String(tokenCustomerId)
        ) {
          return res.status(403).json({ message: 'Selected receiver/location is outside customer scope' });
        }
      }

      const newOrder = new Order(req.body);
      const savedOrder = await newOrder.save();
      res.status(201).json({ message: 'Order received successfully', order: savedOrder });
    } catch (err) {
      console.error('Error saving order:', err);
      res.status(500).json({ message: 'Server error while saving the order' });
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

    if (req.query.orderStatus) {
      query.orderStatus = req.query.orderStatus;
    }

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .populate('customerName', 'customerName customerLogo')
      .populate('shipperName', 'shipperName')
      .populate('projectName', 'projectName fullAddress')
      .populate('receiverName', 'receiverName')
      .populate('materialName', 'materialName refNum truckType')
      .populate('createdBy', 'firstName lastName fullName');

    res.status(200).json(orders);
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ message: 'Server error while fetching orders' });
  }
});

router.get('/:id', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('customerName', 'customerName customerLogo')
      .populate('shipperName', 'shipperName')
      .populate('projectName', 'projectName fullAddress')
      .populate('receiverName', 'receiverName')
      .populate('materialName', 'materialName refNum truckType')
      .populate('createdBy', 'firstName lastName fullName');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (isCustomerUser(req)) {
      const tokenCustomerId = customerIdFromToken(req);
      if (!tokenCustomerId || !isSameCustomer(order.customerName?._id || order.customerName, tokenCustomerId)) {
        return res.status(403).json({ message: 'Access forbidden: order is outside customer scope' });
      }
    }

    res.status(200).json(order);
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ message: 'Server error while fetching order' });
  }
});

router.put('/:id', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const existingOrder = await Order.findById(req.params.id);
    if (!existingOrder) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const payload = normalizeSplitLoadPayload(req.body);

    if (isCustomerUser(req)) {
      const tokenCustomerId = customerIdFromToken(req);
      if (!tokenCustomerId || !existingOrder.customerName || !isSameCustomer(existingOrder.customerName, tokenCustomerId)) {
        return res.status(403).json({ message: 'Access forbidden: order is outside customer scope' });
      }
      const currentStatus = existingOrder.orderStatus;
      const requestedStatus = payload.orderStatus;
      const statusOnlyUpdate = Object.keys(payload).every((key) => key === 'orderStatus');

      if (currentStatus === 'Draft') {
        const allowedStatuses = ['Draft', 'Submitted', 'Cancelled'];
        if (requestedStatus && !allowedStatuses.includes(requestedStatus)) {
          return res.status(400).json({ message: 'Invalid customer status transition' });
        }

        if (requestedStatus && requestedStatus !== 'Draft') {
          const editableFields = [
            'orderDate',
            'orderNumber',
            'shipperName',
            'receiverName',
            'projectName',
            'materialName',
            'railcarID',
            'splitLoad',
            'secondaryRailcarID',
            'pickUpDate',
            'deliveryDate',
            'accessCode',
            'notes',
            'createdBy',
            'customerName',
          ];
          editableFields.forEach((field) => delete payload[field]);
        }
      } else if (currentStatus === 'Submitted') {
        if (!(requestedStatus === 'Cancelled' && statusOnlyUpdate)) {
          return res.status(400).json({ message: 'Submitted orders can only be cancelled by customers' });
        }
      } else if (currentStatus === 'Shipped' || currentStatus === 'Completed') {
        return res.status(400).json({ message: 'Completed orders cannot be cancelled or modified by customers' });
      } else {
        return res.status(400).json({ message: 'This order can no longer be modified by customers' });
      }

      delete payload.customerName;
      delete payload.createdBy;
    }

    const hasRailcarSelectionChange =
      Object.prototype.hasOwnProperty.call(payload, 'customerName') ||
      Object.prototype.hasOwnProperty.call(payload, 'railcarID') ||
      Object.prototype.hasOwnProperty.call(payload, 'splitLoad') ||
      Object.prototype.hasOwnProperty.call(payload, 'secondaryRailcarID');

    if (hasRailcarSelectionChange) {
      const effectiveCustomerId = payload.customerName || existingOrder.customerName;
      const effectiveRailcarID = payload.railcarID !== undefined ? payload.railcarID : existingOrder.railcarID;
      const effectiveSplitLoad = payload.splitLoad !== undefined ? payload.splitLoad : Boolean(existingOrder.splitLoad);
      const effectiveSecondaryRailcarID = payload.secondaryRailcarID !== undefined
        ? payload.secondaryRailcarID
        : existingOrder.secondaryRailcarID;

      const railcarValidationError = await validatePreferredRailcars({
        customerId: effectiveCustomerId,
        railcarID: effectiveRailcarID,
        splitLoad: effectiveSplitLoad,
        secondaryRailcarID: effectiveSecondaryRailcarID,
      });
      if (railcarValidationError) {
        return res.status(400).json({ message: railcarValidationError });
      }
    }

    const updatedOrder = await Order.findByIdAndUpdate(req.params.id, payload, { new: true });
    res.status(200).json({ message: 'Order updated successfully', order: updatedOrder });
  } catch (err) {
    console.error('Error updating order:', err);
    res.status(500).json({ message: 'Server error while updating order' });
  }
});

router.delete('/:id', authorizeRoles(['internal', 'admin']), async (req, res) => {
  try {
    const deletedOrder = await Order.findByIdAndDelete(req.params.id);
    if (!deletedOrder) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.status(200).json({ message: 'Order deleted successfully' });
  } catch (err) {
    console.error('Error deleting order:', err);
    res.status(500).json({ message: 'Server error while deleting order' });
  }
});

module.exports = router;
