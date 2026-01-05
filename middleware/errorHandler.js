const logger = require('../utils/logger');

// Custom error class for API errors
class ApiError extends Error {
    constructor(statusCode, message, isOperational = true, stack = '') {
        super(message);
        this.name = 'ApiError';
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        if (stack) {
            this.stack = stack;
        } else {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

// Error handling middleware
const errorHandler = (err, req, res, next) => {
    let { statusCode, message } = err;

    // For ApiError instances, always use the statusCode (even if it's 401/403)
    if (err instanceof ApiError) {
        statusCode = err.statusCode;
    } else {
        statusCode = statusCode || 500;
    }

    // Handle oversized payload (413 Payload Too Large)
    if (err.type === 'entity.too.large' || err.status === 413) {
        statusCode = 413;
        message = 'Request payload too large. Maximum file size is 20MB. Please reduce the file size and try again.';
        const errorResponse = {
            success: false,
            error: 'PayloadTooLarge',
            message
        };
        logger.warn(`413 - Payload too large - ${req.originalUrl} - ${req.method} - ${req.ip}`);
        return res.status(statusCode).json(errorResponse);
    }

    // Log the error for debugging
    logger.error(`${err.statusCode || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`, {
        stack: process.env.NODE_ENV === 'development' ? err.stack : {}
    });

    // Handle specific error types
    if (err.name === 'ValidationError') {
        statusCode = 400;
        message = err.message || 'One or more fields are invalid';
    }

    // Handle JWT errors
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
        statusCode = 401;
        message = 'Invalid or expired token';
    }

    // Handle MongoDB duplicate key error
    if (err.code === 11000) {
        statusCode = 400;
        const field = Object.keys(err.keyValue)[0];
        message = `${field} already exists`;
    }

    // Handle CastError for invalid MongoDB ObjectId
    if (err.name === 'CastError') {
        statusCode = 400;
        message = 'Invalid ID format';
    }

    const errorResponse = {
        success: false,
        error: err.name || 'ServerError',
        message: message || err.message || 'An error occurred'
    };

    if (err.errors) {
        if (err.name === 'ValidationError') {
            const errors = {};
            Object.keys(err.errors).forEach((key) => {
                errors[key] = err.errors[key].message;
            });
            errorResponse.errors = errors;
        } else {
            errorResponse.errors = err.errors;
        }
    }

    if (process.env.NODE_ENV === 'development') {
        // DEVELOPMENT: Include full stack trace for debugging
        errorResponse.stack = err.stack;
    } else {
        // ========================================================================
        // PRODUCTION: Hide all sensitive debugging information
        // Never expose stack traces, internal error types, or file paths
        // ========================================================================

        // For 5xx errors: use generic message (never reveal internal structure)
        if (statusCode >= 500) {
            errorResponse.error = 'ServerError';
            errorResponse.message = 'An internal server error occurred';
            // Never include stack trace in production
            delete errorResponse.stack;
        }

        // For 4xx errors: only expose ApiError messages (which are safe)
        if (statusCode >= 400 && statusCode < 500) {
            // ApiError messages are intentionally safe (like "Invalid token", "Not Found")
            // but generic Error details should be hidden from client
            if (!(err instanceof ApiError)) {
                errorResponse.message = 'Invalid request';
                errorResponse.error = 'BadRequest';
            }
        }
    }

    res.status(statusCode).json(errorResponse);
};

// 404 Not Found middleware
const notFound = (req, res, next) => {
    // Use ApiError instead of generic Error for proper status code handling
    // SECURITY: Don't expose req.originalUrl in error message (might contain sensitive data)
    const error = new ApiError(404, 'Resource not found');
    next(error);
};

// Async handler to wrap async/await routes for error handling
const asyncHandler = (fn) => (req, res, next) => {
    return Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
    ApiError,
    errorHandler,
    notFound,
    asyncHandler
};
