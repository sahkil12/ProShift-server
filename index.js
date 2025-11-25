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
        const parcelsCollection = db.collection("parcels")
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
        // admin verify 
        const verifyAdmin = async (req, res, next) => {
            const userEmail = req.decoded.email
            const user = await usersCollection.findOne({
                email: userEmail
            })
            // admin check 
            if (!user || user.role !== "admin") {
                return res.status(403).send({
                    message: "Access denied (Admin only)"
                })
            }
            next()
        }
        // rider verify 
        const verifyRider = async (req, res, next) => {
            const userEmail = req.decoded.email
            const user = await usersCollection.findOne({
                email: userEmail
            })
            // rider check 
            if (!user || user.role !== "rider") {
                return res.status(403).send({
                    message: "Access denied (Rider only)"
                })
            }
            next()
        }
        // search user by admin
        app.get("/admin/users/search", verifyFbToken, verifyAdmin, async (req, res) => {
            const emailQuery = req.query.email;

            if (!emailQuery) {
                return res.status(400).send({ message: "Please provide search text" });
            }
            // Case insensitive partial match
            const users = await usersCollection.find({
                email: { $regex: emailQuery, $options: "i" }
            }).project({ password: 0 }).limit(15).toArray();

            res.send(users);
        });
        // make admin
        app.patch("/admin/make-admin/:email", verifyFbToken, verifyAdmin, async (req, res) => {
            const targetEmail = req.params.email;

            const user = await usersCollection.findOne({
                email: targetEmail
            });
            if (!user) return res.status(404).send({ message: "User not found" });

            const result = await usersCollection.updateOne({
                email: targetEmail
            },
                {
                    $set: {
                        role: "admin"
                    }
                });

            res.send({
                message: "User is now admin",
                result
            });
        });
        // remove admin
        app.patch("/admin/remove-admin/:email", verifyFbToken, verifyAdmin, async (req, res) => {
            const targetEmail = req.params.email;

            const user = await usersCollection.findOne({
                email: targetEmail
            });
            // user check
            if (!user) return res.status(404).send({ message: "User not found" });

            const result = await usersCollection.updateOne({
                email: targetEmail
            },
                {
                    $set: {
                        role: "user"
                    }
                });

            res.send({
                message: "Admin removed",
                result
            });
        });
        // Find user role by email
        app.get("/users/role/:email", verifyFbToken, async (req, res) => {
            try {
                const email = req.params.email;
                // email check 
                if (!email) {
                    return res.status(400).send({ message: "Email is required" });
                }
                // find user by email
                const user = await usersCollection.findOne(
                    { email: email }
                );
                // user check
                if (!user) {
                    return res.status(404).send({ message: "User not found" });
                }
                res.send({
                    email: email,
                    role: user.role || "user"
                });

            } catch (error) {
                res.status(500).send({
                    message: "Failed to fetch user role",
                    error: error.message
                });
            }
        });
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
                const { email, payment_status, delivery_status } = req.query;
                const decodedEmail = req.decoded.email;

                if (email && decodedEmail !== email) {
                    res.status(403).send({ message: "forbidden access" })
                }
                let query = {};
                // If user email is provided
                if (email) {
                    query.userEmail = email;
                }
                if (payment_status) {
                    query.payment_status = payment_status
                }
                if (delivery_status) {
                    query.delivery_status = delivery_status
                }

                const parcels = await parcelsCollection
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
        // cash out parcel 
        app.patch("/parcels/cashout/:id", verifyFbToken, verifyRider, async (req, res) => {
            const id = req.params.id

            const parcel = await parcelsCollection.findOne({ _id: new ObjectId(id) });

            if (parcel.cashout_status === "pending" || parcel.cashout_status === "cashed_out") {
                return res.status(400).send({ message: "Cashout already requested or completed" });
            }

            const result = await parcelsCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        cashout_status: "pending",
                    }
                }
            )
            res.send({
                message: "Cashout request submitted",
                result
            })
        })
        // 
        app.patch("/parcels/assign-rider/:id", verifyFbToken, async (req, res) => {
            try {
                const parcelId = req.params.id;
                const { riderId, riderEmail } = req.body;
                if (!riderId) {
                    return res.status(400).send({ message: "Rider ID is required" });
                }
                const rider = await ridersCollection.findOne({ _id: new ObjectId(riderId) });
                // check rider 
                if (!rider) return res.status(404).send({ message: "Rider not found" })

                if (rider.work_status === "in-transit") {
                    return res.status(400).send({ message: "Rider is already assigned to another parcel" });
                }

                const updateDoc = {
                    $set: {
                        assignedRider: riderId,
                        assignedEmail: riderEmail,
                        delivery_status: "rider-assigned",
                        assignedAt: new Date()
                    }
                };
                const parcelResult = await parcelsCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    updateDoc
                );
                // update rider
                const riderUpdate = {
                    $set: {
                        work_status: "assigned",
                        assignedParcelId: parcelId
                    }
                }
                const riderResult = await ridersCollection.updateOne(
                    { _id: new ObjectId(riderId) },
                    riderUpdate
                )
                res.send({
                    message: "Rider assigned successfully",
                    parcelUpdate: parcelResult,
                    riderUpdate: riderResult
                });

            } catch (error) {
                console.error("Error assigning rider:", error);
                res.status(500).json({ message: "Failed to assign rider", error });
            }
        });
        // parcel data by id
        app.get("/parcels/:id", async (req, res) => {
            try {
                const { id } = req.params;
                const query = { _id: new ObjectId(id) }
                const parcel = await parcelsCollection.findOne(query);

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
                const result = await parcelsCollection.insertOne(parcelData);
                res.status(201).send(result)
            } catch (error) {
                console.error("Error saving parcel:", error);
                res.status(500).json({ message: "Failed to save parcel", error });
            }
        });
        // parcel mark picked up api
        app.patch("/parcels/mark-picked/:id", verifyFbToken, verifyRider, async (req, res) => {
            try {
                const parcelId = req.params.id;

                const updateDoc = {
                    $set: {
                        delivery_status: "in-transit",
                        picked_at: new Date()
                    }
                };

                const result = await parcelsCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    updateDoc
                );

                res.send({
                    message: "Parcel marked as picked up",
                    result
                });
            } catch (error) {
                res.status(500).send({ message: "Failed to update", error });
            }
        });
        // parcel mark delivered api
        app.patch("/parcels/mark-delivered/:id", verifyFbToken, verifyRider, async (req, res) => {
            try {
                const parcelId = req.params.id;

                const parcel = await parcelsCollection.findOne({ _id: new ObjectId(parcelId) })


                const updateDoc = {
                    $set: {
                        delivery_status: "delivered",
                        delivered_at: new Date()
                    }
                };

                const result = await parcelsCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    updateDoc
                );

                const riderUpdate = await parcelsCollection.updateOne(
                    { email: parcel.assignedEmail },
                    {
                        $set: {
                            work_status: "available"
                        }
                    }
                )

                res.send({
                    message: "Parcel delivered successfully",
                    result,
                    riderUpdate,
                });
            } catch (error) {
                res.status(500).send({ message: "Failed to update", error });
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
                const parcelResult = await parcelsCollection.updateOne(
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
                const result = await parcelsCollection.deleteOne({ _id: new ObjectId(id) });
                res.status(200).send(result)
            } catch (error) {
                console.error("Error deleting parcel:", error);
                res.status(500).json({ message: "Failed to delete parcel", error });
            }
        });
        // get rider data 
        app.get("/riders", verifyFbToken, async (req, res) => {
            try {
                const { region } = req.query;

                let query = { status: "Active" };
                if (region) {
                    query.region = { $regex: `^${region}$`, $options: "i" };
                }

                const riders = await ridersCollection.find(query).toArray();
                res.send(riders);

            } catch (error) {
                console.error("Error loading riders:", error);
                res.status(500).json({ message: "Failed to load riders", error });
            }
        });
        // get completed delivery
        app.get("/rider/completed-deliveries", verifyFbToken, verifyRider, async (req, res) => {
            const riderEmail = req.decoded.email;
            // 
            const parcels = await parcelsCollection.find({
                assignedEmail: riderEmail,
                delivery_status: "delivered"
            })
                .sort({ delivered_at: -1 })
                .toArray();

            res.send(parcels);
        });
        // get pending delivery
        app.get("/rider/pending-deliveries", verifyFbToken, verifyRider, async (req, res) => {
            try {
                const riderEmail = req.decoded.email;
                // rider email check
                if (!riderEmail) {
                    return res.status(400).send({ message: "Invalid rider email" });
                }

                const query = {
                    assignedEmail: riderEmail,
                    delivery_status: { $in: ["rider-assigned", "in-transit"] }
                };

                const pendingParcels = await parcelsCollection.find(query).toArray();

                res.send(pendingParcels);

            } catch (error) {
                console.error("Error fetching rider pending deliveries:", error);
                res.status(500).send({ message: "Failed to load pending deliveries", error });
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

                const result = await ridersCollection.insertOne({
                    ...riderData,
                    status: "Pending",
                    created_at: new Date()
                })
                res.status(201).send(result)
            }
            catch (error) {
                res.status(500).json({ message: "Failed to save parcel", error });
            }
        })
        // find rider based on status pending 
        app.get("/riders/pending", verifyFbToken, verifyAdmin, async (req, res) => {
            try {
                const pendingRiders = await ridersCollection.find({ status: "Pending" }).toArray();
                res.send(pendingRiders);
            } catch (error) {
                res.status(500).send({ message: "Failed to load pending riders", error });
            }
        });
        // active rider
        app.get("/riders/active", verifyFbToken, verifyAdmin, async (req, res) => {
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
                userRoleUpdate: userRoleResult
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