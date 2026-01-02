const { v4: uuidv4 } = require('uuid');

/**
 * Middleware to add request correlation ID for easier debugging
 * Adds unique ID to each request and logs it with all messages
 */
const correlationIdMiddleware = (req, res, next) => {
    // Add correlation ID to request object
    req.id = uuidv4();

    // Add to response headers for client reference
    res.setHeader('X-Request-ID', req.id);

    // Add to logs context (if using a logging system with context)
    req.correlationId = req.id;

    next();
};

module.exports = correlationIdMiddleware;
