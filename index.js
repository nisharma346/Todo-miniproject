const express = require('express');
const mongoose = require('mongoose');

const app = express();
app.use(express.json()); // Server ko JSON data samajhne ke liye

// 1. MongoDB se Connect Karein (Database ka naam 'todoDB' rakha hai)
mongoose.connect('mongodb://localhost:27017/todoDB')
    .then(() => console.log("Todo Database se connection safal raha! 🚀"))
    .catch((err) => console.error("Database Connection Fail:", err));

// 2. Todo ka Schema (Blueprint) banayein
const todoSchema = new mongoose.Schema({
    task: { type: String, required: true },
    isCompleted: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

// 3. Schema se Model banayein
const Todo = mongoose.model('Todo', todoSchema);

// --- ROUTES ---

// A. POST: Naya Task daalna
app.post('/api/todos', async (req, res) => {
    try {
        const newTodo = new Todo({
            task: req.body.task
            // isCompleted apne aap default: false ho jayega
        });
        const savedTodo = await newTodo.save();
        res.status(201).json(savedTodo);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// B. GET: Saare Tasks ki list dekhna
app.get('/api/todos', async (req, res) => {
    try {
        const allTodos = await Todo.find();
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

// Server Start Karein
app.listen(3000, () => {
    console.log("Todo Server port 3000 par ready hai...");
});
