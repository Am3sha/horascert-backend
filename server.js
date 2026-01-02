require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');
const logger = require('./utils/logger');
const correlationIdMiddleware = require('./middleware/correlationId');

// Import routers
const authRouter = require('./routes/auth');
const applicationsRouter = require('./routes/applications');
const adminRouter = require('./routes/admin');
const certificatesRouter = require('./routes/certificates');
const emailsRouter = require('./routes/emails');

// Import centralized error handler
const { errorHandler, notFound } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5001;

// Connect to MongoDB before starting routes
connectDB();

// Middleware - CORS, JSON parsers
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
}));

// Increase request size limits to handle large payloads (Base64 encoded files, etc.)
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// Cookie parser middleware (MUST come before auth middleware)
app.use(cookieParser());

// Request correlation ID middleware (for debugging)
app.use(correlationIdMiddleware);

// Health check endpoints
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is running' });
});

app.get('/healthz', (req, res) => {
    res.send('OK');
});

// Root route
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'HorasCert Backend API Server is running!',
        version: '1.0.0',
        endpoints: {
            health: '/api/health',
            auth: '/api/v1/auth',
            admin: '/api/v1/admin',
            applications: '/api/v1/applications',
            certificates: '/api/v1/certificates'
        }
    });
});

// API Routes - v1 prefix
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/applications', applicationsRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/certificates', certificatesRouter);
app.use('/api/v1/emails', emailsRouter);

// Legacy support: /api/applications without v1 prefix
app.use('/api/applications', applicationsRouter);

// Handle large payload errors (and Multer upload errors) before 404 + centralized handler
app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
        return res.status(413).json({
            success: false,
            message: 'File too large. Please upload smaller files.'
        });
    }

    if (err && err.name === 'MulterError') {
        const message = err.code === 'LIMIT_FILE_SIZE'
            ? 'File too large. Please upload smaller files.'
            : 'File upload failed. Please check file type and try again.';

        return res.status(400).json({
            success: false,
            message
        });
    }

    if (err) {
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            details: err.message
        });
    }

    return next(err);
});

// 404 handler (must come before error handler)
app.use(notFound);

// Centralized error handling middleware (MUST be last)
app.use(errorHandler);

// Start server
app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server is running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});


