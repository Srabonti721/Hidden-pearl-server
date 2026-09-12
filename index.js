const express = require('express');
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config()
const app = express()
const port = process.env.PORT || 3000;

// middlewire
app.use(cors())
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.efzq5bn.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
    // Connect the client to the server	(optional starting in v4.7)
client.connect().catch(console.dir);
const foodsCollection = client.db("HiddenPrealDB").collection("foods")




    // Send a ping to confirm a successful connection
     client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");


app.get('/', (req, res) => {
  res.send('hidden pearl resturent')
})

app.listen(port, () => {
  console.log(`Hidden peral app listening on port ${port}`)
})