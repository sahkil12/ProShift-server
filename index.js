const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();
const { MongoClient, ObjectId } = require('mongodb');
const PORT = process.env.PORT || 5000;
const app = express();
const admin = require("firebase-admin");

const stripe = require('stripe')(process.env.PAYMENT_KEY);
// middleware
app.use(cors());
app.use(express.json());
// firebase admin 
const serviceAccount = require("./proshift-firebase-admin-key.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
// mongodb uri
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gr8kgxz.mongodb.net/?appName=Cluster0`;
// mongodb client
const client = new MongoClient(uri);

async function run() {
    try {
        await client.connect();
        const db = client.db("ProShift");
        const parcelCollection = db.collection("parcels")
        const paymentCollection = db.collection("payments");
        const usersCollection = db.collection("users");
        const ridersCollection = db.collection("riders")

        // custom verify token 
        const verifyFbToken = async (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).send({ message: "unauthorized access" });
            }
            const token = authHeader.split(" ")[1]
            if (!token) {
                return res.status(401).send({ message: "unauthorized access" });
            }
            // verify the token 
            try {
                const decoded = await admin.auth().verifyIdToken(token)
                req.decoded = decoded
                next()
            }
            catch (error) {
                return res.status(403).send({ message: "forbidden access" });
            }
        }
        // user data 
        app.post("/users", async (req, res) => {
            try {
                const { name, email, photoURL, role, created_at, last_login } = req.body;
                const now = new Date().toISOString();

                // Check if user exists
                const existingUser = await usersCollection.findOne({ email });

                if (existingUser) {
                    // update user last login
                    const result = await usersCollection.updateOne(
                        { email },
                        {
                            $set: {
                                last_login: now
                            }
                        }
                    )
                    return res.send({
                        status: "old_user",
                        inserted: false,
                        last_login: now
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
                res.status(500).send({ message: "Server error" });
            }
        });
        // parcel data by email id 
        app.get("/parcels", verifyFbToken, async (req, res) => {
            try {
                const { email } = req.query;
                const decodedEmail = req.decoded.email;
                if (decodedEmail !== email) {
                    res.status(403).send({ message: "forbidden access" })
                }
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
        // payment intent 
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
        // save payment and update parcel status
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
        // all or user-specific payments
        app.get("/payments", verifyFbToken, async (req, res) => {
            try {
                const email = req.query.email;
                const decodedEmail = req.decoded.email;
                if (decodedEmail !== email) {
                    res.status(403).send({ message: "forbidden access" })
                }
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
        // riders data post
        app.post('/riders', async (req, res) => {
            try {
                const riderData = req.body
                const userEmail = riderData.email;
                // check duplicate application 
                const existingRider = await ridersCollection.findOne({
                    email: userEmail,
                    status: {
                        $in: ["Pending", "Active"]
                    }
                })

                if (existingRider) {
                    return res.status(400).send({
                        message: "You already have a rider application in progress or active."
                    })
                }
                // find rejected rider
                const rejectedRider = await ridersCollection.findOne({
                    email: userEmail,
                    status: "Rejected"
                })
                // 
                if (rejectedRider) {
                    const updatedDoc = {
                        $set: {
                            ...riderData,
                            status: "Pending"
                        }
                    }
                    const result = await ridersCollection.updateOne(
                        { email: userEmail },
                        updatedDoc
                    )
                    return res.status(200).send(result)
                }

                const result = await ridersCollection.insertOne(riderData)
                res.status(201).send(result)
            }
            catch (error) {
                res.status(500).json({ message: "Failed to save parcel", error });
            }
        })
        // find rider based on status pending 
        app.get("/riders/pending", async (req, res) => {
            try {
                const pendingRiders = await ridersCollection.find({ status: "Pending" }).toArray();
                res.send(pendingRiders);
            } catch (error) {
                res.status(500).send({ message: "Failed to load pending riders", error });
            }
        });
        // active rider
        app.get("/riders/active", async (req, res) => {
            const search = req.query.search || "";

            const filter = {
                status: "Active",
                $or: [
                    { name: { $regex: search, $options: "i" } },
                    { district: { $regex: search, $options: "i" } }
                ]
            };

            const riders = await ridersCollection.find(filter).toArray();
            res.send(riders);
        });
        // deactivate rider
        app.patch("/riders/deactivate/:id", async (req, res) => {
            const id = req.params.id;
            const result = await ridersCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set:
                    {
                        status: "Inactive"
                    }
                }
            );
            res.send(result);
        });

        // approve rider
        app.patch("/riders/approve/:id", async (req, res) => {
            const id = req.params.id;
            const filterID = { _id: new ObjectId(id) }
            // check rider 
            const rider = await ridersCollection.findOne(filterID)
            if (!rider) return res.status(404).send({ message: "Rider Not Found" })
            // update rider status active 
            const result = await ridersCollection.updateOne(
                filterID,
                {
                    $set: {
                        status: "Active"
                    }
                }
            );

            // update rider role 
            const userRoleResult = await usersCollection.updateOne(
                { email: rider.email },
                {
                    $set: {
                        role: "rider"
                    }
                }
            )
            res.send({
                message: "Rider approved and user role updated",
                riderUpdate: result,
            });
        });
        // reject rider 
        app.patch("/riders/reject/:id", async (req, res) => {
            const id = req.params.id;
            const result = await ridersCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        status: "Rejected"
                    }
                }
            );
            res.send(result);
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