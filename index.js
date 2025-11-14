const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ObjectId } = require('mongodb');
const PORT = process.env.PORT || 5000;
dotenv.config();
const app = express();

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gr8kgxz.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri);

async function run() {
    try {
        await client.connect();
        const db = client.db("ProShift");
        const parcelCollection = db.collection("parcels")
        // parcel data by email id 
        app.get("/parcels", async (req, res) => {
            try {
                const { email } = req.query;
                let query = {};
                // If user email is provided
                if (email) {
                    query.userEmail = email;
                }
                const parcels = await parcelCollection
                    .find(query)
                    .sort({ creation_date: -1 })
                    .toArray();
                res.send(parcels);
            } catch (error) {
                res.status(500).json({
                    message: "Failed to fetch parcels",
                    error,
                });
            }
        });
        // post parcel data 
        app.post("/parcels", async (req, res) => {
            try {
                const parcelData = req.body;
                const result = await parcelCollection.insertOne(parcelData);
                res.status(201).send(result)
            } catch (error) {
                console.error("Error saving parcel:", error);
                res.status(500).json({ message: "Failed to save parcel", error });
            }
        });
        // Delete parcel by ID
        app.delete("/parcels/:id", async (req, res) => {
            try {
                const { id } = req.params;
                const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });
                res.status(200).send(result)
            } catch (error) {
                console.error("Error deleting parcel:", error);
                res.status(500).json({ message: "Failed to delete parcel", error });
            }
        });

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {

    }
}
run().catch(console.dir);

app.get("/", (req, res) => {
    res.send("ProShift Parcel Delivery API is running 🚚");
});

// start server

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});

