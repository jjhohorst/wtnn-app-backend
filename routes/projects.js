const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { isValidObjectId } = require('mongoose');
const Project = require('../models/Project');
const Receiver = require('../models/Receiver');
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
    body('receiverName').notEmpty().isMongoId().withMessage('Receiver is required'),
    body('projectName').notEmpty().withMessage('Location Name is required'),
    body('projectAddress1').notEmpty().withMessage('Location Address is required'),
    body('projectCity').notEmpty().withMessage('Location City is required'),
    body('projectState').notEmpty().withMessage('Location State is required'),
    body('projectZip').notEmpty().withMessage('Location Zip is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const projectData = { ...req.body };
      const receiver = await Receiver.findById(projectData.receiverName);
      if (!receiver) {
        return res.status(404).json({ message: 'Receiver not found' });
      }

      if (isCustomerUser(req)) {
        const tokenCustomerId = customerIdFromToken(req);
        if (!tokenCustomerId) {
          return res.status(403).json({ message: 'Customer scope is missing from token' });
        }

        if (!receiver.customerName || !isSameCustomer(receiver.customerName, tokenCustomerId)) {
          return res.status(403).json({ message: 'Access forbidden: receiver is outside customer scope' });
        }

        projectData.customerName = tokenCustomerId;
      } else {
        projectData.customerName = projectData.customerName || receiver.customerName;
      }

      const newProject = new Project(projectData);
      const savedProject = await newProject.save();
      res.status(201).json({ message: 'Location created successfully', project: savedProject });
    } catch (error) {
      console.error('Error creating location:', error);
      res.status(500).json({ message: 'Server error while creating location' });
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

    if (req.query.receiverId) {
      query.receiverName = req.query.receiverId;
    }

    const projects = await Project.find(query).populate('receiverName', 'receiverName');
    res.status(200).json(projects);
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ message: 'Server error while fetching locations' });
  }
});

router.get('/:id', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const project = await Project.findById(req.params.id).populate('receiverName', 'receiverName');
    if (!project) {
      return res.status(404).json({ message: 'Location not found' });
    }

    if (isCustomerUser(req)) {
      const tokenCustomerId = customerIdFromToken(req);
      if (!tokenCustomerId || !project.customerName || !isSameCustomer(project.customerName, tokenCustomerId)) {
        return res.status(403).json({ message: 'Access forbidden: location is outside customer scope' });
      }
    }

    res.status(200).json(project);
  } catch (error) {
    console.error('Error fetching location:', error);
    res.status(500).json({ message: 'Server error while fetching location' });
  }
});

router.put('/:id', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const existingProject = await Project.findById(req.params.id);
    if (!existingProject) {
      return res.status(404).json({ message: 'Location not found' });
    }

    if (isCustomerUser(req)) {
      const tokenCustomerId = customerIdFromToken(req);
      if (!tokenCustomerId || !existingProject.customerName || !isSameCustomer(existingProject.customerName, tokenCustomerId)) {
        return res.status(403).json({ message: 'Access forbidden: location is outside customer scope' });
      }
    }

    const payload = { ...req.body };

    if (payload.receiverName) {
      const receiver = await Receiver.findById(payload.receiverName);
      if (!receiver) {
        return res.status(404).json({ message: 'Receiver not found' });
      }

      if (isCustomerUser(req)) {
        const tokenCustomerId = customerIdFromToken(req);
        if (!receiver.customerName || !isSameCustomer(receiver.customerName, tokenCustomerId)) {
          return res.status(403).json({ message: 'Access forbidden: receiver is outside customer scope' });
        }
      }
    }

    if (isCustomerUser(req)) {
      delete payload.customerName;
    }

    const updatedProject = await Project.findByIdAndUpdate(req.params.id, payload, { new: true });
    res.status(200).json({ message: 'Location updated successfully', project: updatedProject });
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({ message: 'Server error while updating location' });
  }
});

router.delete('/:id', authorizeRoles(['internal', 'admin']), async (req, res) => {
  try {
    const deletedProject = await Project.findByIdAndDelete(req.params.id);
    if (!deletedProject) {
      return res.status(404).json({ message: 'Location not found' });
    }
    res.status(200).json({ message: 'Location deleted successfully' });
  } catch (error) {
    console.error('Error deleting location:', error);
    res.status(500).json({ message: 'Server error while deleting location' });
  }
});

module.exports = router;
