const express = require('express');
const { isValidObjectId, Types } = require('mongoose');
const Railcar = require('../models/Railcar');
const Customer = require('../models/Customer');
const BOL = require('../models/BOL');
const User = require('../models/User');
const Material = require('../models/Material');
const {
  requireAuth,
  authorizeRoles,
  isCustomerUser,
  customerIdFromToken,
} = require('../middleware/auth');

const router = express.Router();

const splitCsv = (value = '') =>
  String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const getReleaseNotificationRecipients = async () => {
  const configured = splitCsv(process.env.RAILCAR_RELEASE_NOTIFY_TO);
  if (configured.length > 0) return configured;

  const adminUsers = await User.find({
    role: 'admin',
    isActive: { $ne: false },
    email: { $exists: true, $ne: '' },
  }).select('email');

  return adminUsers.map((u) => String(u.email).trim()).filter(Boolean);
};

const sendReleaseEmptyNotification = async ({ railcar, actor, customer }) => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || smtpUser;

  if (!host || !from) {
    return;
  }

  const recipients = await getReleaseNotificationRecipients();
  if (recipients.length === 0) {
    return;
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (err) {
    console.warn('Railcar release email skipped: nodemailer is not installed');
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
  });

  const actorName =
    actor && (actor.firstName || actor.lastName)
      ? `${actor.firstName || ''} ${actor.lastName || ''}`.trim()
      : actor?.email || 'Customer User';

  const customerName = customer?.customerName || 'Unknown Customer';
  const releasedAt = new Date().toLocaleString();
  const railcarLabel = railcar?.railcarID || `${railcar?.carInitial || ''} ${railcar?.carNumber || ''}`.trim();

  const subject = `Railcar Released Empty: ${railcarLabel}`;
  const text = [
    'A customer released a railcar as empty.',
    '',
    `Railcar: ${railcarLabel}`,
    `Customer: ${customerName}`,
    `Station: ${railcar?.station || 'N/A'}`,
    `Track: ${railcar?.track || 'N/A'}`,
    `Released By: ${actorName}`,
    `Released By Email: ${actor?.email || 'N/A'}`,
    `Released At: ${releasedAt}`,
  ].join('\n');

  await transporter.sendMail({
    from,
    to: recipients.join(', '),
    subject,
    text,
  });
};

const parseCsvLine = (line) => {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  values.push(current.trim());
  return values.map((v) => v.replace(/^"|"$/g, '').trim());
};

const normalizeHeader = (header = '') => String(header).toLowerCase().replace(/[^a-z0-9]/g, '');

const toNumberOrNull = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Number(raw.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeStatus = (rawStatus = '', hasReleaseDate = false) => {
  if (hasReleaseDate) return 'Released';

  const value = String(rawStatus || '').toLowerCase().trim();
  if (value.includes('release')) return 'Released';
  if (value.includes('avail')) return 'Available';
  if (value === 'y' || value.includes('storage') || value.includes('loaded')) return 'Available';
  if (value === 'l' || value === 'l ') return 'Available';
  return 'Inbound';
};

const csvEscape = (value) => {
  const raw = value == null ? '' : String(value);
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

const parseBooleanParam = (value, fallback = false) => {
  if (value == null) return fallback;
  const raw = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n'].includes(raw)) return false;
  return fallback;
};

const fetchRailcarsWithComputedWeights = async (query) => {
  const railcars = await Railcar.find(query)
    .sort({ currentStatus: 1, carInitial: 1, carNumber: 1 })
    .populate('customerName', 'customerName')
    .populate('materialName', 'materialName refNum');

  const railcarKeys = railcars.map((r) => ({
    railcarID: r.railcarID,
    customerId: String(r.customerName?._id || r.customerName),
    railShipmentBolNumber: String(r.railcarBolNumber || '').trim(),
  }));

  const railcarIdSet = [...new Set(railcarKeys.map((k) => String(k.railcarID || '').trim()).filter(Boolean))];
  const customerObjectIdSet = [...new Set(
    railcarKeys
      .map((k) => String(k.customerId || '').trim())
      .filter((id) => isValidObjectId(id))
  )].map((id) => new Types.ObjectId(id));

  const unloadAgg = railcarIdSet.length === 0 || customerObjectIdSet.length === 0
    ? []
    : await BOL.aggregate([
      {
        $match: {
          status: 'Completed',
          customerName: { $in: customerObjectIdSet },
        },
      },
      {
        $project: {
          customerName: 1,
          railcarEntries: [
            {
              railcarID: { $trim: { input: { $ifNull: ['$railcarID', ''] } } },
              railShipmentBolNumber: { $trim: { input: { $ifNull: ['$railShipmentBolNumber', ''] } } },
              netWeight: {
                $ifNull: [
                  '$primaryNetWeight',
                  {
                    $ifNull: [
                      '$netWeight',
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: ['$grossWeight', null] },
                              { $ne: ['$tareWeight', null] },
                            ],
                          },
                          { $subtract: ['$grossWeight', '$tareWeight'] },
                          0,
                        ],
                      },
                    ],
                  },
                ],
              },
            },
            {
              railcarID: { $trim: { input: { $ifNull: ['$secondaryRailcarID', ''] } } },
              railShipmentBolNumber: { $trim: { input: { $ifNull: ['$secondaryRailShipmentBolNumber', ''] } } },
              netWeight: {
                $ifNull: [
                  '$secondaryNetWeight',
                  {
                    $cond: [
                      {
                        $and: [
                          { $ne: ['$secondaryGrossWeight', null] },
                          { $ne: ['$secondaryTareWeight', null] },
                        ],
                      },
                      { $subtract: ['$secondaryGrossWeight', '$secondaryTareWeight'] },
                      0,
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
      { $unwind: '$railcarEntries' },
      {
        $match: {
          'railcarEntries.railcarID': { $in: railcarIdSet },
        },
      },
      {
        $group: {
          _id: {
            railcarID: '$railcarEntries.railcarID',
            customerName: '$customerName',
            railShipmentBolNumber: '$railcarEntries.railShipmentBolNumber',
          },
          unloadedWeight: { $sum: { $ifNull: ['$railcarEntries.netWeight', 0] } },
        },
      },
    ]);

  const unloadMap = new Map(
    unloadAgg.map((item) => [
      `${item._id.railcarID}|${String(item._id.customerName)}|${String(item._id.railShipmentBolNumber || '')}`,
      Number(item.unloadedWeight || 0),
    ])
  );

  return railcars.map((railcar) => {
    const customerId = String(railcar.customerName?._id || railcar.customerName);
    const railShipmentBolNumber = String(railcar.railcarBolNumber || '').trim();
    const unloadedWeight = unloadMap.get(`${railcar.railcarID}|${customerId}|${railShipmentBolNumber}`) || 0;
    const reportedWeight = Number(railcar.reportedWeight || 0);
    const remainingWeight = reportedWeight > 0 ? Math.max(reportedWeight - unloadedWeight, 0) : null;

    return {
      ...railcar.toObject(),
      unloadedWeight,
      remainingWeight,
    };
  });
};

const toRowObject = (raw) => {
  const row = raw || {};
  return {
    carInitial: row.carInitial || row['Car Initial'] || row.carinitial || row.equipmentinitial,
    carNumber: row.carNumber || row['Car Number'] || row.carnumber || row.equipmentnumber,
    commodity: row.commodity || row.Commodity || row.stccdescription,
    railcarBolNumber:
      row.railcarBolNumber ||
      row['Railcar BOL Number'] ||
      row['BOL Number'] ||
      row.bolnumber ||
      row.bol ||
      row.billofladingnumber ||
      row.billoflading,
    leStatus: row.leStatus || row['LE Status'] || row.lestatus,
    currentStatus:
      row.currentStatus ||
      row['Current Status'] ||
      row.status ||
      row.Status ||
      row.storagestatus ||
      row.storageind,
    station: row.station || row.Station || row.stationname || row.stationid,
    track: row.track || row.Track || row.trackname || row.trackid,
    trackPosition:
      row.trackPosition ||
      row.trackTrainPosition ||
      row['Track Train Position'] ||
      row.tracktrainposition ||
      row.track_train_position ||
      row.trackposition ||
      row.trainposition,
    customerCode:
      row.customerCode ||
      row['Customer Code'] ||
      row.customercode ||
      row.thecustomercustomerid ||
      row.blocktocustomerid,
    reportedWeight: row.reportedWeight || row.Weight || row.weight,
    releaseDate: row.releaseDate || row['Release Date'] || row.releasedate,
  };
};

const parseCsvRows = (csvText = '') => {
  const lines = String(csvText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    return toRowObject({
      carInitial: row.carinitial || row.equipmentinitial,
      carNumber: row.carnumber || row.equipmentnumber,
      commodity: row.commodity || row.stccdescription,
      railcarBolNumber:
        row.railcarbolnumber ||
        row.bolnumber ||
        row.bol ||
        row.billofladingnumber ||
        row.billoflading,
      leStatus: row.lestatus,
      currentStatus: row.currentstatus || row.status || row.storagestatus || row.storageind,
      station: row.station || row.stationname || row.stationid,
      track: row.track || row.trackname || row.trackid,
      trackPosition:
        row.tracktrainposition ||
        row.tracktrainpos ||
        row.trackposition ||
        row.trainposition,
      customerCode: row.customercode || row.thecustomercustomerid || row.blocktocustomerid,
      reportedWeight: row.weight,
      releaseDate: row.releasedate,
    });
  });
};

const requireIngestApiKey = (req, res, next) => {
  const configuredKey = process.env.RAILCAR_INGEST_API_KEY;
  if (!configuredKey) {
    return res.status(500).json({ message: 'RAILCAR_INGEST_API_KEY is not configured' });
  }

  const providedKey = req.headers['x-api-key'];
  if (!providedKey || providedKey !== configuredKey) {
    return res.status(401).json({ message: 'Invalid or missing ingestion API key' });
  }

  next();
};

const parseIngestRowsFromRequest = (req) => {
  const rowsFromJson = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const rowsFromCsv = req.body?.csv ? parseCsvRows(req.body.csv) : [];
  return [...rowsFromJson.map(toRowObject), ...rowsFromCsv];
};

const processRailcarIngest = async (inputRows) => {
  const customers = await Customer.find({}, '_id customerCode').lean();
  const customerCodeMap = new Map(
    customers.map((c) => [String(c.customerCode || '').trim().toUpperCase(), String(c._id)])
  );

  let upserted = 0;
  let deactivated = 0;
  const errors = [];
  const seenByCustomer = new Map();

  for (const row of inputRows) {
    const carInitial = String(row.carInitial || '').trim().toUpperCase();
    const carNumber = String(row.carNumber || '').trim();
    const customerCode = String(row.customerCode || '').trim().toUpperCase();

    if (!carInitial || !carNumber || !customerCode) {
      errors.push({
        row,
        message: 'Missing required fields (Car Initial, Car Number, Customer Code)',
      });
      continue;
    }

    const customerId = customerCodeMap.get(customerCode);
    if (!customerId) {
      errors.push({ row, message: `Customer Code "${customerCode}" was not found` });
      continue;
    }

    const hasReleaseDate = Boolean(String(row.releaseDate || '').trim());
    const normalizedStatus = normalizeStatus(row.currentStatus, hasReleaseDate);
    const update = {
      customerName: customerId,
      carInitial,
      carNumber,
      railcarID: `${carInitial} ${carNumber}`,
      commodity: String(row.commodity || '').trim(),
      leStatus: String(row.leStatus || '').trim(),
      currentStatus: normalizedStatus,
      status: normalizedStatus,
      station: String(row.station || '').trim(),
      track: String(row.track || '').trim(),
      trackPosition: String(row.trackPosition || '').trim(),
      reportedWeight: toNumberOrNull(row.reportedWeight),
      isActive: true,
    };

    const parsedRailcarBolNumber = String(row.railcarBolNumber || '').trim();
    if (parsedRailcarBolNumber) {
      update.railcarBolNumber = parsedRailcarBolNumber;
    }

    await Railcar.findOneAndUpdate(
      { customerName: customerId, carInitial, carNumber },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    upserted += 1;

    const key = `${carInitial}|${carNumber}`;
    if (!seenByCustomer.has(customerId)) {
      seenByCustomer.set(customerId, new Set());
    }
    seenByCustomer.get(customerId).add(key);
  }

  for (const [customerId, seenSet] of seenByCustomer.entries()) {
    const activeRailcars = await Railcar.find({
      customerName: customerId,
      isActive: { $ne: false },
    }).select('_id carInitial carNumber');

    const toDeactivateIds = activeRailcars
      .filter((railcar) => !seenSet.has(`${railcar.carInitial}|${railcar.carNumber}`))
      .map((railcar) => railcar._id);

    if (toDeactivateIds.length > 0) {
      const result = await Railcar.updateMany(
        { _id: { $in: toDeactivateIds } },
        { $set: { isActive: false } }
      );
      deactivated += result.modifiedCount || 0;
    }
  }

  return {
    message: 'Railcar import processed',
    received: inputRows.length,
    upserted,
    deactivated,
    rejected: errors.length,
    errors,
  };
};

router.post('/ingest', requireIngestApiKey, async (req, res) => {
  try {
    const inputRows = parseIngestRowsFromRequest(req);
    if (inputRows.length === 0) {
      return res.status(400).json({ message: 'No railcar rows were provided. Send rows[] or csv.' });
    }

    const result = await processRailcarIngest(inputRows);
    return res.status(200).json(result);
  } catch (err) {
    console.error('Error ingesting railcars:', err);
    return res.status(500).json({ message: 'Server error while ingesting railcars' });
  }
});

router.use(requireAuth);

router.post('/ingest/manual', authorizeRoles(['internal', 'admin']), async (req, res) => {
  try {
    const inputRows = parseIngestRowsFromRequest(req);
    if (inputRows.length === 0) {
      return res.status(400).json({ message: 'No railcar rows were provided. Send rows[] or csv.' });
    }

    const result = await processRailcarIngest(inputRows);
    return res.status(200).json(result);
  } catch (err) {
    console.error('Error ingesting railcars (manual):', err);
    return res.status(500).json({ message: 'Server error while ingesting railcars' });
  }
});

router.get('/report', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const query = { isActive: { $ne: false } };
    const onlineOnly = parseBooleanParam(req.query.onlineOnly, true);

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

    let rows = await fetchRailcarsWithComputedWeights(query);
    if (onlineOnly) {
      rows = rows.filter((row) => row.currentStatus !== 'Released');
    }

    const headers = [
      'Railcar ID',
      'Car Initial',
      'Car Number',
      'Customer',
      'Customer Code',
      'Commodity',
      'Current Status',
      'LE Status',
      'Station',
      'Track',
      'Track Position',
      'Rail Shipment BOL',
      'Material',
      'Material Ref',
      'Batch Number',
      'Reported Weight',
      'Unloaded Weight',
      'Remaining Weight',
    ];

    const lines = [
      headers.join(','),
      ...rows.map((row) =>
        [
          row.railcarID || '',
          row.carInitial || '',
          row.carNumber || '',
          row.customerName?.customerName || '',
          row.customerCode || '',
          row.commodity || '',
          row.currentStatus || '',
          row.leStatus || '',
          row.station || '',
          row.track || '',
          row.trackPosition || '',
          row.railcarBolNumber || '',
          row.materialName?.materialName || '',
          row.materialName?.refNum || '',
          row.batchNumber || '',
          row.reportedWeight ?? '',
          row.unloadedWeight ?? '',
          row.remainingWeight ?? '',
        ]
          .map(csvEscape)
          .join(',')
      ),
    ];

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `railcars-online-report-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(lines.join('\r\n'));
  } catch (err) {
    console.error('Error generating railcar report:', err);
    return res.status(500).json({ message: 'Server error while generating railcar report' });
  }
});

router.get('/', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const query = { isActive: { $ne: false } };
    const requestedStatus = req.query.currentStatus || req.query.status;
    if (requestedStatus) {
      query.currentStatus = normalizeStatus(requestedStatus);
    }

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

    const response = await fetchRailcarsWithComputedWeights(query);

    res.status(200).json(response);
  } catch (err) {
    console.error('Error fetching railcars:', err);
    res.status(500).json({ message: 'Server error while fetching railcars' });
  }
});

router.put('/:id/details', authorizeRoles(['internal', 'admin']), async (req, res) => {
  try {
    const railcar = await Railcar.findById(req.params.id);
    if (!railcar) {
      return res.status(404).json({ message: 'Railcar not found' });
    }

    const payload = {};

    if (req.body.batchNumber !== undefined) {
      const batchNumber = String(req.body.batchNumber || '').trim();
      payload.batchNumber = batchNumber;
    }

    if (req.body.railcarBolNumber !== undefined) {
      payload.railcarBolNumber = String(req.body.railcarBolNumber || '').trim();
    }

    if (req.body.materialName !== undefined) {
      const materialId = String(req.body.materialName || '').trim();

      if (!materialId) {
        payload.materialName = null;
      } else {
        if (!isValidObjectId(materialId)) {
          return res.status(400).json({ message: 'Invalid material id' });
        }

        const material = await Material.findById(materialId).select('_id customerName isActive');
        if (!material) {
          return res.status(404).json({ message: 'Material not found' });
        }

        if (material.isActive === false) {
          return res.status(400).json({ message: 'Inactive material cannot be assigned to railcar' });
        }

        if (!material.customerName || String(material.customerName) !== String(railcar.customerName)) {
          return res.status(400).json({ message: 'Material must belong to the same customer as the railcar' });
        }

        payload.materialName = material._id;
      }
    }

    const updated = await Railcar.findByIdAndUpdate(
      railcar._id,
      { $set: payload },
      { new: true }
    )
      .populate('customerName', 'customerName')
      .populate('materialName', 'materialName refNum');

    return res.status(200).json({ message: 'Railcar details updated successfully', railcar: updated });
  } catch (err) {
    console.error('Error updating railcar details:', err);
    return res.status(500).json({ message: 'Server error while updating railcar details' });
  }
});

router.put('/:id/release-empty', authorizeRoles(['customer', 'internal', 'admin']), async (req, res) => {
  try {
    const railcar = await Railcar.findById(req.params.id);
    if (!railcar) {
      return res.status(404).json({ message: 'Railcar not found' });
    }

    if (isCustomerUser(req)) {
      const tokenCustomerId = customerIdFromToken(req);
      if (!tokenCustomerId || String(railcar.customerName) !== String(tokenCustomerId)) {
        return res.status(403).json({ message: 'Access forbidden: railcar is outside customer scope' });
      }
    }

    if (railcar.currentStatus !== 'Available') {
      return res.status(400).json({ message: 'Only Available railcars can be released as empty' });
    }

    railcar.currentStatus = 'Released';
    railcar.status = 'Released';
    railcar.leStatus = railcar.leStatus || 'Released Empty';
    railcar.releasedAsEmptyAt = new Date();
    railcar.releasedAsEmptyBy = req.user?.id || railcar.releasedAsEmptyBy;

    const saved = await railcar.save();

    try {
      const [actor, customer] = await Promise.all([
        User.findById(req.user?.id).select('firstName lastName email'),
        Customer.findById(saved.customerName).select('customerName'),
      ]);
      await sendReleaseEmptyNotification({ railcar: saved, actor, customer });
    } catch (emailErr) {
      console.error('Railcar release email notification failed:', emailErr);
    }

    res.status(200).json({ message: 'Railcar released as empty', railcar: saved });
  } catch (err) {
    console.error('Error releasing railcar as empty:', err);
    res.status(500).json({ message: 'Server error while releasing railcar' });
  }
});

module.exports = router;

