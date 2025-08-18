#!/bin/bash
echo 'Starting backend deployment...'

# Install Node.js
sudo yum update -y
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# Create backend
mkdir -p /home/ec2-user/backend
cd /home/ec2-user/backend

# Create package.json
cat > package.json << 'PKG_EOF'
{
  \"name\": \"chatak-backend\",
  \"version\": \"1.0.0\",
  \"main\": \"server.js\",
  \"dependencies\": {
    \"express\": \"^4.18.2\",
    \"cors\": \"^2.8.5\"
  }
}
PKG_EOF

# Install deps
npm install

# Create server
cat > server.js << 'SRV_EOF'
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 3001;

app.use(cors({
  origin: 'https://chatak-acoustic.netlify.app',
  credentials: true
}));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Chatak Backend is WORKING!',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'API working!',
    backend: 'Live'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Backend running on port ' + PORT);
});
SRV_EOF

# Start server
nohup node server.js > backend.log 2>&1 &
echo 'Backend deployment complete!'
