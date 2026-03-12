const TrainingCertificate = require('../models/TrainingCertificate');
const QRCode = require('qrcode');
const { ApiError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// Helper function: Get default expiry date (1 year from now)
function getDefaultExpiry() {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    return date;
}

// Helper function: Validate training certificate input
function validateTrainingCertificateInput(data) {
    const { certificateNumber, trainee, training, issueDate, expiryDate } = data;

    // Validate certificate number
    if (!certificateNumber || !certificateNumber.trim()) {
        throw new ApiError(400, 'Certificate number is required');
    }

    // Validate trainee
    if (!trainee || !trainee.name || !trainee.name.trim()) {
        throw new ApiError(400, 'Trainee name is required');
    }
    if (!trainee.organization || !trainee.organization.trim()) {
        throw new ApiError(400, 'Trainee organization is required');
    }
    if (!trainee.address || !trainee.address.trim()) {
        throw new ApiError(400, 'Trainee address is required');
    }

    // Validate training
    if (!training || !training.courseName || !training.courseName.trim()) {
        throw new ApiError(400, 'Training course name is required');
    }
    if (!training.date) {
        throw new ApiError(400, 'Training date is required');
    }
    if (!training.hours || training.hours <= 0) {
        throw new ApiError(400, 'Training hours must be greater than 0');
    }

    // Validate dates
    if (!issueDate) {
        throw new ApiError(400, 'Issue date is required');
    }

    const issueDateObj = new Date(issueDate);
    const expiryDateObj = expiryDate ? new Date(expiryDate) : getDefaultExpiry();

    if (isNaN(issueDateObj.getTime())) {
        throw new ApiError(400, 'Invalid issue date format');
    }
    if (isNaN(expiryDateObj.getTime())) {
        throw new ApiError(400, 'Invalid expiry date format');
    }

    if (expiryDateObj <= issueDateObj) {
        throw new ApiError(400, 'Expiry date must be after issue date');
    }
}

// @desc    Create training certificate
// @route   POST /api/v1/training-certificates
// @access  Private/Admin
exports.createTrainingCertificate = async (req, res, next) => {
    try {
        const {
            certificateNumber,
            trainee,
            training,
            issueDate,
            expiryDate,
            notes,
        } = req.body;

        let certNumber = certificateNumber;

        if (!certNumber || certNumber.trim() === '') {
            // Auto-generate if not provided
            const lastCert = await TrainingCertificate
                .findOne()
                .sort({ createdAt: -1 });

            let num = 1;
            if (lastCert && lastCert.certificateNumber && lastCert.certificateNumber.includes('-')) {
                const lastNum = parseInt(lastCert.certificateNumber.split('-')[1]);
                if (!isNaN(lastNum)) {
                    num = lastNum + 1;
                }
            }

            certNumber = `TRAIN-${num.toString().padStart(3, '0')}`;
        }

        // Validate input (includes generated certificate number)
        validateTrainingCertificateInput({ certificateNumber: certNumber, trainee, training, issueDate, expiryDate });

        // Check if certificate number already exists
        const existingCert = await TrainingCertificate.findOne({ certificateNumber: certNumber });
        if (existingCert) {
            throw new ApiError(400, `Certificate number "${certNumber}" already exists`);
        }

        // Generate QR code pointing to certificate verification URL
        const qrCodeUrl = `${process.env.FRONTEND_URL}/verify/training/${certNumber}`;
        const qrCodeImage = await QRCode.toDataURL(qrCodeUrl);

        // Create certificate in database
        const certificate = await TrainingCertificate.create({
            certificateNumber: certNumber,
            trainee: {
                name: trainee.name,
                organization: trainee.organization,
                address: trainee.address,
                email: trainee.email || '',
            },
            training: {
                courseName: training.courseName,
                category: training.category || 'Other',
                date: new Date(training.date),
                hours: parseInt(training.hours) || 0,
                trainer: training.trainer || '',
            },
            issueDate: new Date(issueDate || Date.now()),
            expiryDate: new Date(expiryDate || getDefaultExpiry()),
            qrCode: qrCodeUrl,
            status: 'active',
            createdBy: req.user ? req.user._id : undefined,
            notes,
        });

        res.status(201).json({
            success: true,
            data: certificate,
            qrCodeImage, // QR PNG as base64 for direct display
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get all training certificates
// @route   GET /api/v1/training-certificates
// @access  Private/Admin
exports.getAllTrainingCertificates = async (req, res, next) => {
    try {
        const {
            page = 1,
            limit = 10,
            search,
            status,
            category,
        } = req.query;

        const query = {};
        const now = new Date();

        if (search) {
            query.$or = [
                { 'trainee.name': { $regex: search, $options: 'i' } },
                { certificateNumber: { $regex: search, $options: 'i' } },
            ];
        }

        // Handle status filter with expiry auto-detection
        if (status) {
            const statusLower = String(status).toLowerCase();
            if (statusLower === 'expired') {
                query.expiryDate = { $lt: now };
            } else if (statusLower === 'active') {
                query.status = { $ne: 'revoked' };
                query.expiryDate = { $gte: now };
            } else {
                query.status = status;
            }
        }

        if (category) query['training.category'] = category;

        const skip = (page - 1) * limit;
        const total = await TrainingCertificate.countDocuments(query);

        const certificates = await TrainingCertificate
            .find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        // Auto-detect expired status
        const enrichedCerts = certificates.map(cert => {
            const certObj = cert.toObject();
            certObj.isExpired = cert.expiryDate < now;
            certObj.displayStatus = certObj.isExpired ? 'expired' : cert.status;
            return certObj;
        });

        res.json({
            success: true,
            count: enrichedCerts.length,
            total,
            page: parseInt(page),
            pages: Math.ceil(total / limit),
            data: enrichedCerts,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get single certificate
// @route   GET /api/v1/training-certificates/:id
// @access  Private/Admin
exports.getTrainingCertificateById = async (req, res, next) => {
    try {
        const certificate = await TrainingCertificate.findById(req.params.id);

        if (!certificate) {
            const error = new Error('Certificate not found');
            error.statusCode = 404;
            return next(error);
        }

        res.json({
            success: true,
            data: certificate,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Update certificate
// @route   PUT /api/v1/training-certificates/:id
// @access  Private/Admin
exports.updateTrainingCertificate = async (req, res, next) => {
    try {
        let certificate = await TrainingCertificate.findById(req.params.id);

        if (!certificate) {
            const error = new Error('Certificate not found');
            error.statusCode = 404;
            return next(error);
        }

        certificate = await TrainingCertificate.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );

        res.json({
            success: true,
            data: certificate,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Delete certificate
// @route   DELETE /api/v1/training-certificates/:id
// @access  Private/Admin
exports.deleteTrainingCertificate = async (req, res, next) => {
    try {
        const certificate = await TrainingCertificate.findById(req.params.id);

        if (!certificate) {
            const error = new Error('Certificate not found');
            error.statusCode = 404;
            return next(error);
        }

        await TrainingCertificate.deleteOne({ _id: req.params.id });

        res.json({
            success: true,
            message: 'Certificate deleted',
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Verify certificate by certificate number or QR code
// @route   GET /api/v1/training-certificates/verify/:identifier
// @access  Public
exports.verifyTrainingCertificate = async (req, res, next) => {
    try {
        const identifier = req.params.qrCode;

        // Try to find by certificateNumber first, then by qrCode
        let certificate = await TrainingCertificate.findOne({
            $or: [
                { certificateNumber: identifier },
                { qrCode: identifier },
            ],
        });

        if (!certificate) {
            return res.json({
                success: false,
                verified: false,
                message: 'Certificate not found',
            });
        }

        const isExpired = new Date() > certificate.expiryDate;

        res.json({
            success: true,
            verified: true,
            data: {
                certificateNumber: certificate.certificateNumber,
                traineeName: certificate.trainee.name,
                organization: certificate.trainee.organization,
                courseName: certificate.training.courseName,
                trainingDate: certificate.training.date,
                hours: certificate.training.hours,
                issueDate: certificate.issueDate,
                expiryDate: certificate.expiryDate,
                status: certificate.status,
                isExpired,
            },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get training certificate statistics for dashboard
// @route   GET /api/v1/training-certificates/stats
// @access  Private/Admin
exports.getTrainingCertificateStats = async (req, res, next) => {
    try {
        const now = new Date();

        const total = await TrainingCertificate.countDocuments();

        const active = await TrainingCertificate.countDocuments({
            status: { $ne: 'revoked' },
            expiryDate: { $gte: now }
        });

        const expired = await TrainingCertificate.countDocuments({
            expiryDate: { $lt: now }
        });

        const revoked = await TrainingCertificate.countDocuments({
            status: 'revoked'
        });

        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const thisMonth = await TrainingCertificate.countDocuments({
            createdAt: { $gte: startOfMonth }
        });

        const in30Days = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
        const expiringSoon = await TrainingCertificate.countDocuments({
            expiryDate: { $gte: now, $lte: in30Days },
            status: { $ne: 'revoked' }
        });

        res.json({
            success: true,
            stats: {
                total,
                active,
                expired,
                revoked,
                thisMonth,
                expiringSoon
            }
        });
    } catch (error) {
        logger.error('Error fetching training certificate stats:', error);
        next(error);
    }
};
