// teste de conexão com MongoDB no Vercel
const { MongoClient } = require('mongodb');

module.exports = async function handler(req, res) {
  const uri = process.env.MONGODB_URI;
  if (!uri) return res.status(500).json({ ok: false, error: 'MONGODB_URI não configurada' });
  let client;
  try {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    const db = client.db('manganana');
    await db.collection('_ping').insertOne({ ok: 1, ts: new Date() });
    const n = await db.collection('_ping').countDocuments();
    await db.collection('_ping').deleteMany({});
    res.json({ ok: true, ping: n, db: 'manganana', ts: Date.now() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    if (client) await client.close().catch(() => {});
  }
};
