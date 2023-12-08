const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_CLUSTER}/?retryWrites=true&w=majority`;

const app = express();

app.use(express.json())
app.use(cors())

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        const buildingManagementDB = client.db('buildingManagementDB');
        const apartmentsCollection = buildingManagementDB.collection('apartments');
        const usersCollection = buildingManagementDB.collection('users');
        const agreementsCollection = buildingManagementDB.collection('agreements');
        const announcementsCollection = buildingManagementDB.collection('announcements');
        const paymentsCollection = buildingManagementDB.collection('payments');

        // JWT APIs
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1hr' });
            res.send({ token });
        });

        // middleware for verifying jwt access token
        const verifyToken = (req, res, next) => {
            const authorization = req.headers.authorization;
            if(!authorization) {
                return res.status(401).send({ message: 'Unauthorized access' });
            }
            const token = authorization.split(' ').at(1);
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'Unauthorized access' });
                }
                req.decoded = decoded;
                next();
            });
        }
        // middleware for verifying admin role
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'Forbidden access' });
            }
            next();
        }
        // middleware for verifying member role
        const verifyMember = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const isMember = user?.role === 'member';
            if (!isMember) {
                return res.status(403).send({ message: 'Forbidden access' });
            }
            next();
        }

        // User APIs
        app.get('/users', verifyToken, verifyAdmin, async (req, res) => { // This needs verifyToken and verifyAdmin middleware
            const result = await usersCollection.find().toArray();
            res.send(result);
        });
        app.get('/users/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await agreementsCollection.findOne(query);
            res.send(user);
        })
        app.get('/users/admin/:email', verifyToken, async (req, res) => { // this checks admin role
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            let admin = false;
            if (user) {
                admin = user?.role === 'admin';
            }
            res.send({ admin });
        });
        app.get('/users/member/:email', verifyToken, async (req, res) => { // this checks the member role
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            let member = false;
            if (user) {
                member = user?.role === 'member';
            }
            res.send({ member });
        });
        app.post('/users', async (req, res) => { // This does not need any middleware 
            const user = req.body;
            const query = { email: user.email }
            const existingUser = await usersCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'user already exists', insertedId: null })
            }
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        // Apartments APIs
        app.get('/apartments', async (req, res) => {
            const result = await apartmentsCollection.find().toArray();
            res.send(result);
        });
        app.get('/apartments/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id)};
            const result = await apartmentsCollection.findOne(query);
            res.send(result);
        });
        // app.post('/apartments', async (req, res) => {
        //     const apartmentData = req.body;
        //     const result = await apartmentsCollection.insertOne(apartmentData);
        //     res.send(result);
        // });

        // Agreements APIs
        app.get('/agreements', verifyToken, verifyAdmin, async (req, res) => {
            const result = await agreementsCollection.find().toArray();
            res.send(result);
        });
        app.get('/agreements/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            const query = { email: email};
            const result = await agreementsCollection.findOne(query);
            res.send(result);
        });
        app.post('/agreements', async (req, res) => {
            const item = req.body;
            const result = await agreementsCollection.insertOne(item);
            res.send(result);
        });
        app.patch('/agreements-accept/:id/:email', verifyToken, verifyAdmin, async (req, res) => {
            const agreementId = req.params.id;
            const userEmail = req.params.email;
            const idFilter = { _id: new ObjectId(agreementId) };
            const emailFilter = { email: userEmail };
            const updatedStatus = {
                $set: {
                    status: 'checked'
                },
            };
            const updatedRole = {
                $set: {
                    role: 'member'
                },
            };
            const agreementResult = await agreementsCollection.updateOne(idFilter, updatedStatus);
            const userResult = await usersCollection.updateOne(emailFilter, updatedRole);
            res.send([agreementResult, userResult]);
        });
        app.patch('/agreements-reject/:id', verifyToken, verifyAdmin, async (req, res) => {
            const agreementId = req.params.id;
            const idFilter = { _id: new ObjectId(agreementId) };
            const updatedStatus = {
                $set: {
                    status: 'checked'
                },
            };
            const agreementResult = await agreementsCollection.updateOne(idFilter, updatedStatus);
            res.send(agreementResult);
        });
        app.patch('/member-remove/:id', verifyToken, verifyAdmin, async (req, res) => {
            const userId = req.params.id;
            const idFilter = { _id: new ObjectId(userId) };
            const updatedRole = {
                $set: {
                    role: 'user'
                },
            };
            const userResult = await usersCollection.updateOne(idFilter, updatedRole);
            res.send(userResult);
        });

        // Announcements APIs
        app.get('/announcements', verifyToken, async (req, res) => {
            const result = await announcementsCollection.find().toArray();
            res.send(result);
        });
        app.post('/announcements', verifyToken, verifyAdmin, async (req, res) => {
            const item = req.body;
            const result = await announcementsCollection.insertOne(item);
            res.send(result);
        });

        // payment intent
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
    
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
    
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        });

        // Payments APIs
        app.get('/payments/:email', verifyToken, verifyMember, async (req, res) => {
            const query = { email: req.params.email }
            if (req.params.email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            const result = await paymentsCollection.find(query).toArray();
            res.send(result);
        });
        app.post('/payments', verifyToken, verifyMember, async (req, res) => {
            const payment = req.body;
            const paymentResult = await paymentsCollection.insertOne(payment);
            console.log('payment info', payment);
            res.send(paymentResult);
        })

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send({ message: 'Server up and running!'});
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
})