const { MongoClient, ObjectId } = require('mongodb');

// In-Memory Mock database implementation for offline execution
class MockCollection {
  constructor(name) {
    this.name = name;
    this.docs = [];
  }
  async findOne(query) {
    return this.docs.find(d => {
      for (let k in query) {
        if (k === '_id' && query[k]) {
          const qId = query[k].toString();
          const dId = d[k] ? d[k].toString() : '';
          if (qId !== dId) return false;
          continue;
        }
        if (d[k] !== query[k]) return false;
      }
      return true;
    }) || null;
  }
  find(query) {
    const matched = this.docs.filter(d => {
      for (let k in query) {
        if (k === '_id' && query[k]) {
          const qId = query[k].toString();
          const dId = d[k] ? d[k].toString() : '';
          if (qId !== dId) return false;
          continue;
        }
        if (d[k] !== query[k]) return false;
      }
      return true;
    });
    return {
      sort: () => ({
        limit: () => ({
          toArray: async () => matched
        }),
        toArray: async () => matched
      }),
      limit: () => ({
        toArray: async () => matched
      }),
      toArray: async () => matched
    };
  }
  async insertOne(doc) {
    if (!doc._id) doc._id = new MockObjectId();
    this.docs.push(doc);
    return { insertedId: doc._id };
  }
  async updateOne(query, update, options) {
    let doc = await this.findOne(query);
    if (!doc) {
      if (options && options.upsert) {
        doc = { ...query };
        if (query._id && typeof query._id === 'string') {
          doc._id = new MockObjectId(query._id);
        }
        this.docs.push(doc);
      } else {
        return { matchedCount: 0, modifiedCount: 0 };
      }
    }
    if (update.$set) {
      for (let k in update.$set) {
        doc[k] = update.$set[k];
      }
    }
    if (update.$push) {
      for (let k in update.$push) {
        if (!doc[k]) doc[k] = [];
        const val = update.$push[k];
        if (val && typeof val === 'object' && ('$each' in val)) {
          doc[k].push(...val.$each);
        } else {
          doc[k].push(val);
        }
      }
    }
    if (update.$pull) {
      for (let k in update.$pull) {
        if (Array.isArray(doc[k])) {
          doc[k] = doc[k].filter(v => v !== update.$pull[k]);
        }
      }
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }
  async deleteOne(query) {
    const index = this.docs.findIndex(d => {
      for (let k in query) {
        if (k === '_id' && query[k]) {
          const qId = query[k].toString();
          const dId = d[k] ? d[k].toString() : '';
          if (qId !== dId) return false;
          continue;
        }
        if (d[k] !== query[k]) return false;
      }
      return true;
    });
    if (index !== -1) {
      this.docs.splice(index, 1);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }
  async countDocuments(query) {
    const matched = this.docs.filter(d => {
      for (let k in query) {
        if (k === '_id' && query[k]) {
          const qId = query[k].toString();
          const dId = d[k] ? d[k].toString() : '';
          if (qId !== dId) return false;
          continue;
        }
        if (d[k] !== query[k]) return false;
      }
      return true;
    });
    return matched.length;
  }
}

class MockDb {
  constructor() {
    this.collections = {};
  }
  collection(name) {
    if (!this.collections[name]) {
      this.collections[name] = new MockCollection(name);
    }
    return this.collections[name];
  }
}

class MockObjectId {
  constructor(id) {
    this.id = id || Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
  toString() {
    return this.id;
  }
}

class MockMongoClient {
  constructor() {}
  async connect() {
    return this;
  }
  db() {
    if (!global.mockDbInstance) {
      global.mockDbInstance = new MockDb();
    }
    return global.mockDbInstance;
  }
}

let activeClientClass = MongoClient;
let activeObjectIdClass = ObjectId;
let isMock = false;

if (!process.env.MONGODB_URI) {
  console.warn('[AI Studio] MONGODB_URI missing. Falling back to in-memory database mock.');
  activeClientClass = MockMongoClient;
  activeObjectIdClass = MockObjectId;
  isMock = true;
}

module.exports = {
  MongoClient: activeClientClass,
  ObjectId: activeObjectIdClass,
  isMock
};
