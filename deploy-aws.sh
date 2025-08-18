#!/bin/bash

# Chatak Eco-Soundscape Platform - AWS Deployment Script
# This script deploys the backend to AWS ECS with EC2

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REGION="ap-south-1"
STACK_NAME="chatak-eco-soundscape"
ECR_REPO_NAME="chatak-backend"
KEY_PAIR_NAME=""  # Will be set by user

echo -e "${BLUE}🚀 Chatak Eco-Soundscape Platform - AWS Deployment${NC}"
echo "================================================="

# Check if AWS CLI is configured
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo -e "${RED}❌ AWS CLI is not configured. Please run 'aws configure'${NC}"
    exit 1
fi

# Get AWS Account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo -e "${GREEN}✅ AWS Account ID: $ACCOUNT_ID${NC}"

# Ask for Key Pair name
read -p "Enter your EC2 Key Pair name (for SSH access): " KEY_PAIR_NAME
if [ -z "$KEY_PAIR_NAME" ]; then
    echo -e "${RED}❌ Key Pair name is required${NC}"
    exit 1
fi

# Step 1: Create ECR Repository
echo -e "${YELLOW}📦 Step 1: Creating ECR Repository...${NC}"
aws ecr create-repository \
    --repository-name $ECR_REPO_NAME \
    --region $REGION || true

ECR_URI="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$ECR_REPO_NAME"
echo -e "${GREEN}✅ ECR Repository: $ECR_URI${NC}"

# Step 2: Build and Push Docker Image
echo -e "${YELLOW}🐳 Step 2: Building and pushing Docker image...${NC}"
cd backend

# Get ECR login token
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_URI

# Build the image
docker build -t $ECR_REPO_NAME .
docker tag $ECR_REPO_NAME:latest $ECR_URI:latest

# Push to ECR
docker push $ECR_URI:latest

echo -e "${GREEN}✅ Docker image pushed to ECR${NC}"
cd ..

# Step 3: Set up SSM Parameters for secrets
echo -e "${YELLOW}🔐 Step 3: Setting up SSM Parameters for secrets...${NC}"

# Create secure parameters
aws ssm put-parameter \
    --name "/chatak/prod/db-password" \
    --value "raghav2305" \
    --type "SecureString" \
    --region $REGION \
    --overwrite || true

aws ssm put-parameter \
    --name "/chatak/prod/jwt-secret" \
    --value "your-super-secure-jwt-secret-for-production-$(date +%s)" \
    --type "SecureString" \
    --region $REGION \
    --overwrite || true

aws ssm put-parameter \
    --name "/chatak/prod/google-client-secret" \
    --value "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" \
    --type "SecureString" \
    --region $REGION \
    --overwrite || true

aws ssm put-parameter \
    --name "/chatak/prod/aws-secret-key" \
    --value "k+tTb8rLDOM1j4/mWoPd5tFpFWUIVKHdwk3BmIRk" \
    --type "SecureString" \
    --region $REGION \
    --overwrite || true

echo -e "${GREEN}✅ SSM Parameters created${NC}"

# Step 4: Deploy CloudFormation stack
echo -e "${YELLOW}☁️ Step 4: Deploying AWS infrastructure...${NC}"
aws cloudformation deploy \
    --template-file aws-infrastructure.yaml \
    --stack-name $STACK_NAME \
    --parameter-overrides KeyPairName=$KEY_PAIR_NAME \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION

echo -e "${GREEN}✅ Infrastructure deployed${NC}"

# Step 5: Update and register task definition
echo -e "${YELLOW}📋 Step 5: Updating and registering ECS task definition...${NC}"

# Get outputs from CloudFormation
TASK_EXECUTION_ROLE_ARN=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`TaskExecutionRoleArn`].OutputValue' \
    --output text \
    --region $REGION)

TASK_ROLE_ARN=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`TaskRoleArn`].OutputValue' \
    --output text \
    --region $REGION)

# Update task definition with actual values
sed -i.bak \
    -e "s|YOUR_ACCOUNT_ID|$ACCOUNT_ID|g" \
    -e "s|YOUR_ECR_URI|$ECR_URI|g" \
    backend/ecs-task-definition.json

sed -i.bak \
    -e "s|arn:aws:iam::YOUR_ACCOUNT_ID:role/ecsTaskExecutionRole|$TASK_EXECUTION_ROLE_ARN|g" \
    -e "s|arn:aws:iam::YOUR_ACCOUNT_ID:role/ecsTaskRole|$TASK_ROLE_ARN|g" \
    backend/ecs-task-definition.json

# Register task definition
aws ecs register-task-definition \
    --cli-input-json file://backend/ecs-task-definition.json \
    --region $REGION

echo -e "${GREEN}✅ Task definition registered${NC}"

# Step 6: Create and start ECS service
echo -e "${YELLOW}🏃 Step 6: Creating ECS service...${NC}"

CLUSTER_NAME=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`ECSClusterName`].OutputValue' \
    --output text \
    --region $REGION)

# Get target group ARN
TARGET_GROUP_ARN=$(aws elbv2 describe-target-groups \
    --names "Chatak-TG" \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text \
    --region $REGION)

# Create ECS service
aws ecs create-service \
    --cluster $CLUSTER_NAME \
    --service-name chatak-backend-service \
    --task-definition chatak-backend-task \
    --desired-count 1 \
    --launch-type EC2 \
    --load-balancers targetGroupArn=$TARGET_GROUP_ARN,containerName=chatak-backend,containerPort=3001 \
    --region $REGION || true

echo -e "${GREEN}✅ ECS service created${NC}"

# Step 7: Get Load Balancer DNS
echo -e "${YELLOW}🌐 Step 7: Getting Load Balancer DNS...${NC}"

ALB_DNS=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
    --output text \
    --region $REGION)

echo -e "${GREEN}✅ Deployment completed!${NC}"
echo "================================================="
echo -e "${BLUE}🎉 Your backend is deployed at: ${GREEN}http://$ALB_DNS${NC}"
echo -e "${BLUE}📋 Next steps:${NC}"
echo "1. Wait 3-5 minutes for the service to start"
echo "2. Test the health endpoint: curl http://$ALB_DNS/health"
echo "3. Update your frontend environment variables with this URL"
echo "4. Deploy your frontend to Netlify"
echo ""
echo -e "${YELLOW}⚠️ Remember to:${NC}"
echo "- Update CORS_ORIGIN in your backend environment"
echo "- Set up SSL certificate for production"
echo "- Configure domain name if needed"
