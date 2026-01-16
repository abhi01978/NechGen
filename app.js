require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const { GoogleGenerativeAI } = require("@google/generative-ai");

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
// Delete Chat Route
app.delete('/api/chats/:id', protect, async (req, res) => {
    try {
        const chat = await Chat.findOneAndDelete({ _id: req.params.id, user: req.user._id });
        if (!chat) return res.status(404).json({ message: "Chat not found" });
        res.json({ message: "Chat deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server Error" });
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
// --- MAIN GENERATE ROUTE ---
app.post('/api/generate', protect, async (req, res) => {
    try {
        const { prompt, chatId } = req.body;
        let currentChat;

        const currentDate = new Date().toLocaleDateString('en-GB', {
            day: 'numeric', month: 'long', year: 'numeric'
        });

        // 1. Chat fetch ya create karna (same as before)
        if (chatId) {
            currentChat = await Chat.findOne({ _id: chatId, user: req.user._id });
        }

        if (!currentChat) {
            const cleanTitle = prompt.includes('TOPIC/GOAL:') 
                ? prompt.split('TOPIC/GOAL:')[1]?.split('\n')[0].trim().substring(0, 40)
                : prompt.substring(0, 30);

            currentChat = new Chat({ 
                user: req.user._id, 
                title: cleanTitle || "New Niche", 
                messages: [] 
            });
        }

        // 2. Real-time Search (same)
        const { textContext, sources } = await getFullSearchData(prompt);

        // 3. Conversation Memory
        const memory = currentChat.messages.map(m => ({
            role: m.role,
            content: m.content
        }));

        // ────────────────────────────────────────────────
        // USER LENGTH → STRICT TOKEN LIMIT MAPPING
        const lengthConfig = {
            "Short (100-200 words)": { maxTokens: 180, instruction: "Very short & punchy, max 3-5 points, under 150 words" },
            "Short":                 { maxTokens: 180, instruction: "Very short & punchy, max 3-5 points, under 150 words" },
            "Medium":                { maxTokens: 350, instruction: "Balanced, 5-8 points, 200-300 words" },
            "Long-form":             { maxTokens: 600, instruction: "Detailed but concise, 8-12 points, up to 450 words" },
            default:                 { maxTokens: 300, instruction: "Medium length" }
        };

        // Prompt se length nikaal lo
        let selectedLength = "Medium"; // fallback
        const lengthMatch = prompt.match(/CONTENT_LENGTH:\s*([^ \n]+)/i);
        if (lengthMatch) {
            selectedLength = lengthMatch[1].trim();
        }

        const config = lengthConfig[selectedLength] || lengthConfig.default;
        const maxTokens = config.maxTokens;
        const lengthInstruction = config.instruction;

        // ────────────────────────────────────────────────

        // Enhanced System Prompt with HARD length rule
        const systemPrompt = `You are NicheGen AI (v3.0.4) - The Ultimate SaaS & Content Domination Shark.
        CURRENT DATE: ${currentDate}. YEAR: 2026. Assume advanced AI ecosystem with Agentic AI, Vercel AI SDK, LangChain v0.3+, Pinecone VectorDB.
        
        WEB CONTEXT (REAL-TIME 2026 TRENDS): ${textContext}
        
        LENGTH RULE - ABSOLUTE & NON-NEGOTIABLE:
        - STRICTLY follow: ${lengthInstruction}
        - NEVER exceed ${maxTokens} tokens total output (~${Math.floor(maxTokens * 0.75)} words max).
        - Short: Max 180 tokens, 3-5 short points only, no fluff.
        - Medium: Max 350 tokens, 5-8 points.
        - Long-form: Max 600 tokens, detailed but concise.
        - If you go over, cut ruthlessly - prioritize punchy over complete.

        ... (baaki sab strict protocols same rakh: tone, structure, X-factor, viral boost, etc.)
        `;

        // 4. Groq - HARD max_tokens limit
        const draftCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                ...memory,
                { role: "user", content: prompt + `\n\nMANDATORY RULE: Output MUST be under ${maxTokens} tokens. Respect length exactly.` }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
            max_tokens: maxTokens  // ← Yeh critical line
        });

        let draftResponse = draftCompletion.choices[0].message.content.trim();

        // 5. Gemini Polish - Strict limit + cut fluff
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Flash fast hai

        const polishPrompt = `Refine this draft STRICTLY under ${Math.floor(maxTokens * 0.85)} tokens max:
        Keep aggressive Hinglish tone, punchy structure, platform format, X-factor, viral boost.
        Cut ANY fluff. Make it sharper, higher-conversion.
        DO NOT make it longer than the draft - shorten if needed.
        
        DRAFT: ${draftResponse}`;

        const polishResult = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: polishPrompt }] }],
            generationConfig: {
                maxOutputTokens: Math.floor(maxTokens * 0.85),  // ← Gemini strict limit
                temperature: 0.6
            }
        });

        let polishedResponse = polishResult.response.text().trim();

        // Extra safety: Agar bhi lamba aaya to truncate
        const charLimit = maxTokens * 4; // rough char estimate (~4 chars per token)
        if (polishedResponse.length > charLimit) {
            polishedResponse = polishedResponse.substring(0, charLimit) + "… (shortened for length)";
        }

        // 6. Save to DB
        currentChat.messages.push({ role: 'user', content: prompt });
        currentChat.messages.push({ 
            role: 'assistant', 
            content: polishedResponse,
            sources: sources 
        });

        currentChat.updatedAt = Date.now();
        await currentChat.save();

        // 7. Response to Frontend
        res.json({ 
            content: polishedResponse, 
            chatId: currentChat._id,
            sources: sources 
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
