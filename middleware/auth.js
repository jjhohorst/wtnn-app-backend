const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: 'Token required' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid token' });
    }

    req.user = decoded;
    next();
  });
};

const authorizeRoles = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access forbidden: insufficient rights' });
    }

    next();
  };
};

const isInternalUser = (req) => req.user && ['internal', 'admin'].includes(req.user.role);
const isCustomerUser = (req) => req.user && req.user.role === 'customer';

const customerIdFromToken = (req) => {
  if (!req.user || !req.user.customerId) return null;
  return String(req.user.customerId);
};

module.exports = {
  requireAuth,
  authorizeRoles,
  isInternalUser,
  isCustomerUser,
  customerIdFromToken,
};
