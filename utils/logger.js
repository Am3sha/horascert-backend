const winston = require('winston');
const { combine, timestamp, printf, colorize, json } = winston.format;
const path = require('path');
const fs = require('fs').promises;

// Create logs directory if it doesn't exist (async, non-blocking)
const logDir = path.join(__dirname, '../../logs');
(async () => {
    try {
        await fs.mkdir(logDir, { recursive: true });
    } catch (err) {
        // Directory already exists or other error - winston will handle file creation
    }
})();

// Define log format
const logFormat = printf(({ level, message, timestamp, ...meta }) => {
    return `${timestamp} [${level.toUpperCase()}] ${message} ${Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
        }`;
});

// Create logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        process.env.NODE_ENV === 'production' ? json() : combine(colorize(), logFormat)
    ),
    transports: [
        // Write all logs with level `error` and below to `error.log`
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error'
        }),
        // Write all logs to `combined.log`
        new winston.transports.File({
            filename: path.join(logDir, 'combined.log')
        })
    ],
    // Handle uncaught exceptions
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join(logDir, 'exceptions.log')
        })
    ]
});

// If we're not in production, also log to the console
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: combine(
            colorize(),
            printf(({ level, message, timestamp, ...meta }) => {
                return `${timestamp} [${level}] ${message} ${Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
                    }`;
            })
        ),
        handleExceptions: true
    }));
}

// Create a stream for morgan
logger.stream = {
    write: (message) => {
        logger.info(message.trim());
    },
};

module.exports = logger;
