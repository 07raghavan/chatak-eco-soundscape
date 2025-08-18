# Chatak Eco Soundscape

## Project Overview
Chatak Eco Soundscape is an advanced ecoacoustic platform for biodiversity monitoring and soundscape analysis. It empowers researchers and conservationists to transform environmental audio recordings into actionable insights using AI-powered tools and intuitive visualizations.

## Architecture

### Frontend (React + Vite)
- **Location**: Root directory
- **Tech Stack**: React, TypeScript, Vite, Tailwind CSS, shadcn-ui
- **Deployment**: Netlify
- **Live URL**: https://chatak-acoustic.netlify.app

### Backend (Node.js + Express)
- **Location**: `./backend/` directory
- **Tech Stack**: Node.js, Express, PostgreSQL, AWS S3, Python (for audio processing)
- **Features**: 
  - Audio file upload and processing
  - AI-powered audio event detection
  - Spectrogram generation
  - User authentication (Google OAuth)
  - RESTful API
- **Deployment**: Railway (recommended) or AWS Elastic Beanstalk

## Features
- 🎵 Audio ingestion and visualization
- 🤖 AI-powered audio event detection (AED)
- 📊 Spectrogram generation and analysis
- 🗺️ Interactive map interface
- 👤 User authentication and project management
- 📁 Project and site organization
- ☁️ Cloud storage integration (AWS S3)
- 🐍 Python integration for advanced audio processing

## Quick Start

### Prerequisites
- Node.js 18+ & npm
- Python 3.8+ (for audio processing)
- PostgreSQL database
- AWS S3 bucket (for file storage)

### Frontend Development
```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Backend Development
```bash
# Navigate to backend
cd backend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your database and AWS credentials

# Start development server
npm run dev
```

## Deployment

### Frontend (Netlify)
✅ **DEPLOYED**: https://chatak-acoustic.netlify.app

```bash
# Build for production
npm run build

# Deploy to Netlify
netlify deploy --prod --dir=dist
```

### Backend (Railway - Recommended)

1. **Create Railway Project**:
   ```bash
   cd backend
   railway login
   railway init
   ```

2. **Set Environment Variables**:
   ```bash
   railway variables --set "NODE_ENV=production"
   railway variables --set "DB_HOST=your-db-host"
   railway variables --set "DB_USER=your-db-user"
   # ... (see backend/.env.production for full list)
   ```

3. **Deploy**:
   ```bash
   railway up
   ```

### Alternative: AWS Elastic Beanstalk
See `DEPLOYMENT-GUIDE.md` for detailed AWS deployment instructions.

## Environment Variables

### Frontend (.env.production)
```env
VITE_API_BASE_URL=your-backend-url
VITE_BACKEND_URL=your-backend-url
VITE_GOOGLE_CLIENT_ID=your-google-client-id
VITE_NODE_ENV=production
```

### Backend (.env.production)
```env
# Database
DB_TYPE=postgres
DB_HOST=your-db-host
DB_PORT=5432
DB_NAME=your-db-name
DB_USER=your-db-user
DB_PASSWORD=your-db-password
DB_SSL=true

# JWT
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=7d

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# AWS S3
AWS_S3_BUCKET_NAME=your-s3-bucket
AWS_REGION=your-aws-region
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key

# CORS
CORS_ORIGIN=https://chatak-acoustic.netlify.app
```

## Tech Stack

### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **UI Components**: shadcn-ui
- **State Management**: React Query
- **Routing**: React Router
- **Maps**: MapLibre GL
- **Charts**: Recharts

### Backend
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: PostgreSQL with Sequelize ORM
- **Authentication**: JWT + Google OAuth
- **File Storage**: AWS S3
- **Audio Processing**: Python (librosa, scipy, numpy)
- **Image Processing**: Sharp, Jimp
- **Security**: Helmet, CORS, Rate Limiting

### Infrastructure
- **Frontend Hosting**: Netlify
- **Backend Hosting**: Railway / AWS Elastic Beanstalk
- **Database**: PostgreSQL (Railway/AWS RDS)
- **File Storage**: AWS S3
- **CDN**: Netlify/CloudFront

## API Endpoints

- `GET /health` - Health check
- `POST /api/auth/login` - User authentication
- `GET /api/projects` - List projects
- `POST /api/projects` - Create project
- `GET /api/projects/:id/sites` - List sites
- `POST /api/projects/:id/recordings` - Upload recordings
- `GET /api/recordings/:id/segments` - Get audio segments
- `POST /api/recordings/:id/segmentation/jobs` - Start segmentation

## Development

### Project Structure
```
├── src/                 # Frontend source
├── backend/            # Backend API
│   ├── src/           # Backend source code
│   ├── bin/           # FFmpeg binaries
│   └── migrations/    # Database migrations
├── public/            # Static assets
└── dist/             # Build output
```

### Contributing
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License
MIT

---

## Links
- **Live Frontend**: https://chatak-acoustic.netlify.app
- **Repository**: Coming soon...
- **Documentation**: See `/docs` directory

For questions or contributions, please open an issue or pull request on GitHub.
