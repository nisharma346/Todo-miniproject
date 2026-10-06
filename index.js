const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');


const app = express();
app.use(express.json()); // Server ko JSON data samajhne ke liye
const cors = require('cors');
app.use(cors()); // Is line ko app.use(express.json()) ke theek upar ya niche likh dein


// 1. MongoDB se Connect Karein (Database ka naam 'todoDB' rakha hai)
mongoose.connect('mongodb://localhost:27017/todoDB')
    .then(() => console.log("Todo Database se connection safal raha! 🚀"))
    .catch((err) => console.error("Database Connection Fail:", err));

// 2. Todo ka Schema (Blueprint) banayein
const todoSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // User ki ID store karega
    task: { type: String, required: true },
    isCompleted: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});


// 3. Schema se Model banayein
const Todo = mongoose.model('Todo', todoSchema);
// User ka Structure (Schema)
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const User = mongoose.model('User', userSchema);
// Middleware: Token check karne ke liye
const protect = async (req, res, next) => {
    let token;

    // Check karein ki headers mein token aaya hai ya nahi
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            // "Bearer <token>" mein se sirf token alag karein
            token = req.headers.authorization.split(' ')[1];

            // Token ko verify karein (Wahi SECRET_KEY use karein jo login mein dali thi)
            const decoded = jwt.verify(token, 'SECRET_KEY');

            // Logged-in user ki ID request object mein jodh dein
            req.user = decoded.userId;

            next(); // Agle step (Route) par jaane ki permission dein
        } catch (error) {
            res.status(401).json({ message: "Asafal Token, Permission nahi hai!" });
        }
    }

    if (!token) {
        res.status(401).json({ message: "Koi Token nahi mila, Authorization blocked!" });
    }
};



// --- ROUTES ---


/// A. POST: Naya Task daalna (Sirf logged-in user ke liye)
app.post('/api/todos', protect, async (req, res) => {
    try {
        const newTodo = new Todo({
            user: req.user, // Middleware se mili user ID
            task: req.body.task
        });
        const savedTodo = await newTodo.save();
        res.status(201).json(savedTodo);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// B. GET: Sirf usi User ke Tasks dikhana
app.get('/api/todos', protect, async (req, res) => {
    try {
        // user: req.user se sirf us bande ke todos milenge jisne login kiya hai
        const allTodos = await Todo.find({ user: req.user });
        res.status(200).json(allTodos);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});


// C. PUT: Task ko complete mark karna ya badalna (ID ke zariye)
app.put('/api/todos/:id', async (req, res) => {
    try {
        const updatedTodo = await Todo.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );
        res.status(200).json(updatedTodo);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// D. DELETE: Kisi task ko hatana (ID ke zariye)
app.delete('/api/todos/:id', async (req, res) => {
    try {
        await Todo.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Task delete ho gaya! 🗑️" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});
// 1. SIGNUP: Naya account banane ke liye
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Check karein ki user pehle se toh nahi hai
        const userExists = await User.findOne({ username });
        if (userExists) return res.status(400).json({ message: "Username pehle se liya ja chuka hai!" });

        // Password ko encrypt (hash) karein taaki database admin bhi na padh sake
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Naya user save karein
        const newUser = new User({ username, password: hashedPassword });
        await newUser.save();

        res.status(201).json({ message: "Signup safal raha! Ab aap login kar sakte hain. 🎉" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});
// 2. LOGIN: Account verify karke token dena
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // User ko dhoodhein
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ message: "Galat Username ya Password!" });

        // Password match karke check karein
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Galat Username ya Password!" });

        // JWT Token banayein (Yeh token user ki pehchan ban jayega)
        // 'SECRET_KEY' ki jagah aap kuch bhi secure text likh sakte hain
        const token = jwt.sign({ userId: user._id }, 'SECRET_KEY', { expiresIn: '1h' });

        res.status(200).json({ message: "Login safal raha! 👋", token });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Server Start Karein
app.listen(3000, () => {
    console.log("Todo Server port 3000 par ready hai...");
});
