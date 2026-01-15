require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

const app = express();

// --- MIDDLEWARES ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Auth Middleware (To protect Dashboard)
const protect = async (req, res, next) => {
    let token = req.headers.authorization;
    if (token && token.startsWith('Bearer')) {
        try {
            const decoded = jwt.verify(token.split(' ')[1], process.env.JWT_SECRET);
            req.user = await User.findById(decoded.id).select('-password');
            next();
        } catch (error) {
            res.status(401).json({ message: 'Not authorized, token failed' });
        }
    } else {
        res.status(401).json({ message: 'No token, access denied' });
    }
};

// --- ROUTES ---

// 1. Home Page Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 2. Auth Page Route (Login/Signup)
app.get('/auth', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'auth.html'));
});

// 3. Dashboard Route (Protected)
app.get('/dashboard', (req, res) => {
    // Note: Client-side par token check logic lagani hogi
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// --- API ENDPOINTS ---

// Register API
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        let userExists = await User.findOne({ email });
        if (userExists) return res.status(400).json({ message: 'Operator already exists' });

        const user = await User.create({ name, email, password });
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

        res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email } });
    } catch (error) {
        res.status(500).json({ message: 'Server Error during registration' });
    }
});

// Login API
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (user && (await bcrypt.compare(password, user.password))) {
            const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
            res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
        } else {
            res.status(401).json({ message: 'Invalid Credentials' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Server Error during login' });
    }
});
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// AI Content Generation Route
const Chat = require('./models/Chat');

// 1. Get all chats for Sidebar
app.get('/api/chats', protect, async (req, res) => {
    const chats = await Chat.find({ user: req.user._id }).sort({ updatedAt: -1 });
    res.json(chats);
});
// Get specific chat by ID
app.get('/api/chats/:id', protect, async (req, res) => {
    try {
        const chat = await Chat.findOne({ _id: req.params.id, user: req.user._id });
        if (!chat) return res.status(404).json({ message: "Chat not found" });
        res.json(chat);
    } catch (error) {
        res.status(500).json({ message: "Error fetching chat history" });
    }
});
// 2.
// Generate AI Content (Updated with Memory)
const { tavily } = require("@tavily/core");
const tvly = tavily("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");

// --- HELPER FUNCTION: WEB SEARCH (Updated to return structured data) ---
async function getFullSearchData(userPrompt) {
    try {
        const searchContext = await tvly.search(userPrompt, {
            searchDepth: "advanced",
            maxResults: 5,
            topic: "general"
        });
        
        // Text format AI ki knowledge ke liye
        const textContext = searchContext.results.map(r => 
            `SOURCE: ${r.title}\nCONTENT: ${r.content}\nURL: ${r.url}`
        ).join('\n\n');

        // Structured links frontend ke liye
        const sources = searchContext.results.map(r => ({
            title: r.title,
            url: r.url
        }));

        return { textContext, sources };
    } catch (err) {
        console.error("Tavily Search Error:", err);
        return { textContext: "No real-time data found.", sources: [] };
    }
}

// --- MAIN GENERATE ROUTE ---
app.post('/api/generate', protect, async (req, res) => {
    try {
        const { prompt, chatId } = req.body;
        let currentChat;

        const currentDate = new Date().toLocaleDateString('en-GB', {
            day: 'numeric', month: 'long', year: 'numeric'
        });

        if (chatId) {
            currentChat = await Chat.findOne({ _id: chatId, user: req.user._id });
        }
        if (!currentChat) {
            currentChat = new Chat({ 
                user: req.user._id, 
                title: prompt.substring(0, 30), 
                messages: [] 
            });
        }

        // 1. Search with Sources
        const { textContext, sources } = await getFullSearchData(prompt);

        const memory = currentChat.messages.map(m => ({
            role: m.role,
            content: m.content
        }));

        // 2. Groq AI Completion
        const completion = await groq.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: `You are NicheGen AI (v3.0).
                    CURRENT DATE: ${currentDate}. YEAR: 2026.
                    CONTEXT: ${textContext}
                    TONE: Aggressive, Shark Tank Style, Hinglish.
                   STRICT FORMATTING RULES:
1. Use [BOX] style or Emojis for titles.
2. Sab kuch Bullet Points ya Numbering mein hona chahiye.
3. "Hinglish" ko thoda aur aggressive aur cool rakho (e.g., "Bhai, market fadd dega ye idea").
4. Technical Tech Stack zaroor mention karo (jaise: Next.js 16, Supabase, Tailwind V5).
"STOP GIVING LONG PARAGRAPHS. Use 1-2 lines per point and focus on visual structure (Tables, Bold, Bullets)."
STRICT OUTPUT PROTOCOL:
1. TABLES: Always ensure technical mapping is correct (e.g., AI features map to LLM models, not CSS frameworks).
2. BRAIN-DUMP: Har idea ke saath ek 'Hidden Opportunity' ya 'X-Factor' zaroor batao jo competitors miss kar rahe hain.
3. TECH STACK: 2026 ke standards use karo (Next.js 16, Vercel AI SDK, LangChain, Pinecone for Vector DB).
4. VISUALS: Use clear Markdown tables and [BOX] layouts for Pricing and Market Size.`,
                },
                ...memory,
                { role: "user", content: prompt }
            ],
            model: "llama-3.3-70b-versatile",
        });

        const aiResponse = completion.choices[0].message.content;

        // 3. Save to DB
        currentChat.messages.push({ role: 'user', content: prompt });
        currentChat.messages.push({ role: 'assistant', content: aiResponse });
        await currentChat.save();

        // 4. Send Response with Sources
        res.json({ 
            content: aiResponse, 
            chatId: currentChat._id,
            sources: sources // Frontend ko links milenge
        });

    } catch (error) {
        console.error("Neural Link Error:", error);
        res.status(500).json({ message: "Neural Link Search Failed." });
    }
});
// --- DATABASE & SERVER START ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log('✅ Neural Database Connected');
        const PORT = process.env.PORT || 5000;
        app.listen(PORT, () => console.log(`🚀 Engine running on port ${PORT}`));
    })
    .catch(err => console.log('❌ DB Connection Error:', err));