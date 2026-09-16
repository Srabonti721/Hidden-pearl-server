const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const  admin = require("firebase-admin");
const serviceAccount = require("./firebase-admin-service-api-key.json");
const app = express();
const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());


admin.initializeApp({
  credential: admin.cert(serviceAccount)
});


const uri =
    process.env.MONGODB_URI ||
    `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.efzq5bn.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

const isValidId = (id) => ObjectId.isValid(id);
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

async function startServer() {
    try {
        await client.connect();
        await client.db("admin").command({ ping: 1 });
        const foods = client.db("HiddenPearlDB").collection("foods");
        const purchases = client.db("HiddenPearlDB").collection("purchases");
        console.log("Connected to MongoDB.");

        // All-food / menu / my-food sections. Query: category, email, search, page, limit.
        app.get("/foods", async (req, res, next) => {
            try {
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
                    return res
                        .status(400)
                        .json({ message: "Invalid food id." });
                const food = await foods.findOne({
                    _id: new ObjectId(req.params.id),
                });
                if (!food)
                    return res.status(404).json({ message: "Food not found." });
                res.json(food);
            } catch (error) {
                next(error);
            }
        });

        app.post("/foods", async (req, res, next) => {
            try {
                const food = foodPayload(req.body);
                if (!food.name && !food.foodName)
                    return res
                        .status(400)
                        .json({ message: "Food name is required." });
                const result = await foods.insertOne(food);
                res.status(201).json({
                    acknowledged: result.acknowledged,
                    insertedId: result.insertedId,
                });
            } catch (error) {
                next(error);
            }
        });

        app.patch("/foods/:id", async (req, res, next) => {
            try {
                if (!isValidId(req.params.id))
                    return res
                        .status(400)
                        .json({ message: "Invalid food id." });
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
                if (!result.matchedCount)
                    return res.status(404).json({ message: "Food not found." });
                res.json(result);
            } catch (error) {
                next(error);
            }
        });

        app.delete("/foods/:id", async (req, res, next) => {
            try {
                if (!isValidId(req.params.id))
                    return res
                        .status(400)
                        .json({ message: "Invalid food id." });
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

        app.get("/purchases", async (req, res, next) => {
            try {
                const query = req.query.email
                    ? { buyerEmail: req.query.email }
                    : {};
                res.json(
                    await purchases
                        .find(query, { sort: { buyingDate: -1, _id: -1 } })
                        .toArray(),
                );
            } catch (error) {
                next(error);
            }
        });

        app.post("/purchases", async (req, res, next) => {
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

                const food = await foods.findOne({ _id: new ObjectId(foodId) });
                if (!food)
                    return res.status(404).json({ message: "Food not found." });
                const ownerEmail =
                    (typeof food.addedBy === "object"
                        ? food.addedBy?.email
                        : food.addedBy) ||
                    food.userEmail ||
                    food.email;
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

        app.delete("/purchases/:id", async (req, res, next) => {
            try {
                if (!isValidId(req.params.id))
                    return res
                        .status(400)
                        .json({ message: "Invalid purchase id." });
                const result = await purchases.deleteOne({
                    _id: new ObjectId(req.params.id),
                });
                if (!result.deletedCount)
                    return res
                        .status(404)
                        .json({ message: "Purchase not found." });
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
        app.listen(port, () =>
            console.log(`Hidden Pearl server listening on port ${port}`),
        );
    } catch (error) {
        console.error("Unable to start server:", error);
        process.exit(1);
    }
}

startServer();
process.on("SIGINT", async () => {
    await client.close();
    process.exit(0);
});
