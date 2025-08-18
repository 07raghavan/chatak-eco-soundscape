-- Create segment_approvals table to track manual review/approval of segments

CREATE TABLE IF NOT EXISTS segment_approvals (
  id SERIAL PRIMARY KEY,
  segment_id INT NOT NULL UNIQUE REFERENCES segments(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_by INT NULL REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMP NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_segment_approvals_status ON segment_approvals(status);

-- Trigger to maintain updated_at
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_segment_approvals_updated_at'
  ) THEN
    CREATE TRIGGER trg_segment_approvals_updated_at BEFORE UPDATE ON segment_approvals
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;


