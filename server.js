require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
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

const csrfCheck = require('./middleware/csrfCheck');

// Import centralized error handler
const { ApiError, errorHandler, notFound } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5001;

// Connect to MongoDB before starting routes
connectDB();

// CRITICAL: Enable proxy trust for Railway infrastructure
// Must come BEFORE any middleware that reads X-Forwarded-For, X-Forwarded-Proto, etc.
app.set('trust proxy', 1);

// Remove identifying header
app.disable('x-powered-by');

// Security headers (kept conservative to avoid breaking React/Vercel/Supabase flows)
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    strictTransportSecurity: process.env.NODE_ENV === 'production'
        ? { maxAge: 15552000, includeSubDomains: true }
        : false
}));

// Response compression
app.use(compression());

// Basic NoSQL injection hardening
app.use(mongoSanitize());

// Middleware - CORS, JSON parsers
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests from custom domain, Vercel frontend, Railway backend, and localhost
        const allowedOrigins = [
            'https://horascert.com',
            'https://www.horascert.com',
            'https://horascert-frontend.vercel.app',
            'http://localhost:3000',
            'http://127.0.0.1:3000',
        ];

        // Check if origin is in allowed list
        if (!origin) {
            // Allow requests with no origin (Postman, server-to-server, etc.)
            return callback(null, true);
        }

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(new ApiError(403, 'Not allowed by CORS'));
    },
    credentials: true, // Allow credentials (cookies, auth headers)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400 // 24 hours
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
app.use('/api/v1/applications', csrfCheck, applicationsRouter);
app.use('/api/v1/admin', csrfCheck, adminRouter);
app.use('/api/v1/certificates', csrfCheck, certificatesRouter);
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
            : err.code === 'LIMIT_UNEXPECTED_FILE'
                ? 'Too many files. You can upload up to 3 files.'
                : 'File upload failed. Please check file type and try again.';

        return res.status(400).json({
            success: false,
            message
        });
    }

    // Allow the centralized error handler to return the correct status for known 4xx errors
    if (err && (err instanceof ApiError || (err.statusCode && err.statusCode < 500) || (err.status && err.status < 500))) {
        return next(err);
    }

    if (err) {
        const response = {
            success: false,
            message: 'Internal server error',
            details: null
        };

        if (process.env.NODE_ENV === 'development') {
            response.details = err.message;
        }

        return res.status(500).json({
            ...response
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


