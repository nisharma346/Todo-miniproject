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
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    task: { type: String, required: true },
    isCompleted: { type: Boolean, default: false },
    // Nayi field: Jo sirf user ke diye gaye options hi accept karegi
    category: {
        type: String,
        enum: ['Personal', 'Work', 'Shopping', 'Others'],
        default: 'Personal'
    },
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
// 3.5 Profile ka Schema (User ki extra details ke liye)
const profileSchema = new mongoose.Schema({
    // Yeh line Profile ko User ke saath link karegi (Foreign Key ki tarah)
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    bio: { type: String, default: "Hey there! I am using Secure Todo App." },
    city: { type: String, default: "Not Specified" },
    phoneNumber: String
});

const Profile = mongoose.model('Profile', profileSchema);




// --- ROUTES ---


/// A. POST: Naya Task daalna (Sirf logged-in user ke liye)
// POST: Naya Task Category ke saath daalna
app.post('/api/todos', protect, async (req, res) => {
    try {
        const newTodo = new Todo({
            user: req.user,
            task: req.body.task,
            category: req.body.category // Frontend se category accept karein
        });
        const savedTodo = await newTodo.save();
        res.status(201).json(savedTodo);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});


// B. GET: Sirf usi User ke Tasks dikhana
// GET: Logged-in user ke todos dekhna (Category filter ke sath)
app.get('/api/todos', protect, async (req, res) => {
    try {
        // Ek khali object banayein query ke liye
        let query = { user: req.user };

        // Agar URL mein query aayi hai (jaise: ?category=Work) toh use jodein
        if (req.query.category) {
            query.category = req.query.category;
        }

        const allTodos = await Todo.find(query);
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
// GET STATS: User ke todos ka poora report/statistics nikalna
app.get('/api/todos/stats', protect, async (req, res) => {
    try {
        const stats = await Todo.aggregate([
            // Stage 1: Sirf usi logged-in user ke todos ko filter karein
            { $match: { user: new mongoose.Types.ObjectId(req.user) } },

            // Stage 2: Data ko category ke hisab se group karein aur count nikalyein
            {
                $group: {
                    _id: "$category", // Category ke aadhar par group banayein
                    totalTasks: { $sum: 1 }, // Har task ke liye +1 karein
                    completedTasks: {
                        $sum: { $cond: [{ $eq: ["$isCompleted", true] }, 1, 0] } // Agar completed true hai toh hi +1 karein
                    }
                }
            }
        ]);

        res.status(200).json(stats);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET PROFILE: Logged-in user ki profile aur user data jodh kar dekhna
app.get('/api/profile', protect, async (req, res) => {
    try {
        // .populate('user') karne se user ka data link ho jayega
        // '-password' likhne se security ke liye password response mein nahi aayega
        const userProfile = await Profile.findOne({ user: req.user }).populate('user', '-password');

        if (!userProfile) return res.status(404).json({ message: "Profile nahi mili!" });

        res.status(200).json(userProfile);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});
// PUT PROFILE: Logged-in user ki profile details update karne ke liye
app.put('/api/profile', protect, async (req, res) => {
    try {
        const { bio, city, phoneNumber } = req.body;

        // User ki ID ke basis par uski profile dhoodhein aur update karein
        const updatedProfile = await Profile.findOneAndUpdate(
            { user: req.user },
            { bio, city, phoneNumber },
            { new: true } // Taaki response mein naya/updated data dikhe
        ).populate('user', '-password'); // Saath mein user data bhi link rakhein

        if (!updatedProfile) {
            return res.status(404).json({ message: "Profile nahi mili!" });
        }

        res.status(200).json(updatedProfile);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// SIGNUP: Updated version with Profile creation
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { username, password } = req.body;

        const userExists = await User.findOne({ username });
        if (userExists) return res.status(400).json({ message: "Username pehle se liya ja chuka hai!" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 1. User save karein
        const newUser = new User({ username, password: hashedPassword });
        const savedUser = await newUser.save();

        // 2. Naye User ke liye automatic Profile banayein aur link karein
        const newProfile = new Profile({
            user: savedUser._id // User ki unique ID yahan store hogi
        });
        await newProfile.save();

        res.status(201).json({ message: "Signup safal raha aur Profile bhi ban gayi! 🎉" });
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
