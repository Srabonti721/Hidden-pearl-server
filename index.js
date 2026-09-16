const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

const uri =
    process.env.MONGODB_URI ||
    `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.efzq5bn.mongodb.net/?appName=Cluster0`;
const jwtSecret = process.env.JWT_SIGN_SECRET;

// Connect lazily and cache the connection so Vercel serverless functions can
// re-use the same Mongo client across warm invocations.
let dbPromise = null;
function getCollections() {
    if (!dbPromise) {
        const client = new MongoClient(uri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            },
        });
        dbPromise = client.connect().then(async () => {
            await client.db("admin").command({ ping: 1 });
            console.log("Connected to MongoDB.");
            return {
                client,
                foods: client.db("HiddenPearlDB").collection("foods"),
                purchases: client.db("HiddenPearlDB").collection("purchases"),
            };
        });
    }
    return dbPromise;
}

const isValidId = (id) => ObjectId.isValid(id);

function decodeToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    try {
        return jwt.verify(authHeader.split(" ")[1], jwtSecret);
    } catch (error) {
        return null;
    }
}

const verifyJWT = (req, res, next) => {
    const decoded = decodeToken(req);
    if (!decoded) {
        return res.status(401).json({ message: "Unauthorized access." });
    }
    req.decoded = decoded;
    next();
};

function foodPayload(body, partial = false) {
    const allowed = [
        "name",
        "foodName",
        "image",
        "photo",
        "category",
        "price",
        "quantity",
        "description",
        "ingredients",
        "origin",
        "rating",
        "email",
        "userEmail",
        "chef",
        "addedBy",
        "createdAt",
    ];
    const payload = {};
    allowed.forEach((key) => {
        if (body[key] !== undefined) payload[key] = body[key];
    });
    if (!partial) payload.createdAt = payload.createdAt || new Date();
    payload.updatedAt = new Date();
    return payload;
}

function foodOwner(food) {
    const owner = food?.addedBy || food?.userEmail || food?.email || food?.addedByEmail;
    return typeof owner === "object" ? owner?.email : owner;
}

// Issue a signed JWT for a logged-in user. The client sends this token back in
// the Authorization header on every request.
app.post("/jwt", (req, res) => {
    const email = req.body?.email;
    if (!email || typeof email !== "string") {
        return res.status(400).json({ message: "Email is required." });
    }
    const token = jwt.sign({ email }, jwtSecret, { expiresIn: "1h" });
    res.json({ token });
});

// All-food / menu / my-food sections. Query: category, email, search, page, limit.
app.get("/foods", async (req, res, next) => {
    try {
        if (req.query.email) {
            const decoded = decodeToken(req);
            if (!decoded)
                return res
                    .status(401)
                    .json({ message: "Unauthorized access." });
            if (req.query.email.toLowerCase() !== decoded.email.toLowerCase())
                return res
                    .status(403)
                    .json({ message: "Forbidden access." });
        }

        const { foods } = await getCollections();
        const { category, email, search, page, limit } = req.query;
        const query = {};
        if (category) query.category = category;
        if (email) query.$or = [{ email }, { userEmail: email }];
        if (search)
            query.$or = [
                { name: { $regex: search, $options: "i" } },
                { foodName: { $regex: search, $options: "i" } },
                { category: { $regex: search, $options: "i" } },
            ];
        const options = { sort: { createdAt: -1, _id: -1 } };
        if (page || limit) {
            const currentPage = Math.max(parseInt(page, 10) || 1, 1);
            const pageSize = Math.min(
                Math.max(parseInt(limit, 10) || 10, 1),
                100,
            );
            options.skip = (currentPage - 1) * pageSize;
            options.limit = pageSize;
        }
        res.json(await foods.find(query, options).toArray());
    } catch (error) {
        next(error);
    }
});

app.get("/categories", async (_req, res, next) => {
    try {
        const { foods } = await getCollections();
        res.json(
            await foods
                .aggregate([
                    {
                        $match: {
                            category: { $type: "string", $ne: "" },
                        },
                    },
                    {
                        $group: {
                            _id: "$category",
                            totalFoods: { $sum: 1 },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            name: "$_id",
                            totalFoods: 1,
                        },
                    },
                    { $sort: { name: 1 } },
                ])
                .toArray(),
        );
    } catch (error) {
        next(error);
    }
});

app.get("/foods/:id", async (req, res, next) => {
    try {
        if (!isValidId(req.params.id))
            return res.status(400).json({ message: "Invalid food id." });
        const { foods } = await getCollections();
        const food = await foods.findOne({
            _id: new ObjectId(req.params.id),
        });
        if (!food) return res.status(404).json({ message: "Food not found." });
        res.json(food);
    } catch (error) {
        next(error);
    }
});

app.post("/foods", verifyJWT, async (req, res, next) => {
    try {
        const food = foodPayload(req.body);
        if (!food.name && !food.foodName)
            return res
                .status(400)
                .json({ message: "Food name is required." });
        const { foods } = await getCollections();
        const result = await foods.insertOne(food);
        res.status(201).json({
            acknowledged: result.acknowledged,
            insertedId: result.insertedId,
        });
    } catch (error) {
        next(error);
    }
});

app.patch("/foods/:id", verifyJWT, async (req, res, next) => {
    try {
        if (!isValidId(req.params.id))
            return res.status(400).json({ message: "Invalid food id." });
        const { foods } = await getCollections();
        const food = await foods.findOne({
            _id: new ObjectId(req.params.id),
        });
        if (!food) return res.status(404).json({ message: "Food not found." });
        if (foodOwner(food)?.toLowerCase() !== req.decoded.email.toLowerCase())
            return res
                .status(403)
                .json({ message: "You can only update your own food." });

        const updates = foodPayload(req.body, true);
        if (Object.keys(updates).length === 1)
            return res
                .status(400)
                .json({
                    message: "Provide at least one field to update.",
                });
        const result = await foods.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: updates },
        );
        res.json(result);
    } catch (error) {
        next(error);
    }
});

app.delete("/foods/:id", verifyJWT, async (req, res, next) => {
    try {
        if (!isValidId(req.params.id))
            return res.status(400).json({ message: "Invalid food id." });
        const { foods } = await getCollections();
        const food = await foods.findOne({
            _id: new ObjectId(req.params.id),
        });
        if (!food) return res.status(404).json({ message: "Food not found." });
        if (foodOwner(food)?.toLowerCase() !== req.decoded.email.toLowerCase())
            return res
                .status(403)
                .json({ message: "You can only delete your own food." });

        const result = await foods.deleteOne({
            _id: new ObjectId(req.params.id),
        });
        if (!result.deletedCount)
            return res.status(404).json({ message: "Food not found." });
        res.json(result);
    } catch (error) {
        next(error);
    }
});

app.get("/purchases", verifyJWT, async (req, res, next) => {
    try {
        const query = req.query.email ? { buyerEmail: req.query.email } : {};
        if (
            req.query.email &&
            query.buyerEmail?.toLowerCase() !== req.decoded.email.toLowerCase()
        )
            return res
                .status(403)
                .json({ message: "Forbidden access." });
        const { purchases } = await getCollections();
        res.json(
            await purchases
                .find(query, { sort: { buyingDate: -1, _id: -1 } })
                .toArray(),
        );
    } catch (error) {
        next(error);
    }
});

app.post("/purchases", verifyJWT, async (req, res, next) => {
    try {
        const { foodId, buyerEmail, buyerName } = req.body;
        const quantity = Number(req.body.quantity);
        if (!isValidId(foodId))
            return res
                .status(400)
                .json({ message: "A valid food id is required." });
        if (
            !buyerEmail ||
            !Number.isInteger(quantity) ||
            quantity < 1
        ) {
            return res
                .status(400)
                .json({
                    message:
                        "Buyer email and a valid quantity are required.",
                });
        }
        if (buyerEmail.toLowerCase() !== req.decoded.email.toLowerCase())
            return res
                .status(403)
                .json({ message: "Forbidden access." });

        const { foods, purchases } = await getCollections();
        const food = await foods.findOne({ _id: new ObjectId(foodId) });
        if (!food) return res.status(404).json({ message: "Food not found." });
        const ownerEmail = foodOwner(food);
        if (ownerEmail?.toLowerCase() === buyerEmail.toLowerCase()) {
            return res
                .status(403)
                .json({
                    message: "You cannot purchase your own food item.",
                });
        }

        const availableQuantity = Number(
            food.quantity ?? food.availableQuantity ?? food.stock ?? 0,
        );
        if (
            !Number.isFinite(availableQuantity) ||
            availableQuantity < quantity
        ) {
            return res
                .status(409)
                .json({
                    message:
                        "The requested quantity is no longer available.",
                });
        }

        const stockUpdate = await foods.updateOne(
            { _id: food._id, quantity: { $gte: quantity } },
            {
                $inc: { quantity: -quantity, purchaseCount: quantity },
                $set: { updatedAt: new Date() },
            },
        );
        if (!stockUpdate.modifiedCount)
            return res
                .status(409)
                .json({
                    message:
                        "The requested quantity is no longer available.",
                });

        const purchase = {
            foodId: food._id.toString(),
            foodName: food.foodName || food.name,
            price: food.price,
            quantity,
            buyerName: buyerName || "Hidden Pearl user",
            buyerEmail,
            buyingDate: new Date(),
            foodImage: food.image || food.photo,
            foodOwner: food.addedBy || food.userEmail || food.email,
        };
        const result = await purchases.insertOne(purchase);
        res.status(201).json({
            acknowledged: result.acknowledged,
            insertedId: result.insertedId,
        });
    } catch (error) {
        next(error);
    }
});

app.delete("/purchases/:id", verifyJWT, async (req, res, next) => {
    try {
        if (!isValidId(req.params.id))
            return res.status(400).json({ message: "Invalid purchase id." });
        const { purchases } = await getCollections();
        const purchase = await purchases.findOne({
            _id: new ObjectId(req.params.id),
        });
        if (!purchase)
            return res.status(404).json({ message: "Purchase not found." });
        if (
            purchase.buyerEmail?.toLowerCase() !==
            req.decoded.email.toLowerCase()
        )
            return res
                .status(403)
                .json({ message: "Forbidden access." });

        const result = await purchases.deleteOne({
            _id: new ObjectId(req.params.id),
        });
        if (!result.deletedCount)
            return res.status(404).json({ message: "Purchase not found." });
        res.json(result);
    } catch (error) {
        next(error);
    }
});

app.get("/", (_req, res) =>
    res.send("Hidden Pearl restaurant server is running."),
);
app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({
        message: "Something went wrong on the server.",
    });
});

// Local development: `node index.js`. On Vercel the app is exported instead.
if (require.main === module) {
    getCollections()
        .then(() =>
            app.listen(port, () =>
                console.log(`Hidden Pearl server listening on port ${port}`),
            ),
        )
        .catch((error) => {
            console.error("Unable to start server:", error);
            process.exit(1);
        });
    process.on("SIGINT", async () => {
        const { client } = await getCollections();
        await client.close();
        process.exit(0);
    });
}

module.exports = app;