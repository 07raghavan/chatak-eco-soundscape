import { db } from './src/config/database.js';
import { QueryTypes } from 'sequelize';

async function testDatabaseConnection() {
  try {
    console.log('🔍 Testing database connection...');
    
    // Test basic connection
    await db.authenticate();
    console.log('✅ Database connection successful');
    
    // Check if events table exists
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'events'
      );
    `, { type: QueryTypes.SELECT });
    
    console.log('📊 Table check result:', tableCheck[0]);
    
    if (tableCheck[0].exists) {
      // Check table structure
      const columns = await db.query(`
        SELECT column_name, data_type, is_nullable 
        FROM information_schema.columns 
        WHERE table_name = 'events' 
        ORDER BY ordinal_position;
      `, { type: QueryTypes.SELECT });
      
      console.log('📋 Events table structure:');
      columns.forEach(col => {
        console.log(`  ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
      });
      
      // Test inserting a sample record
      const testRecordingId = 1756110017305;
      console.log(`🧪 Testing insert with recording_id: ${testRecordingId}`);
      
      const insertResult = await db.query(`
        INSERT INTO events (
          recording_id,
          species,
          scientific_name,
          confidence,
          start_ms,
          end_ms,
          duration_ms,
          snippet_file_path,
          snippet_file_size,
          created_at
        ) VALUES (
          :recordingId,
          :species,
          :scientificName,
          :confidence,
          :startMs,
          :endMs,
          :durationMs,
          :snippetFilePath,
          :snippetFileSize,
          NOW()
        ) RETURNING id
      `, {
        replacements: {
          recordingId: testRecordingId,
          species: 'Test Bird',
          scientificName: 'Testus birdus',
          confidence: 0.95,
          startMs: 1000,
          endMs: 3000,
          durationMs: 2000,
          snippetFilePath: '/test/path.wav',
          snippetFileSize: 1024
        },
        type: QueryTypes.INSERT
      });
      
      console.log('✅ Test insert successful:', insertResult[0]);
      
      // Clean up test record
      await db.query(`
        DELETE FROM events WHERE recording_id = :recordingId AND species = 'Test Bird'
      `, {
        replacements: { recordingId: testRecordingId },
        type: QueryTypes.DELETE
      });
      
      console.log('🧹 Test record cleaned up');
      
    } else {
      console.log('❌ Events table does not exist');
    }
    
  } catch (error) {
    console.error('❌ Database test failed:', error);
    console.error('Error details:', error.message);
    if (error.parent) {
      console.error('Parent error:', error.parent.message);
    }
  } finally {
    await db.close();
  }
}

testDatabaseConnection();
