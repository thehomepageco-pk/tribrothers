/**
 * Seed script: loads sample data from seed-data.json into the database.
 * Usage: node seed.js
 *
 * To use your own data: edit seed-data.json (or paste your data and we can update it),
 * then run: node seed.js
 *
 * Optional: node seed.js --clear  (deletes existing products/suppliers/clients and links first)
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const Product = require('./models/Product');
const Supplier = require('./models/Supplier');
const Client = require('./models/Client');
const SupplierProduct = require('./models/SupplierProduct');
const ProductClient = require('./models/ProductClient');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/software';
const seedPath = path.join(__dirname, 'seed-data.json');

async function seed() {
  const clearFirst = process.argv.includes('--clear');

  if (!fs.existsSync(seedPath)) {
    console.error('❌ seed-data.json not found. Create it or run from project root.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  try {
    if (clearFirst) {
      await ProductClient.deleteMany({});
      await SupplierProduct.deleteMany({});
      await Product.deleteMany({});
      await Supplier.deleteMany({});
      await Client.deleteMany({});
      console.log('🗑️  Cleared existing products, suppliers, clients, and links.');
    }

    const productIds = [];
    for (const p of data.products || []) {
      const doc = await Product.create(p);
      productIds.push(doc._id);
    }
    console.log(`✅ Inserted ${productIds.length} products`);

    const supplierIds = [];
    for (const s of data.suppliers || []) {
      const doc = await Supplier.create(s);
      supplierIds.push(doc._id);
    }
    console.log(`✅ Inserted ${supplierIds.length} suppliers`);

    const clientIds = [];
    for (const c of data.clients || []) {
      const doc = await Client.create(c);
      clientIds.push(doc._id);
    }
    console.log(`✅ Inserted ${clientIds.length} clients`);

    for (const sp of data.supplierProducts || []) {
      const productId = productIds[sp.productIndex];
      const supplierId = supplierIds[sp.supplierIndex];
      if (productId && supplierId) {
        await SupplierProduct.create({
          productId,
          supplierId,
          supplierPrice: sp.supplierPrice,
          currency: sp.currency,
          MOQ: sp.MOQ,
          leadTime: sp.leadTime,
          notes: sp.notes,
        });
      }
    }
    console.log(`✅ Inserted ${(data.supplierProducts || []).length} supplier–product links`);

    for (const pc of data.productClients || []) {
      const productId = productIds[pc.productIndex];
      const clientId = clientIds[pc.clientIndex];
      if (productId && clientId) {
        await ProductClient.create({
          productId,
          clientId,
          notes: pc.notes,
        });
      }
    }
    console.log(`✅ Inserted ${(data.productClients || []).length} product–client links`);

    console.log('\n✅ Seed completed.');
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
