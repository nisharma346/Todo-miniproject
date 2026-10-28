require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
    RECURRENCE_OPTIONS,
    validateRecurrence,
    calculateNextDueDate,
    ensureNextOccurrence
} = require('./recurrence');
const {
    buildCompletionHistoryPipeline,
    buildCompletionTransitionFilter,
    buildProductivitySummary,
    getLocalDateKey,
    validateDailyGoal,
    validateTimeZone
} = require('./productivity');
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
    description: { type: String, default: '' },
    isCompleted: { type: Boolean, default: false },
    status: {
        type: String,
        enum: ['todo', 'inProgress', 'completed'],
        default: function () {
            return this.isCompleted ? 'completed' : 'todo';
        }
    },
    recurrence: {
        type: String,
        enum: RECURRENCE_OPTIONS,
        default: 'none'
    },
    completedAt: { type: Date, default: null },
    completionHistory: {
        type: [{ _id: false, completedAt: { type: Date, required: true } }],
        default: []
    },
    nextOccurrenceId: { type: mongoose.Schema.Types.ObjectId },
    nextOccurrenceCreatedAt: { type: Date },
    nextOccurrenceDueDate: { type: Date },
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
    password: { type: String, required: true },
    dailyTaskGoal: { type: Number, min: 1, max: 100, default: 5 }
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
        const recurrence = req.body.recurrence === undefined
            ? 'none'
            : validateRecurrence(req.body.recurrence);
        const newTodo = new Todo({
            user: req.user,
            task: req.body.task,
            description: req.body.description,
            category: req.body.category,
            priority: req.body.priority,
            dueDate: req.body.dueDate || undefined,
            recurrence
        });
        const savedTodo = await newTodo.save();
        res.status(201).json(savedTodo);
    } catch (error) {
        const isClientError =
            error instanceof TypeError ||
            error instanceof RangeError ||
            error instanceof mongoose.Error.ValidationError ||
            error instanceof mongoose.Error.CastError;
        res.status(isClientError ? 400 : 500).json({ message: error.message });
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
        const { task, description, category, priority, isCompleted, status, dueDate } = req.body;
        const updates = {};
        if (task !== undefined) updates.task = task;
        if (description !== undefined) updates.description = description;
        if (category !== undefined) updates.category = category;
        if (priority !== undefined) updates.priority = priority;
        if (req.body.recurrence !== undefined) {
            updates.recurrence = validateRecurrence(req.body.recurrence);
        }
        if (status !== undefined && !['todo', 'inProgress', 'completed'].includes(status)) {
            return res.status(400).json({ message: 'Invalid task status.' });
        }
        if (isCompleted !== undefined && typeof isCompleted !== 'boolean') {
            return res.status(400).json({ message: 'isCompleted must be a boolean.' });
        }
        if (status !== undefined && isCompleted !== undefined &&
            (status === 'completed') !== isCompleted) {
            return res.status(400).json({ message: 'Task status and completion state must match.' });
        }
        if (status !== undefined) {
            updates.status = status;
            updates.isCompleted = status === 'completed';
        } else if (isCompleted !== undefined) {
            updates.isCompleted = isCompleted;
            updates.status = isCompleted ? 'completed' : 'todo';
        }
        if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;

        if (updates.isCompleted === true) {
            const existingTodo = await Todo.findOne({
                _id: req.params.id,
                user: req.user
            });
            if (!existingTodo) {
                return res.status(404).json({ message: 'Todo not found.' });
            }

            const wasCompleted = existingTodo.isCompleted || existingTodo.status === 'completed';
            let completedTodo = existingTodo;
            let completedByThisRequest = false;
            if (!wasCompleted) {
                const completionTime = new Date();
                const recurrence = updates.recurrence || existingTodo.recurrence || 'none';
                const nextOccurrenceId = existingTodo.nextOccurrenceId ||
                    (recurrence !== 'none' ? new mongoose.Types.ObjectId() : undefined);
                const nextOccurrenceCreatedAt = existingTodo.nextOccurrenceCreatedAt ||
                    (nextOccurrenceId ? completionTime : undefined);
                const nextDueDate = nextOccurrenceId
                    ? existingTodo.nextOccurrenceDueDate || calculateNextDueDate(
                        recurrence,
                        updates.dueDate !== undefined ? updates.dueDate : existingTodo.dueDate,
                        completionTime
                    )
                    : undefined;
                const setValues = {
                    ...updates,
                    isCompleted: true,
                    status: 'completed',
                    completedAt: completionTime
                };
                if (nextOccurrenceId) {
                    setValues.nextOccurrenceId = nextOccurrenceId;
                    setValues.nextOccurrenceCreatedAt = nextOccurrenceCreatedAt;
                    setValues.nextOccurrenceDueDate = nextDueDate;
                }

                completedTodo = await Todo.findOneAndUpdate(
                    buildCompletionTransitionFilter(req.params.id, req.user),
                    {
                        $set: setValues,
                        $push: { completionHistory: { completedAt: completionTime } }
                    },
                    { new: true, runValidators: true }
                );
                completedByThisRequest = Boolean(completedTodo);
                if (!completedTodo) {
                    completedTodo = await Todo.findOne({
                        _id: req.params.id,
                        user: req.user
                    });
                    if (!completedTodo) {
                        return res.status(404).json({ message: 'Todo not found.' });
                    }
                }
            }

            if (completedTodo.nextOccurrenceId) {
                try {
                    await ensureNextOccurrence(Todo, {
                        ...completedTodo.toObject(),
                        recurrence: completedTodo.recurrence || 'none'
                    });
                } catch (occurrenceError) {
                    if (completedByThisRequest) {
                        try {
                            await Todo.findOneAndUpdate(
                                {
                                    _id: req.params.id,
                                    user: req.user,
                                    nextOccurrenceId: completedTodo.nextOccurrenceId,
                                    status: 'completed'
                                },
                                {
                                    $set: {
                                        isCompleted: false,
                                        status: existingTodo.status || 'todo'
                                    },
                                    $unset: { completedAt: 1 },
                                    $pull: {
                                        completionHistory: {
                                            completedAt: completedTodo.completedAt
                                        }
                                    }
                                },
                                { new: true, runValidators: true }
                            );
                        } catch (rollbackError) {
                            throw new Error(
                                `Could not create the next occurrence: ${occurrenceError.message}. ` +
                                `Could not restore the task status: ${rollbackError.message}`
                            );
                        }
                    }
                    throw occurrenceError;
                }
            }
            return res.status(200).json(completedTodo);
        }

        const updatedTodo = await Todo.findOneAndUpdate(
            { _id: req.params.id, user: req.user },
            {
                $set: updates,
                ...(updates.isCompleted === false ? { $unset: { completedAt: 1 } } : {})
            },
            { new: true, runValidators: true }
        );
        if (!updatedTodo) {
            return res.status(404).json({ message: 'Todo not found.' });
        }
        res.status(200).json(updatedTodo);
    } catch (error) {
        const isClientError =
            error instanceof TypeError ||
            error instanceof RangeError ||
            error instanceof mongoose.Error.ValidationError ||
            error instanceof mongoose.Error.CastError;
        res.status(isClientError ? 400 : 500).json({ message: error.message });
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

app.get('/api/productivity', protect, async (req, res) => {
    try {
        const timeZone = validateTimeZone(req.query.timeZone || 'UTC');
        const userId = new mongoose.Types.ObjectId(req.user);
        const [user, dailyRows] = await Promise.all([
            User.findById(userId).select('dailyTaskGoal').lean(),
            Todo.aggregate(buildCompletionHistoryPipeline(userId, timeZone))
        ]);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const dailyCounts = new Map(dailyRows.map(({ _id, count }) => [_id, count]));
        const today = getLocalDateKey(new Date(), timeZone);
        const summary = buildProductivitySummary({
            dailyCounts,
            today,
            dailyGoal: user.dailyTaskGoal ?? 5
        });
        return res.status(200).json(summary);
    } catch (error) {
        const isClientError = error instanceof TypeError || error instanceof RangeError;
        return res.status(isClientError ? 400 : 500).json({ message: error.message });
    }
});

app.put('/api/productivity/goal', protect, async (req, res) => {
    try {
        const dailyTaskGoal = validateDailyGoal(req.body.dailyGoal);
        const user = await User.findByIdAndUpdate(
            req.user,
            { $set: { dailyTaskGoal } },
            { new: true, runValidators: true }
        ).select('dailyTaskGoal');
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }
        return res.status(200).json({ dailyGoal: user.dailyTaskGoal });
    } catch (error) {
        const isClientError =
            error instanceof TypeError ||
            error instanceof RangeError ||
            error instanceof mongoose.Error.ValidationError ||
            error instanceof mongoose.Error.CastError;
        return res.status(isClientError ? 400 : 500).json({ message: error.message });
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

// Local development ke liye server start karein
if (require.main === module) {
    app.listen(3000, () => {
        console.log("Todo Server port 3000 par ready hai...");
    });
}

// Vercel ke liye Express app export karein
module.exports = app;