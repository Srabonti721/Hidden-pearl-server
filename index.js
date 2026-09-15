const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI || `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.efzq5bn.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

const isValidId = (id) => ObjectId.isValid(id);
function foodPayload(body, partial = false) {
  const allowed = ['name', 'foodName', 'image', 'photo', 'category', 'price', 'quantity', 'description', 'ingredients', 'origin', 'rating', 'email', 'userEmail', 'chef', 'addedBy', 'createdAt'];
  const payload = {};
  allowed.forEach((key) => { if (body[key] !== undefined) payload[key] = body[key]; });
  if (!partial) payload.createdAt = payload.createdAt || new Date();
  payload.updatedAt = new Date();
  return payload;
}

async function startServer() {
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    const foods = client.db('HiddenPearlDB').collection('foods');
    console.log('Connected to MongoDB.');

    // All-food / menu / my-food sections. Query: category, email, search, page, limit.
    app.get('/foods', async (req, res, next) => {
      try {
        const { category, email, search, page, limit } = req.query;
        const query = {};
        if (category) query.category = category;
        if (email) query.$or = [{ email }, { userEmail: email }];
        if (search) query.$or = [{ name: { $regex: search, $options: 'i' } }, { foodName: { $regex: search, $options: 'i' } }, { category: { $regex: search, $options: 'i' } }];
        const options = { sort: { createdAt: -1, _id: -1 } };
        if (page || limit) {
          const currentPage = Math.max(parseInt(page, 10) || 1, 1);
          const pageSize = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
          options.skip = (currentPage - 1) * pageSize;
          options.limit = pageSize;
        }
        res.json(await foods.find(query, options).toArray());
      } catch (error) { next(error); }
    });

    app.get('/categories', async (_req, res, next) => {
      try {
        res.json(await foods.aggregate([
          { $match: { category: { $type: 'string', $ne: '' } } },
          { $group: { _id: '$category', totalFoods: { $sum: 1 } } },
          { $project: { _id: 0, name: '$_id', totalFoods: 1 } },
          { $sort: { name: 1 } },
        ]).toArray());
      } catch (error) { next(error); }
    });

    app.get('/foods/:id', async (req, res, next) => {
      try {
        if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid food id.' });
        const food = await foods.findOne({ _id: new ObjectId(req.params.id) });
        if (!food) return res.status(404).json({ message: 'Food not found.' });
        res.json(food);
      } catch (error) { next(error); }
    });

    app.post('/foods', async (req, res, next) => {
      try {
        const food = foodPayload(req.body);
        if (!food.name && !food.foodName) return res.status(400).json({ message: 'Food name is required.' });
        const result = await foods.insertOne(food);
        res.status(201).json({ acknowledged: result.acknowledged, insertedId: result.insertedId });
      } catch (error) { next(error); }
    });

    app.patch('/foods/:id', async (req, res, next) => {
      try {
        if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid food id.' });
        const updates = foodPayload(req.body, true);
        if (Object.keys(updates).length === 1) return res.status(400).json({ message: 'Provide at least one field to update.' });
        const result = await foods.updateOne({ _id: new ObjectId(req.params.id) }, { $set: updates });
        if (!result.matchedCount) return res.status(404).json({ message: 'Food not found.' });
        res.json(result);
      } catch (error) { next(error); }
    });

    app.delete('/foods/:id', async (req, res, next) => {
      try {
        if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid food id.' });
        const result = await foods.deleteOne({ _id: new ObjectId(req.params.id) });
        if (!result.deletedCount) return res.status(404).json({ message: 'Food not found.' });
        res.json(result);
      } catch (error) { next(error); }
    });

    app.get('/', (_req, res) => res.send('Hidden Pearl restaurant server is running.'));
    app.use((error, _req, res, _next) => {
      console.error(error);
      res.status(500).json({ message: 'Something went wrong on the server.' });
    });
    app.listen(port, () => console.log(`Hidden Pearl server listening on port ${port}`));
  } catch (error) {
    console.error('Unable to start server:', error);
    process.exit(1);
  }
}

startServer();
process.on('SIGINT', async () => { await client.close(); process.exit(0); });
