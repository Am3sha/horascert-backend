const Request = require('../models/Request');
const logger = require('../utils/logger');
const { sendApplicationStatusUpdateToClient } = require('../config/email');

const ALLOWED_STATUSES = ['new', 'in-progress', 'approved', 'completed', 'rejected'];

const updateApplicationAdmin = async (req, res) => {
    try {
        const app = await Request.findById(req.params.id);
        if (!app) return res.status(404).json({ success: false, error: 'Application not found' });

        const oldStatus = app.status;

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status')) {
            const nextStatus = String(req.body.status || '').trim();
            if (!ALLOWED_STATUSES.includes(nextStatus)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid status'
                });
            }
            app.status = nextStatus;
        }
        if (req.body.adminNotes) app.adminNotes = req.body.adminNotes;

        await app.save();
        res.json({ success: true, data: app });

        const newStatus = app.status;
        if (oldStatus !== newStatus && app.email) {
            setImmediate(async () => {
                try {
                    const result = await sendApplicationStatusUpdateToClient({
                        to: app.email,
                        requestId: app._id.toString(),
                        oldStatus,
                        newStatus
                    });

                    if (result && result.success) {
                        logger.info('Application status update email sent to client', {
                            requestId: app._id,
                            to: app.email
                        });
                    } else {
                        logger.warn('Failed to send application status update email to client', {
                            requestId: app._id,
                            to: app.email,
                            error: result && result.error
                        });
                    }
                } catch (err) {
                    logger.error('Failed to send application status update email to client:', err);
                }
            });
        }
    } catch (err) {
        logger.error(err);
        res.status(500).json({ success: false, error: 'Failed to update application' });
    }
};

module.exports = {
    updateApplicationAdmin
};
