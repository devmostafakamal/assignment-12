require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 3000;

const stripe = require("stripe")(process.env.PAYMENT_GATWAY_KEY);

// middleware

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());

const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // এটা লগ করবে

  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized: No token provided" });
  }

  const token = authHeader.split(" ")[1]; // Bearer <token>

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Forbidden: Invalid token" });
    }

    req.user = decoded; // decoded contains email/role/etc.
    next();
  });
};

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qxaidbq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const usersCollection = client.db("homeHunt").collection("users");
    const propertiesCollection = client.db("homeHunt").collection("properties");
    const wishlistCollection = client.db("homeHunt").collection("wishlist");
    const reviewsCollection = client.db("homeHunt").collection("reviews");
    const offersCollection = client.db("homeHunt").collection("offers");
    const paymentsCollection = client.db("homeHunt").collection("payments");

    // POST /jwt
    app.post("/jwt", async (req, res) => {
      const user = req.body; // { email }
      const token = jwt.sign(user, process.env.JWT_SECRET, {
        expiresIn: "24h",
      });
      res.send({ token });
    });

    app.post("/users", async (req, res) => {
      try {
        const { email, name, photoURL, uid, role = "user" } = req.body;

        if (!email || !uid) {
          return res
            .status(400)
            .json({ message: "Email and UID are required." });
        }

        const existingUser = await usersCollection.findOne({ email });

        if (existingUser) {
          return res
            .status(200)
            .json({ message: "User already exists", inserted: false });
        }

        const newUser = {
          email,
          name,
          photoURL,
          uid,
          role,
          createdAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);

        res.status(201).json({
          message: "User added successfully",
          inserted: true,
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Error creating user:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // post all properties

    app.post("/properties", async (req, res) => {
      try {
        const result = await propertiesCollection.insertOne({
          ...req.body,
          createdAt: new Date(),
          verificationStatus: "pending",
        });

        res.status(201).json({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.error("Error inserting property:", error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    app.post("/wishlist", verifyJWT, async (req, res) => {
      const wishlistData = req.body;
      const userEmail = req.user.email;

      const result = await wishlistCollection.insertOne(wishlistData);
      res.send(result);
    });

    app.get("/wishlist", async (req, res) => {
      const email = req.query.email;
      // console.log("first");
      // console.log("req.query.email:", req.query);

      if (!email || email !== req.query.email) {
        return res.status(403).send({ error: "Access denied" });
      }

      try {
        const result = await wishlistCollection
          .find({ userEmail: email })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Error fetching wishlist:", error);
        res.status(500).send({ error: "Failed to fetch wishlist" });
      }
    });
    // delete from wishlist
    app.delete("/wishlist/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid ID" });
        }

        const result = await wishlistCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Item not found" });
        }

        res.send(result);
      } catch (error) {
        console.error("Wishlist delete error:", error.message);
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // 📁 routes/paymentRoutes.js
    app.post("/create-payment-intent", async (req, res) => {
      const { amountInCents } = req.body;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/payments/:offerId", async (req, res) => {
      const offerId = req.params.offerId;
      try {
        const offer = await offersCollection.findOne({
          _id: new ObjectId(offerId),
        });

        if (!offer) return res.status(404).send({ message: "Offer not found" });

        res.send(offer);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });
    app.post("/payments", async (req, res) => {
      const {
        offerId,
        transactionId,
        amount,
        email,
        userName,
        status = "bought",
      } = req.body;

      try {
        // 1. Save payment record
        const paymentResult = await paymentsCollection.insertOne({
          offerId,
          transactionId,
          amount,
          email,
          userName,
          status,
          paidAt: new Date(),
        });

        // 2. Update offer status & transaction ID
        const offerUpdate = await offersCollection.updateOne(
          { _id: new ObjectId(offerId) },
          {
            $set: {
              status: "bought",
              transactionId: transactionId,
            },
          }
        );

        res.send({ paymentResult, offerUpdate });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });
    // sold property by email
    app.get("/sold-properties", async (req, res) => {
      const agentEmail = req.query.agentEmail?.toLowerCase();

      if (!agentEmail) {
        return res.status(400).send({ error: "agentEmail is required" });
      }

      try {
        const pipeline = [
          {
            $match: {
              agentEmail: agentEmail,
              status: "bought", // only sold offers
            },
          },
          {
            $lookup: {
              from: "properties", // join to get property info if needed (optional)
              localField: "propertyId",
              foreignField: "_id",
              as: "propertyInfo",
            },
          },
          {
            $unwind: {
              path: "$propertyInfo",
              preserveNullAndEmptyArrays: true, // optional
            },
          },
          {
            $project: {
              _id: 1,
              title: 1, // from offers
              location: 1, // from offers
              buyerEmail: 1,
              buyerName: 1,
              soldPrice: "$offerAmount",
              transactionId: 1,
              paidAt: "$createdAt",
            },
          },
        ];

        const result = await offersCollection.aggregate(pipeline).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching sold properties:", error);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    app.post("/reviews", async (req, res) => {
      const review = req.body;
      try {
        review.createdAt = new Date();
        const result = await reviewsCollection.insertOne(review);
        res.status(201).json({
          success: true,
          message: "Review submitted",
          insertedId: result.insertedId,
        });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    app.get("/reviews", async (req, res) => {
      const email = req.query.email;

      // if (!email || email !== req.user.email) {
      //   return res.status(403).send({ message: "Forbidden" });
      // }

      const result = await reviewsCollection
        .find({ reviewerEmail: email })
        .toArray();
      res.send(result);
    });

    app.delete("/reviews/:id", async (req, res) => {
      const id = req.params.id;
      const email = req.query.email;
      const review = await reviewsCollection.findOne({ _id: new ObjectId(id) });

      if (!review) {
        return res.status(404).send({ message: "Review not found" });
      }

      if (review.reviewerEmail !== req.query.email) {
        return res.status(403).send({ message: "Forbidden: Not your review" });
      }

      const result = await reviewsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // have to be later verifyJWT, verifyAdmin,
    app.get("/reviews/all", async (req, res) => {
      try {
        const reviews = await reviewsCollection.find().toArray();
        res.send(reviews);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch reviews", error });
      }
    });

    // get all offers from user

    app.get("/offers/agent", async (req, res) => {
      const email = req.query.email;
      const result = await offersCollection
        .find({ agentEmail: email })
        .toArray(); // if you stored agentEmail
      res.send(result);
    });

    app.patch("/offers/accept/:id", async (req, res) => {
      const offerId = req.params.id;
      const { propertyId } = req.body;

      const accepted = await offersCollection.updateOne(
        { _id: new ObjectId(offerId) },
        { $set: { status: "accepted" } }
      );

      const rejected = await offersCollection.updateMany(
        { propertyId, _id: { $ne: new ObjectId(offerId) } },
        { $set: { status: "rejected" } }
      );

      res.send({ accepted, rejected });
    });

    app.patch("/offers/reject/:id", async (req, res) => {
      const offerId = req.params.id;
      const result = await offersCollection.updateOne(
        { _id: new ObjectId(offerId) },
        { $set: { status: "rejected" } }
      );
      res.send(result);
    });
    app.patch("/offers/:id/accept", async (req, res) => {
      const offerId = req.params.id;

      try {
        // 1️⃣ First, accept the selected offer
        const acceptedOffer = await offersCollection.findOneAndUpdate(
          { _id: new ObjectId(offerId) },
          { $set: { status: "accepted" } },
          { returnDocument: "after" }
        );

        if (!acceptedOffer.value) {
          return res.status(404).send({ message: "Offer not found" });
        }

        const propertyId = acceptedOffer.value.propertyId;

        // 2️⃣ Reject all other offers for the same property
        const rejectResult = await offersCollection.updateMany(
          {
            propertyId: propertyId,
            _id: { $ne: new ObjectId(offerId) }, // ✅ Don't reject the accepted one
          },
          { $set: { status: "rejected" } }
        );

        res.send({
          message: "Offer accepted and other offers rejected.",
          acceptedOffer: acceptedOffer.value,
          rejectedCount: rejectResult.modifiedCount,
        });
      } catch (error) {
        console.error("Error accepting offer:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // post offers

    // app.post("/offers", async (req, res) => {
    //   try {
    //     const {
    //       propertyId,
    //       title,
    //       location,
    //       agentName,
    //       offerAmount,
    //       buyerEmail,
    //       buyerName,
    //       buyingDate,
    //     } = req.body;

    //     // if (req.user.email !== buyerEmail) {
    //     //   return res.status(403).send({ message: "Unauthorized request" });
    //     // }

    //     // Fetch property to get actual price range
    //     const property = await propertiesCollection.findOne({
    //       _id: new ObjectId(propertyId),
    //     });

    //     if (!property) {
    //       return res.status(404).send({ message: "Property not found" });
    //     }

    //     // Parse min and max price from priceRange string (e.g., "$40000 - $230000")
    //     const [minPrice, maxPrice] = property.priceRange
    //       .split("-")
    //       .map((p) => parseFloat(p.replace(/[^\d.]/g, "")));

    //     if (
    //       isNaN(offerAmount) ||
    //       offerAmount < minPrice ||
    //       offerAmount > maxPrice
    //     ) {
    //       return res.status(400).send({
    //         message: `Offer amount must be between $${minPrice} and $${maxPrice}`,
    //       });
    //     }

    //     // Build offer object
    //     const offerData = {
    //       propertyId,
    //       title,
    //       location,
    //       agentName,
    //       offerAmount,
    //       buyerEmail,
    //       buyerName,
    //       buyingDate,
    //       status: "pending",
    //     };
    //     console.log(buyerEmail);
    //     const result = await offersCollection.insertOne(offerData);
    //     res.send({ insertedId: result.insertedId, message: "Offer submitted" });
    //   } catch (error) {
    //     console.error("Offer creation error:", error);
    //     res.status(500).send({ message: "Internal server error" });
    //   }
    // });
    // app.post("/offers", async (req, res) => {
    //   try {
    //     const offer = req.body;
    //     const result = await offersCollection.insertOne(offer);
    //     res.send({ insertedId: result.insertedId });
    //   } catch (err) {
    //     res.status(500).send({ message: "Server error", error: err.message });
    //   }
    // });
    app.post("/offers", async (req, res) => {
      try {
        const {
          propertyId,
          title,
          location,
          agentName,
          image,
          offerAmount,
          buyerEmail,
          buyerName,
          agentEmail,
          buyingDate,
          status, // usually "pending"
        } = req.body;

        // Simple validation
        if (
          !propertyId ||
          !title ||
          !location ||
          !agentName ||
          !offerAmount ||
          !buyerEmail ||
          !buyerName ||
          !buyingDate
        ) {
          return res.status(400).send({ message: "Missing required fields" });
        }

        // Create offer object
        const newOffer = {
          propertyId,
          title,
          location,
          agentName,
          image,
          offerAmount,
          buyerEmail,
          buyerName,
          agentEmail,
          buyingDate,
          status: status || "pending", // default to "pending" if not provided
          createdAt: new Date(),
        };

        const result = await offersCollection.insertOne(newOffer);
        res.send({ insertedId: result.insertedId });
      } catch (error) {
        console.error("Offer insert error:", error.message);
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });
    app.get("/offers", async (req, res) => {
      try {
        const buyerEmail = req.query.buyerEmail;
        if (!buyerEmail) {
          return res.status(400).send({ message: "buyerEmail is required" });
        }
        // verifyJWT middleware দিয়ে req.user থাকে, তার email এর সাথে মিল আছে কিনা চেক করো
        // if (buyerEmail !== req.user.email) {
        //   return res.status(403).send({ message: "Forbidden access" });
        // }
        const offers = await offersCollection.find({ buyerEmail }).toArray();
        res.send(offers);
      } catch (error) {
        console.error("Get offers error:", error);
        res.status(500).send({ message: "Failed to get offers" });
      }
    });

    // GET /api/properties
    app.get("/properties", async (req, res) => {
      try {
        const properties = await propertiesCollection.find().toArray();
        res.status(200).json({ success: true, data: properties });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
    // get all verified property
    app.get("/properties/verified", async (req, res) => {
      try {
        const verifiedProperties = await propertiesCollection
          .find({
            verificationStatus: "verified",
          })
          .toArray();

        res.send(verifiedProperties);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // GET properties/agent?email=agent@example.com
    app.get("/properties/agent", async (req, res) => {
      const { email } = req.query;
      try {
        const properties = await propertiesCollection
          .find({ agentEmail: email })
          .toArray();
        res.json({ success: true, data: properties });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Update verification status
    app.patch("/properties/verify/:id", async (req, res) => {
      const { id } = req.params;
      const { status } = req.body; // status = "verified" or "rejected"

      if (!["verified", "rejected"].includes(status)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid status" });
      }

      try {
        const result = await propertiesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { verificationStatus: status } }
        );

        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .json({ success: false, message: "Property not found" });
        }

        res.json({ success: true, message: `Property marked as ${status}` });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
    // GET a single property by ID
    app.get("/properties/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const property = await propertiesCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!property) {
          return res
            .status(404)
            .json({ success: false, message: "Property not found" });
        }

        res.json(property);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // get reviews

    app.get("/reviews/:propertyId", async (req, res) => {
      const { propertyId } = req.params;
      try {
        const reviews = await reviewsCollection
          .find({ propertyId })
          .sort({ date: -1 })
          .toArray();
        res.json(reviews);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // PUT /api/properties/:id
    app.put("/properties/:id", async (req, res) => {
      const { id } = req.params;
      const updateData = req.body;
      try {
        const property = await propertiesCollection.findOne({
          _id: new ObjectId(id),
        });

        if (property.verificationStatus === "rejected") {
          return res.status(403).json({
            success: false,
            message: "Cannot update rejected property",
          });
        }

        await propertiesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        res.json({ success: true, message: "Property updated" });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // DELETE /properties/:id
    app.delete("/properties/:id", async (req, res) => {
      const { id } = req.params;

      try {
        const result = await propertiesCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Rider not found" });
        }

        res.send({ message: "property deleted successfully" });
      } catch (error) {
        res.status(500).send({ message: "Server error", error });
      }
    });

    //  Get all users
    app.get("/users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });
    //Update role to admin
    app.patch("/users/make-admin/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.updateOne(
        { email },
        { $set: { role: "admin" } }
      );
      res.send(result);
    });

    // Update role to agent
    app.patch("/users/make-agent/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.updateOne(
        { email },
        { $set: { role: "agent" } }
      );
      res.send(result);
    });

    // Mark as fraud (only if role === agent)
    app.patch("/users/mark-fraud/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.updateOne(
        { email, role: "agent" },
        { $set: { role: "fraud" } }
      );
      res.send(result);
    });

    //  Delete user
    app.delete("/users/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.deleteOne({ email });
      res.send(result);
    });
    // GET /users/role/:email
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send({ role: user?.role || "user" }); // fallback = user
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// Root route
app.get("/", (req, res) => {
  res.send("Hello from zap-shift-server!");
});

// Start server
app.listen(port, () => {
  console.log(`Server running at port :${port}`);
});
