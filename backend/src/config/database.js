import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

// Support SSL for both PostgreSQL and MySQL
const useSSL = String(process.env.DB_SSL || '').toLowerCase() === 'true' ||
               process.env.NODE_ENV === 'production' ||
               process.env.SUPABASE_DB_URL; // Auto-enable SSL for Supabase

// Support both PostgreSQL and MySQL with connection strings or individual params
const getDatabaseConfig = () => {
  // Determine database type from environment
  const dbType = process.env.DB_TYPE || 'postgres'; // Default to postgres for backward compatibility

  // If using connection string (Supabase for PostgreSQL or MySQL connection string)
  if (process.env.SUPABASE_DB_URL || process.env.MYSQL_DB_URL) {
    const isPostgres = !!process.env.SUPABASE_DB_URL;

    return {
      dialect: isPostgres ? 'postgres' : 'mysql',
      dialectOptions: {
        ssl: useSSL ? {
          require: true,
          rejectUnauthorized: false
        } : false
      },
      logging: process.env.NODE_ENV === 'development' ? console.log : false,
      pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
      }
    };
  }

  // Individual connection parameters
  const config = {
    dialect: dbType,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || (dbType === 'mysql' ? 3306 : 5432),
    database: process.env.DB_NAME,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    dialectOptions: {
      ssl: useSSL ? {
        require: true,
        rejectUnauthorized: false
      } : false
    }
  };

  // Add PostgreSQL-specific options
  if (dbType === 'postgres') {
    config.schema = 'public';
    config.searchPath = 'public';
    config.define = { schema: 'public' };
  }

  return config;
};

// Create Sequelize instance
const sequelize = (process.env.SUPABASE_DB_URL || process.env.MYSQL_DB_URL)
  ? new Sequelize(process.env.SUPABASE_DB_URL || process.env.MYSQL_DB_URL, getDatabaseConfig())
  : new Sequelize(getDatabaseConfig());

// Export sequelize as 'db' for controllers
export const db = sequelize;

// Test the connection
export const testConnection = async () => {
  try {
    await sequelize.authenticate();

    // Determine database type for appropriate queries
    const dbType = process.env.DB_TYPE || (process.env.SUPABASE_DB_URL ? 'postgres' : 'mysql');

    let query, tableCheckQuery;
    if (dbType === 'postgres') {
      query = `
        SELECT current_database() as db,
               current_user as user,
               current_schema() as schema,
               version() as pg_version
      `;
      tableCheckQuery = `SELECT 1 FROM pg_tables WHERE tablename = 'users' LIMIT 1`;
    } else {
      query = `
        SELECT DATABASE() as db,
               USER() as user,
               VERSION() as mysql_version
      `;
      tableCheckQuery = `SELECT 1 FROM information_schema.tables WHERE table_name = 'users' LIMIT 1`;
    }

    const [results] = await sequelize.query(query);
    console.log('✅ Database connection established:', results[0]);

    // Best-effort table check
    await sequelize.query(tableCheckQuery);
    return true;
  } catch (error) {
    // Provide concise, actionable error
    const raw = process.env.SUPABASE_DB_URL || process.env.MYSQL_DB_URL || `${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
    const maskUrl = (u) => typeof u === 'string' ? u.replace(/(:\/\/[^:]+:)[^@]+@/, '$1***@') : u;
    const host = maskUrl(raw);
    const errMsg = `Database connection failed. Check connection string or DB_* env vars. Host: ${host}. Root cause: ${error?.code || error?.name || 'unknown'}`;
    console.error('❌', errMsg);
    throw new Error(errMsg);
  }
};

export default sequelize; 