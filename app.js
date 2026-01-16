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

// --- MAIN GENERATE ROUTE (ULTRA-PREDATOR & LSI EDITION) ---
app.post('/api/generate', protect, async (req, res) => {
    try {
        const { prompt, chatId } = req.body;
        let currentChat;
        
        // 1. Chat Setup (Memory Management)
        if (chatId) {
            currentChat = await Chat.findOne({ _id: chatId, user: req.user._id });
        }
        if (!currentChat) {
            const cleanTitle = prompt.includes('TOPIC/GOAL:') 
                ? prompt.split('TOPIC/GOAL:')[1].split('\n')[0].trim().substring(0, 40)
                : prompt.substring(0, 30);
            currentChat = new Chat({ user: req.user._id, title: cleanTitle, messages: [] });
        }

        const currentDate = new Date().toLocaleDateString('en-GB', {
            day: 'numeric', month: 'long', year: 'numeric'
        });

        // 2. Real-time Search Context (The 2026 Competitive Edge)
        const { textContext, sources } = await getFullSearchData(prompt);
        
        const lengthConfig = { "Short": 400, "Medium": 800, "Long-form": 1500, default: 600 };
        const selectedLength = prompt.match(/CONTENT_LENGTH:\s*([^ \n,]+)/i)?.[1].trim() || "Medium";
        const targetTokens = lengthConfig[selectedLength] || lengthConfig.default;

        // 3. PREDATOR SYSTEM PROMPT (Actionable & Viral)
        const systemPrompt = `You are NicheGen AI (v3.0.4) - The Ultimate Content Predator. 
CURRENT DATE: ${currentDate}. YEAR: 2026. 
CONTEXT (2026 Live Market Intel): ${textContext}

MISSION: Generate an ACTIONABLE BLUEPRINT. User ko aisi cheez do jo wo seedha copy-paste karke viral kar sake.

STRICT DOMINATION PROTOCOLS:
1. THE KILLER HOOK: Start with a "Controversial Truth" or "Pattern Interrupt". 
2. STRUCTURE: 
   - [🚀] THE UNFAIR ADVANTAGE: Secret growth hack.
   - [🛠️] THE PREDATOR STACK: Technical step-by-step (e.g., Vercel AI SDK 4.0, Agentic Workflows).
   - [💰] THE MONEY MOAT: Monetization/Defensibility strategy.
3. TONE: Aggressive Desi Hustler (Hinglish). Use "Market fadd dega", "System Hang", "Cheat Code".
4. FORMATTING: Use Markdown Tables for data/pricing. ZERO long paragraphs.
"MANDATORY: Every response MUST include at least one Markdown Table comparing tech or pricing."`;

        // 4. Groq Draft (Fast Initial Intelligence)
        const draftCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `${prompt}\n\nCreate a raw high-voltage draft. Focus on direct implementation. Length: ${selectedLength}.` }
            ],
            model: "llama-3.3-70b-versatile",
            max_tokens: Math.floor(targetTokens * 0.7)
        });
        let finalResponse = draftCompletion.choices[0].message.content;

        // 5. Gemini Polish with Multi-Key Rotation & LSI Logic
        const keys = [process.env.GEMINI_API_KEY_1, process.env.GEMINI_API_KEY_2];
        let polished = false;

        for (const key of keys) {
            if (!key) continue;
            try {
                const genAI = new GoogleGenerativeAI(key);
                // Gemini 2.0 Flash is state-of-the-art for 2026
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 

                const polishPrompt = `Act as a Viral SEO Architect & LSI (Latent Semantic Indexing) Expert. 
                Transform this draft into a Client-Ready Actionable Blueprint:
                
                DRAFT: ${finalResponse}

                STRICT POLISH RULES:
                1. SEMANTIC SEO: Embed 5 hidden LSI keywords trending in 2026 context.
                2. HASHTAG CLUSTERS: End with 3 sets: #HighVolume, #NicheSpecific, and #LSI_Hidden (Low competition, High reach).
                3. AGGRESSIVE HOOKS: Make the first 2 lines absolute fire.
                4. VIRAL FLOW: Add 2026 tech moats and ensure 99.2% zero-edit readiness.
                5. TARGET DEPTH: Exactly match ${selectedLength} requirements.`;

                const polishResult = await model.generateContent({
                    contents: [{ role: "user", parts: [{ text: polishPrompt }] }],
                    generationConfig: { maxOutputTokens: targetTokens, temperature: 0.65 }
                });

                finalResponse = polishResult.response.text();
                polished = true;
                console.log(`✅ Key Success: Gemini LSI Polish Complete.`);
                break;
            } catch (geminiError) {
                console.error(`⚠️ Key Rotation in progress...`);
            }
        }

        if (!polished) {
            finalResponse += "\n\n*(Optimized by NicheGen FastEngine - Direct Implementation Mode)*";
        }

        // 6. Database Persistence & API Response
        currentChat.messages.push({ role: 'user', content: prompt });
        currentChat.messages.push({ 
            role: 'assistant', 
            content: finalResponse, 
            sources: sources 
        });

        await currentChat.save();
        res.json({ 
            content: finalResponse, 
            chatId: currentChat._id, 
            sources: sources 
        });

    } catch (error) {
        console.error("Neural Link Error:", error);
        res.status(500).json({ message: "System Overload. Try again in 60s." });
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
