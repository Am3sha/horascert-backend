# HORAS-Cert Backend Server

Simple Express server with Nodemailer for form submissions.

## Features

- ✅ Email-only form submissions (no database)
- ✅ Application form handling
- ✅ Contact form handling
- ✅ Input validation
- ✅ HTML email notifications

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the `server/` directory:

```env
# Email Configuration
MAIL_USER=your-email@gmail.com
MAIL_PASS=your-app-password
EMAIL_TO=info@horas-cert.com

# Server
PORT=5000
CORS_ORIGIN=http://localhost:3000
```

**For Gmail:**
- Enable 2-factor authentication
- Generate an "App Password" (not your regular password)
- Use the app password in `MAIL_PASS`

### 3. Start Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

## API Endpoints

### Public Endpoints

- `POST /api/applications` - Submit certification application
  - Validates input
  - Sends email to `info@horas-cert.com`
  - Returns success/error response

- `POST /api/applications/contact` - Submit contact form
  - Validates input
  - Sends email to `info@horas-cert.com`
  - Returns success/error response

- `GET /api/health` - Health check endpoint

## Email Configuration

The server uses Nodemailer to send emails. Configure your SMTP settings in `.env`:

```env
MAIL_USER=your-email@gmail.com
MAIL_PASS=your-app-password
EMAIL_TO=info@horas-cert.com
```

### Gmail Setup

1. Go to Google Account → Security
2. Enable 2-Step Verification
3. Generate App Password
4. Use the generated password in `MAIL_PASS`

### Other SMTP Providers

You can also configure other SMTP providers by adding:

```env
MAIL_HOST=smtp.your-provider.com
MAIL_PORT=587
MAIL_SECURE=false
```

## Form Submission Flow

1. User submits form (Application or Contact)
2. Frontend validates inputs
3. Frontend sends POST request to API
4. Backend validates inputs again
5. Backend sends email via Nodemailer
6. Backend returns success/error response
7. Frontend displays success/error message

## Project Structure

```
server/
├── server.js              # Express server
├── config/
│   └── email.js          # Nodemailer configuration
├── routes/
│   └── applications.js   # Form submission routes
└── package.json
```

## Dependencies

- `express` - Web framework
- `nodemailer` - Email sending
- `express-validator` - Input validation
- `cors` - CORS middleware
- `dotenv` - Environment variables

## Troubleshooting

### Email Not Sending

- Verify `MAIL_USER` and `MAIL_PASS` are correct
- For Gmail, use App Password (not regular password)
- Check firewall/network settings
- Verify SMTP port is open

### CORS Errors

- Update `CORS_ORIGIN` in `.env`
- Ensure frontend URL matches

### Server Not Starting

- Check if port 5000 is available
- Verify all environment variables are set
- Check for syntax errors in code

## Production Deployment

1. Set `NODE_ENV=production`
2. Use secure email credentials
3. Configure proper CORS origins
4. Set up SSL/TLS for email
5. Use environment variables for all sensitive data
6. Set up process manager (PM2, etc.)

