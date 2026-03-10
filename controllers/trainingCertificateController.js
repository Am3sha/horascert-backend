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
        } = req.body;

        // Validate input (includes certificate number validation)
        validateTrainingCertificateInput({ certificateNumber, trainee, training, issueDate, expiryDate });

        // Check if certificate number already exists
        const existingCert = await TrainingCertificate.findOne({ certificateNumber });
        if (existingCert) {
            throw new ApiError(400, `Certificate number "${certificateNumber}" already exists`);
        }

        // Generate QR code pointing to certificate verification URL
        const qrCodeUrl = `${process.env.FRONTEND_URL}/verify/training/${certificateNumber}`;
        const qrCodeImage = await QRCode.toDataURL(qrCodeUrl);

        // Create certificate in database
        const certificate = await TrainingCertificate.create({
            certificateNumber,
            trainee: {
                name: trainee.name,
                organization: trainee.organization,
                address: trainee.address,
            },
            training: {
                courseName: training.courseName,
                category: training.category || 'Other',
                date: new Date(training.date),
                hours: parseInt(training.hours) || 0,
                trainer: training.trainer || '',
            },
            issueDate: new Date(issueDate),
            expiryDate: new Date(expiryDate),
            qrCode: qrCodeUrl,
            status: 'active',
            createdBy: req.user ? req.user._id : undefined,
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

        if (search) {
            query.$or = [
                { 'trainee.name': { $regex: search, $options: 'i' } },
                { certificateNumber: { $regex: search, $options: 'i' } },
            ];
        }

        if (status) query.status = status;
        if (category) query['training.category'] = category;

        const skip = (page - 1) * limit;
        const total = await TrainingCertificate.countDocuments(query);

        const certificates = await TrainingCertificate
            .find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        res.json({
            success: true,
            count: certificates.length,
            total,
            page: parseInt(page),
            pages: Math.ceil(total / limit),
            data: certificates,
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


