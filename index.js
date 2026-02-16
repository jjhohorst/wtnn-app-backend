// JavaScript Document

require('dotenv').config();

const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 5000;

const mongoose = require('mongoose');

// Connect to MongoDB (using your env variable for DB_URI)
mongoose.connect(process.env.DB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Middleware
app.use(express.json({ limit: '25mb' }));
app.use(cors());
app.use(bodyParser.json({ limit: '25mb' }));

// Import routers
const ordersRouter = require('./routes/orders');
const materialsRouter = require('./routes/materials');
const customersRouter = require('./routes/customers');
const customerRouter = require('./routes/customers');
const projectsRouter = require('./routes/projects');
const receiversRouter = require('./routes/receivers');
const shippersRouter = require('./routes/shippers'); 
const railcarsRouter = require('./routes/railcars');
const bolsRouter = require('./routes/bols');
const usersRouter = require('./routes/users');
const authRouter = require('./routes/auth');
const authorizeRouter = require('./routes/authorize');

app.use('/api/orders', ordersRouter);
app.use('/api/materials', materialsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/customer', customerRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/receivers', receiversRouter);
app.use('/api/shippers', shippersRouter);
app.use('/api/railcars', railcarsRouter);
app.use('/api/bols', bolsRouter);
app.use('/api/users', usersRouter);
app.use('/api/auth', authRouter);
app.use('/api/authorize', authorizeRouter);

// Basic route for testing
app.get('/', (req, res) => {
    res.send('Welcome to the WTNN Shipment Portal.');
});


const errorHandler = require('./errorHandler');
// other app.use() statements...
app.use(errorHandler);

const shouldUseLocalHttps = process.env.USE_LOCAL_HTTPS === 'true';
const sslKeyPath = process.env.SSL_KEY_PATH || 'C:/mycerts/key.pem';
const sslCertPath = process.env.SSL_CERT_PATH || 'C:/mycerts/cert.pem';

if (shouldUseLocalHttps) {
  const certFilesExist = fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath);

  if (certFilesExist) {
    const sslOptions = {
      key: fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath),
    };

    https.createServer(sslOptions, app).listen(PORT, () => {
      console.log(`HTTPS server is running on port ${PORT}`);
    });
  } else {
    console.warn(`USE_LOCAL_HTTPS=true but cert files were not found at ${sslKeyPath} and ${sslCertPath}. Falling back to HTTP.`);
    http.createServer(app).listen(PORT, () => {
      console.log(`HTTP server is running on port ${PORT}`);
    });
  }
} else {
  http.createServer(app).listen(PORT, () => {
    console.log(`HTTP server is running on port ${PORT}`);
  });
}
