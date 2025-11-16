const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();
const { MongoClient, ObjectId } = require('mongodb');
const PORT = process.env.PORT || 5000;
const app = express();

const stripe = require('stripe')(process.env.PAYMENT_KEY);
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
        const paymentCollection = client.db("ProShift").collection("payments");
        const usersCollection = client.db("ProShift").collection("users");

        // user data 
        app.post("/users", async (req, res) => {
            try {
                const { name, email, photoURL, role, created_at, last_login } = req.body;

                // Check if user exists
                const existingUser = await usersCollection.findOne({ email });

                if (existingUser) {
                    // old user
                    return res.send({
                        status: "old_user",
                        user: existingUser,
                    });
                }
                //  If not exist, insert new user
                const newUser = {
                    name: name || "",
                    email,
                    photoURL: photoURL || "",
                    role: role || "user",
                    created_at: created_at || new Date().toISOString(),
                    last_login: last_login || new Date().toISOString(),
                };

                const result = await usersCollection.insertOne(newUser);
                res.send(result);

            } catch (error) {
                console.log(error);
                res.status(500).send({ message: "Server error" });
            }
        });

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
        // parcel data by id
        app.get("/parcels/:id", async (req, res) => {
            try {
                const { id } = req.params;
                const query = { _id: new ObjectId(id) }
                const parcel = await parcelCollection.findOne(query);

                if (!parcel) {
                    return res.status(404).json({ message: "Parcel not found" });
                }

                res.status(200).send(parcel);
            } catch (error) {
                console.error("Error fetching parcel:", error);
                res.status(500).json({ message: "Failed to get parcel", error: error.message });
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

        app.post("/create-payment-intent", async (req, res) => {
            try {
                const { amount, parcelId } = req.body;

                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amount * 100, // Stripe needs amount in cents
                    currency: "usd",
                    metadata: { parcelId },
                    payment_method_types: ["card"]
                });

                res.send({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).json({ message: "Stripe Error", error });
            }
        });

        // POST /payments - save payment and update parcel status
        app.post("/payments", async (req, res) => {
            try {
                const { parcelId, amount, paymentId, userEmail, transactionId, payment_method } = req.body;
                // Update parcel payment_status
                const parcelResult = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            payment_status: "paid"
                        }
                    }
                );
                // Save payment history
                const paymentData = {
                    parcelId,
                    amount,
                    paymentId,   // Stripe paymentIntent id
                    userEmail,
                    transactionId,
                    payment_method,
                    paid_at_string: new Date().toISOString(),
                    payment_date: new Date()
                };
                const paymentResult = await paymentCollection.insertOne(paymentData);

                res.status(200).send({
                    message: "Payment saved and parcel updated",
                    parcelResult,
                    paymentResult
                });

            } catch (error) {
                console.error("Error saving payment:", error);
                res.status(500).json({ message: "Failed to save payment", error });
            }
        });

        // GET /payments - all or user-specific payments
        app.get("/payments", async (req, res) => {
            try {
                const email = req.query.email;
                //  query
                const query = email ? { userEmail: email } : {};

                const payments = await paymentCollection
                    .find(query)
                    .sort({ payment_date: -1 }) // latest first
                    .toArray();

                res.status(200).send(payments);

            } catch (error) {
                console.error("Error fetching payments:", error);
                res.status(500).json({ message: "Failed to fetch payments", error });
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

