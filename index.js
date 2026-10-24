require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || Buffer.byteLength(JWT_SECRET, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be configured with a random value of at least 32 bytes.');
}


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
    priority: {
        type: String,
        enum: ['High', 'Medium', 'Low'],
        default: 'Medium'
    },
    dueDate: { type: Date },          // Optional due date
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
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        try {
            // "Bearer <token>" mein se sirf token alag karein
            const tokenParts = req.headers.authorization.split(' ');
            token = tokenParts[1];
            if (!token || tokenParts.length !== 2) {
                return res.status(401).json({ message: "Koi Token nahi mila, Authorization blocked!" });
            }

            // Token ko verify karein (Wahi SECRET_KEY use karein jo login mein dali thi)
            const decoded = jwt.verify(token, JWT_SECRET);
            if (!decoded || typeof decoded !== 'object' || !decoded.userId) {
                return res.status(401).json({ message: "Asafal Token, Permission nahi hai!" });
            }

            // Logged-in user ki ID request object mein jodh dein
            // decoded.userId is a Mongoose ObjectId; convert to string for consistent comparisons
            req.user = decoded.userId.toString();

            return next(); // Agle step (Route) par jaane ki permission dein
        } catch (error) {
            return res.status(401).json({ message: "Asafal Token, Permission nahi hai!" });
        }
    }

    if (!token) {
        return res.status(401).json({ message: "Koi Token nahi mila, Authorization blocked!" });
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
            category: req.body.category,
            priority: req.body.priority,
            dueDate: req.body.dueDate || undefined   // Save only if provided
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
app.put('/api/todos/:id', protect, async (req, res) => {
    try {
        const { task, category, priority, isCompleted, dueDate } = req.body;
        const updates = {};
        if (task !== undefined) updates.task = task;
        if (category !== undefined) updates.category = category;
        if (priority !== undefined) updates.priority = priority;
        if (isCompleted !== undefined) updates.isCompleted = isCompleted;
        // dueDate: accept empty string / null to clear it, or a valid date string
        if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;

        const updatedTodo = await Todo.findOneAndUpdate(
            { _id: req.params.id, user: req.user },
            updates,
            { new: true, runValidators: true }
        );
        if (!updatedTodo) {
            return res.status(404).json({ message: 'Todo not found.' });
        }
        res.status(200).json(updatedTodo);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// D. DELETE: Kisi task ko hatana (ID ke zariye)
app.delete('/api/todos/:id', protect, async (req, res) => {
    try {
        const deletedTodo = await Todo.findOneAndDelete({
            _id: req.params.id,
            user: req.user
        });
        if (!deletedTodo) {
            return res.status(404).json({ message: 'Todo not found.' });
        }
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
        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '1h' });

        res.status(200).json({ message: "Login safal raha! 👋", token });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET ME: Logged-in user ka basic account info (password nahi)
app.get('/api/auth/me', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user).select('-password');
        if (!user) return res.status(404).json({ message: 'User nahi mila!' });
        res.status(200).json({ username: user.username });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// PUT CHANGE-PASSWORD: Current password verify karke naya password set karna
app.put('/api/auth/change-password', protect, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: 'Current aur new password dono zaroori hain.' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'Naya password kam se kam 6 characters ka hona chahiye.' });
        }

        // User ko database se dhoodhein (ID token se aati hai, frontend se nahi)
        const user = await User.findById(req.user);
        if (!user) return res.status(404).json({ message: 'User nahi mila!' });

        // Current password verify karein bcrypt se
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Current password galat hai!' });
        }

        // Naya password hash karein aur save karein
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        res.status(200).json({ message: 'Password successfully change ho gaya! 🔒 Please dobara login karein.' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Server Start Karein
app.listen(3000, () => {
    console.log("Todo Server port 3000 par ready hai...");
});
