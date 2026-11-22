const mongoose = require('mongoose');

const permissionsSchema = new mongoose.Schema(
  {
    dashboard: { type: Boolean, default: true },
    products: { type: Boolean, default: true },
    suppliers: { type: Boolean, default: true },
    clients: { type: Boolean, default: true },
    quotes: { type: Boolean, default: true },
    sessions: { type: Boolean, default: false },
    adminPanel: { type: Boolean, default: false },
    canEdit: { type: Boolean, default: true },
    canDelete: { type: Boolean, default: false },
    canEmail: { type: Boolean, default: true },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    displayName: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      trim: true,
      default: '',
    },
    avatarUrl: {
      type: String,
      trim: true,
      default: '',
    },
    // Exhibition contact card fields (Admin & Owner)
    designation: { type: String, trim: true, default: '' },
    mobile: { type: String, trim: true, default: '' },
    whatsapp: { type: String, trim: true, default: '' },
    wechat: { type: String, trim: true, default: '' },
    whatsappQr: { type: String, trim: true, default: '' },
    wechatQr: { type: String, trim: true, default: '' },
    // Timed access granted via access-request approval (scoped to page + actions)
    tempAccess: {
      until: { type: Date, default: null },
      canEdit: { type: Boolean, default: false },
      canEmail: { type: Boolean, default: false },
      canDelete: { type: Boolean, default: false },
      permission: { type: String, default: '' },
      pageKey: { type: String, default: '' },
      pages: { type: [String], default: undefined },
      grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
    // Stores a bcrypt hash (never plain text)
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['admin', 'owner', 'staff', 'user'],
      default: 'staff',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    permissions: {
      type: permissionsSchema,
      default: () => ({}),
    },
    lastLoginAt: {
      type: Date,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

function defaultPermissionsForRole(role) {
  if (role === 'admin') {
    return {
      dashboard: true,
      products: true,
      suppliers: true,
      clients: true,
      quotes: true,
      sessions: true,
      adminPanel: true,
      canEdit: true,
      canDelete: true,
      canEmail: true,
    };
  }
  if (role === 'owner') {
    return {
      dashboard: true,
      products: true,
      suppliers: true,
      clients: true,
      quotes: true,
      sessions: true,
      adminPanel: false,
      canEdit: true,
      canDelete: true,
      canEmail: true,
    };
  }
  if (role === 'user') {
    // Legacy role from earlier versions — treat as owner-level access
    return defaultPermissionsForRole('owner');
  }
  return {
    dashboard: true,
    products: true,
    suppliers: true,
    clients: true,
    quotes: true,
    sessions: false,
    adminPanel: false,
    canEdit: true,
    canDelete: false,
    canEmail: true,
  };
}

userSchema.statics.resolvePermissions = function resolvePermissions(user) {
  const role = user.role || 'staff';
  // Admins always get the full admin set — schema defaults (e.g. adminPanel:false)
  // must not override role-based access after User.create().
  if (role === 'admin') {
    return defaultPermissionsForRole('admin');
  }
  const defaults = defaultPermissionsForRole(role);
  const stored = user.permissions && typeof user.permissions === 'object'
    ? (user.permissions.toObject ? user.permissions.toObject() : user.permissions)
    : {};
  return { ...defaults, ...stored };
};

userSchema.statics.defaultPermissionsForRole = defaultPermissionsForRole;

module.exports = mongoose.model('User', userSchema);
