import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import bcrypt from 'bcryptjs';

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  password_hash: {
    type: DataTypes.STRING(255),
    allowNull: true // null for Google OAuth users
  },
  google_id: {
    type: DataTypes.STRING(255),
    allowNull: true, // null for normal users
    unique: true
  },
  organization: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'users',
  schema: 'public',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  hooks: {
    beforeCreate: async (user) => {
      if (user.password_hash) {
        user.password_hash = await bcrypt.hash(user.password_hash, 12);
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password_hash') && user.password_hash) {
        user.password_hash = await bcrypt.hash(user.password_hash, 12);
      }
    }
  }
});

// Instance method to check password
User.prototype.checkPassword = async function(password) {
  if (!this.password_hash) return false;
  return await bcrypt.compare(password, this.password_hash);
};

// Static method to find by email
User.findByEmail = async function(email) {
  return await this.findOne({ where: { email } });
};

// Static method to find by Google ID
User.findByGoogleId = async function(googleId) {
  return await this.findOne({ where: { google_id: googleId } });
};

// Static method to create or update Google user
User.upsertGoogleUser = async function(googleData) {
  const { email, name, sub: googleId } = googleData;
  
  const [user, created] = await this.findOrCreate({
    where: { email },
    defaults: {
      name,
      google_id: googleId,
      password_hash: null
    }
  });

  // If user exists but doesn't have google_id, update it
  if (!created && !user.google_id) {
    user.google_id = googleId;
    user.name = name;
    await user.save();
  }

  return user;
};

export default User; 