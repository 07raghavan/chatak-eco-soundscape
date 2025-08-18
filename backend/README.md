# Chatak Backend API

Backend server for Chatak Eco Soundscape platform with authentication, user management, and database integration.

## Features

- ✅ **Normal Authentication**: Email/password registration and login
- ✅ **Google OAuth**: Google Sign-In integration
- ✅ **JWT Tokens**: Secure authentication tokens
- ✅ **PostgreSQL Database**: AWS RDS integration with Sequelize ORM
- ✅ **Security**: Rate limiting, CORS, Helmet, input validation
- ✅ **Error Handling**: Comprehensive error handling and logging

## Quick Start

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Environment Setup
Copy the example environment file and configure it:
```bash
cp env.example .env
```

Edit `.env` with your configuration:
```env
# Database (AWS RDS)
DB_HOST=your-rds-endpoint.amazonaws.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=chatak_admin
DB_PASSWORD=your-database-password

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# JWT
JWT_SECRET=your-super-secret-jwt-key
```

### 3. Start Development Server
```bash
npm run dev
```

The server will start on `http://localhost:3001`

## Segmentation & AED Setup

1) Install ffmpeg/ffprobe on the host and ensure they are on PATH.

2) Apply SQL in DBeaver (preferred):
   - `backend/database/alter_recordings_add_audio_fields.sql`
   - `backend/database/segments_table.sql`
   - `backend/database/jobs_tables.sql`
   - Ensure `CREATE EXTENSION IF NOT EXISTS pgcrypto;` exists.

3) Environment variables:
```
ENABLE_SEGMENTATION_WORKER=true
SEGMENTATION_POLL_MS=5000
AWS_S3_BUCKET_NAME=your-bucket
```

4) Endpoints:
- GET `/api/segmentation/presets`
- POST `/api/recordings/:recordingId/segmentation/jobs`
- GET `/api/recordings/:recordingId/segments`

## API Endpoints

### Authentication

#### POST `/api/auth/register`
Register a new user with email/password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "John Doe",
  "organization": "Research Institute"
}
```

**Response:**
```json
{
  "message": "User registered successfully",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "organization": "Research Institute"
  },
  "token": "jwt-token-here"
}
```

#### POST `/api/auth/login`
Login with email/password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "organization": "Research Institute"
  },
  "token": "jwt-token-here"
}
```

#### POST `/api/auth/google`
Login/register with Google OAuth.

**Request Body:**
```json
{
  "credential": "google-id-token-from-frontend"
}
```

**Response:**
```json
{
  "message": "Google authentication successful",
  "user": {
    "id": 1,
    "email": "user@gmail.com",
    "name": "John Doe",
    "organization": null
  },
  "token": "jwt-token-here"
}
```

#### GET `/api/auth/profile`
Get current user profile (requires authentication).

**Headers:**
```
Authorization: Bearer jwt-token-here
```

**Response:**
```json
{
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "organization": "Research Institute",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

### Health Check

#### GET `/health`
Check server status.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "environment": "development"
}
```

## Database Schema

The backend automatically creates the `users` table with the following structure:

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    password_hash VARCHAR(255),
    google_id VARCHAR(255),
    organization VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | Server port | No | 3001 |
| `NODE_ENV` | Environment | No | development |
| `DB_HOST` | Database host | Yes | - |
| `DB_PORT` | Database port | No | 5432 |
| `DB_NAME` | Database name | Yes | - |
| `DB_USER` | Database username | Yes | - |
| `DB_PASSWORD` | Database password | Yes | - |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Yes | - |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Yes | - |
| `JWT_SECRET` | JWT signing secret | Yes | - |
| `JWT_EXPIRES_IN` | JWT expiration | No | 7d |
| `CORS_ORIGIN` | CORS allowed origin | No | http://localhost:5173 |

## Security Features

- **Rate Limiting**: 100 requests per 15 minutes per IP
- **CORS Protection**: Configurable allowed origins
- **Helmet**: Security headers
- **Input Validation**: Request body validation
- **Password Hashing**: bcrypt with salt rounds
- **JWT Tokens**: Secure authentication
- **SSL**: Required for AWS RDS connections

## Development

### Scripts

```bash
npm run dev      # Start development server with nodemon
npm start        # Start production server
npm test         # Run tests
```

### Logs

The server provides detailed logging:
- Database connection status
- Configuration validation
- API request/response logging
- Error details

## Production Deployment

1. Set `NODE_ENV=production`
2. Configure all environment variables
3. Use a process manager like PM2
4. Set up proper SSL certificates
5. Configure AWS RDS security groups

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Check AWS RDS endpoint and credentials
   - Verify security group allows your IP
   - Ensure SSL is properly configured

2. **Google OAuth Fails**
   - Verify Google Client ID and Secret
   - Check authorized redirect URIs in Google Console
   - Ensure frontend sends correct credential format

3. **JWT Token Issues**
   - Verify JWT_SECRET is set
   - Check token expiration settings
   - Ensure proper Authorization header format

## Support

For issues or questions, check the logs and ensure all environment variables are properly configured. 