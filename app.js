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

        const currentDate = new Date().toLocaleDateString('en-GB', {
            day: 'numeric', month: 'long', year: 'numeric'
        });

        // 1. Chat fetch ya create (same)
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

        // 3. Conversation Memory (same)
        const memory = currentChat.messages.map(m => ({
            role: m.role,
            content: m.content
        }));

        // ────────────────────────────────────────────────
        // IMPROVED Length Detection - More robust regex
        const lengthConfig = {
            "Short (100-200 words)": { maxTokens: 180, instruction: "Very punchy, max 3-5 points, under 150 words. No fluff." },
            "Short": { maxTokens: 180, instruction: "Very punchy, max 3-5 points, under 150 words. No fluff." },
            "Medium": { maxTokens: 350, instruction: "Balanced, 5-8 points, 200-300 words. Concise." },
            "Long-form": { maxTokens: 600, instruction: "Detailed, 8-12 points, up to 450 words. Still punchy." },
            default: { maxTokens: 300, instruction: "Medium length." }
        };

        let selectedLength = "Medium"; // fallback
        // Better regex to catch any variation
        const lengthRegex = /CONTENT_LENGTH:\s*([^ \n]+)/i;
        const lengthMatch = prompt.match(lengthRegex) || prompt.match(/Length:\s*([^ \n]+)/i);
        if (lengthMatch) {
            selectedLength = lengthMatch[1].trim();
        }

        const config = lengthConfig[selectedLength] || lengthConfig.default;
        const maxTokens = config.maxTokens;
        const lengthInstruction = config.instruction;

        // ────────────────────────────────────────────────

        // System Prompt with ultra-strict length
        const systemPrompt = `You are NicheGen AI (v3.0.4) - The Ultimate SaaS & Content Domination Shark.
        CURRENT DATE: ${currentDate}. YEAR: 2026.
        
        WEB CONTEXT: ${textContext}
        
        LENGTH RULE - MUST FOLLOW OR FAIL:
        - STRICTLY: ${lengthInstruction}
        - NEVER exceed \( {maxTokens} tokens (~ \){Math.floor(maxTokens * 0.75)} words max).
        - Short: 3-5 points only, ruthless cut.
        - Medium: 5-8 points, concise.
        - Long-form: 8-12 points, detailed but short lines.
        - If over, cut everything non-essential - prioritize impact.

        STRICT PROTOCOLS FOR UNFAIR ADVANTAGE:
        1. TONE: Aggressive Desi Hustler (Hinglish). Use "Bhai", "Market fadd dega", "Paisa hi Paisa", "Sapne sach kar".
        2. STRUCTURE: Use [🚀] for boxes, Markdown Tables for lists, Bold **Titles**. NO LONG PARAGRAPHS - Max 2 lines per point. Actionable, punchy.
        3. PLATFORM OPTIMIZED: Exactly match user's selected platform format (e.g., Instagram Reel Script: Short script with hook, body, CTA).
        4. TECH STACK: 2026 standards - Frontend: Next.js 16 + Tailwind, Backend: Node.js + Vercel AI, DB: Pinecone/Supabase, AI: Groq + Gemini chaining.
        5. X-FACTOR: Always reveal a 'Hidden Opportunity' or 'Defensibility Moat'.
        6. VIRAL BOOST: If enabled, weave in real-time trends from sources for 99.2% niche accuracy.
        7. ACCURACY: Precise mapping. End with strong CTA like "Abhi implement kar, market own kar!".
        8. POWER MODE: Zero-edit ready, high-conversion, emojis/hashtags.`;

        // 4. Groq Draft
        const draftCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                ...memory,
                { role: "user", content: prompt + `\n\nMANDATORY: Output MUST be under ${maxTokens} tokens. Cut if needed.` }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
            max_tokens: maxTokens
        });

        let draftResponse = draftCompletion.choices[0].message.content.trim();

        // 5. Gemini Polish (strict limit)
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const polishPrompt = `Refine STRICTLY under ${Math.floor(maxTokens * 0.85)} tokens max:
        Keep aggressive Hinglish tone, punchy structure, platform format, X-factor, viral boost.
        Cut fluff. Sharper, higher-conversion.
        DO NOT lengthen - shorten if needed.
        
        DRAFT: ${draftResponse}`;

        const polishResult = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: polishPrompt }] }],
            generationConfig: {
                maxOutputTokens: Math.floor(maxTokens * 0.85),
                temperature: 0.6
            }
        });

        let polishedResponse = polishResult.response.text().trim();

        // Safety truncate
        const charLimit = maxTokens * 4;
        if (polishedResponse.length > charLimit) {
            polishedResponse = polishedResponse.substring(0, charLimit) + "… (trimmed for length)";
        }

        // 6. Save (same)
        currentChat.messages.push({ role: 'user', content: prompt });
        currentChat.messages.push({ 
            role: 'assistant', 
            content: polishedResponse,
            sources: sources 
        });

        currentChat.updatedAt = Date.now();
        await currentChat.save();

        // 7. Response
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

