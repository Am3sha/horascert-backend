const express = require('express');
const { body, validationResult } = require('express-validator');
const Email = require('../models/Email');
const { sendContactEmail } = require('../config/email');
const { contactEmailLimiter } = require('../middleware/rateLimiters');
const logger = require('../utils/logger');

const router = express.Router();

const contactValidation = [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('phone').optional().trim().isLength({ min: 8, max: 20 }),
    body('subject').trim().isLength({ min: 3, max: 200 }).withMessage('Subject must be between 3 and 200 characters'),
    body('message').trim().isLength({ min: 10, max: 2000 }).withMessage('Message must be between 10 and 2000 characters'),
];

router.post('/', contactEmailLimiter, contactValidation, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: 'ValidationError',
                errors: errors.array()
            });
        }

        const { name, email, phone, subject, message, type } = req.body;

        const created = await Email.create({
            senderName: name,
            senderEmail: email,
            senderPhone: phone,
            subject,
            message,
            type: type || 'contact',
            status: 'new'
        });

        let emailSent = false;
        try {
            const emailResult = await sendContactEmail({ name, email, phone, subject, message });
            emailSent = Boolean(emailResult && emailResult.success);
        } catch (err) {
            logger.error('Failed to send contact notification email:', err);
            emailSent = false;
        }

        return res.status(201).json({
            success: true,
            emailSent,
            data: created
        });
    } catch (error) {
        logger.error('Error submitting contact email:', error);
        return res.status(500).json({
            success: false,
            error: 'ServerError',
            message: error.message || 'Failed to submit message'
        });
    }
});

module.exports = router;
