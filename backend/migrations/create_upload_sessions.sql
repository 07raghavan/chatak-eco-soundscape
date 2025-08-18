-- Upload sessions table for tracking direct S3 uploads
CREATE TABLE IF NOT EXISTS upload_sessions (
  id SERIAL PRIMARY KEY,
  upload_id UUID NOT NULL UNIQUE,
  recording_id BIGINT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  site_id INTEGER NOT NULL REFERENCES sites(id),
  user_id INTEGER NOT NULL REFERENCES users(id),

  -- File metadata
  filename VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  s3_key VARCHAR(500) NOT NULL,

  -- Upload type and status
  upload_type VARCHAR(20) NOT NULL CHECK (upload_type IN ('simple', 'multipart')),
  status VARCHAR(20) NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'completed', 'aborted', 'failed')),

  -- Multipart upload specific
  multipart_upload_id VARCHAR(255),
  total_parts INTEGER,

  -- Integrity and security
  etag VARCHAR(255),
  checksum VARCHAR(255),

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '2 hours')
);

-- Create indexes separately
CREATE INDEX IF NOT EXISTS idx_upload_sessions_upload_id ON upload_sessions(upload_id);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_user_id ON upload_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON upload_sessions(status);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires ON upload_sessions(expires_at);

-- Update recordings table to support new upload system
ALTER TABLE recordings 
ADD COLUMN IF NOT EXISTS etag VARCHAR(255),
ADD COLUMN IF NOT EXISTS content_type VARCHAR(100),
ADD COLUMN IF NOT EXISTS checksum VARCHAR(255),
ADD COLUMN IF NOT EXISTS upload_session_id UUID REFERENCES upload_sessions(upload_id);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_recordings_etag ON recordings(etag);
CREATE INDEX IF NOT EXISTS idx_recordings_upload_session ON recordings(upload_session_id);

-- Cleanup job for expired upload sessions
CREATE OR REPLACE FUNCTION cleanup_expired_upload_sessions()
RETURNS void AS $$
BEGIN
  -- Delete expired upload sessions that were never completed
  DELETE FROM upload_sessions 
  WHERE status = 'initiated' 
    AND expires_at < NOW() - INTERVAL '1 day';
    
  -- Log cleanup
  RAISE NOTICE 'Cleaned up expired upload sessions';
END;
$$ LANGUAGE plpgsql;

-- Schedule cleanup to run daily (requires pg_cron extension)
-- SELECT cron.schedule('cleanup-uploads', '0 2 * * *', 'SELECT cleanup_expired_upload_sessions();');

COMMENT ON TABLE upload_sessions IS 'Tracks direct S3 upload sessions with multipart support';
COMMENT ON COLUMN upload_sessions.upload_id IS 'Unique identifier for the upload session';
COMMENT ON COLUMN upload_sessions.s3_key IS 'S3 object key following the pattern: raw/project-X/site-Y/device-Z/YYYY/MM/DD/recordingId.orig.ext';
COMMENT ON COLUMN upload_sessions.multipart_upload_id IS 'S3 multipart upload ID for large files';
COMMENT ON COLUMN upload_sessions.etag IS 'S3 ETag for integrity verification';
COMMENT ON COLUMN upload_sessions.checksum IS 'SHA256 checksum for additional integrity verification';
