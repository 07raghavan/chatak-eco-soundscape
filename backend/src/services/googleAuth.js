import { OAuth2Client } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * Verify Google ID token and extract user information
 * @param {string} idToken - The ID token from Google OAuth
 * @returns {Promise<Object>} User data from Google
 */
export const verifyGoogleToken = async (idToken) => {
  try {
    console.log('🔍 Verifying Google token with client ID:', process.env.GOOGLE_CLIENT_ID);
    
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    console.log('✅ Google token verified successfully for user:', payload.email);
    
    return {
      email: payload.email,
      name: payload.name,
      sub: payload.sub, // Google user ID
      picture: payload.picture,
      email_verified: payload.email_verified
    };
  } catch (error) {
    console.error('❌ Google token verification failed:', error);
    console.error('Client ID:', process.env.GOOGLE_CLIENT_ID);
    console.error('Token length:', idToken ? idToken.length : 0);
    throw new Error('Invalid Google token');
  }
};

/**
 * Validate Google OAuth configuration
 */
export const validateGoogleConfig = () => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID is not configured');
  }
  
  console.log('✅ Google OAuth configuration validated');
  console.log('🔑 Client ID:', process.env.GOOGLE_CLIENT_ID);
}; 