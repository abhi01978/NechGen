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
// --- GET SINGLE CHAT BY ID ---
app.get('/api/chats/:id', protect, async (req, res) => {
    try {
        // ID ko valid format mein check karo aur user ownership verify karo
        const chat = await Chat.findOne({ 
            _id: req.params.id, 
            user: req.user._id 
        });

        if (!chat) {
            return res.status(404).json({ message: "Chat session not found in Neural Database" });
        }

        res.json(chat);
    } catch (error) {
        console.error("Fetch Chat Error:", error);
        res.status(500).json({ message: "Neural Link Failure" });
    }
});

// --- DELETE CHAT BY ID ---
app.delete('/api/chats/:id', protect, async (req, res) => {
    try {
        const deletedChat = await Chat.findOneAndDelete({ 
            _id: req.params.id, 
            user: req.user._id 
        });
        
        if (!deletedChat) {
            return res.status(404).json({ message: "Chat not found" });
        }
        
        res.json({ message: "Session Purged Successfully" });
    } catch (error) {
        res.status(500).json({ message: "Delete Operation Failed" });
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


// --- MAIN GENERATE ROUTE (ULTRA-PREDATOR & LSI EDITION) ---
app.post('/api/generate', protect, async (req, res) => {
    try {
        const { prompt, chatId } = req.body;
        let currentChat;
        
        // 1. Memory & Chat Management
        if (chatId) {
            currentChat = await Chat.findOne({ _id: chatId, user: req.user._id });
        }
        if (!currentChat) {
            const cleanTitle = prompt.substring(0, 30);
            currentChat = new Chat({ user: req.user._id, title: cleanTitle, messages: [] });
        }

        // 2. Dynamic Parameters Extraction (Tone, Length, Platform)
        const selectedLength = prompt.match(/CONTENT_LENGTH:\s*([^ \n,]+)/i)?.[1].trim() || "Medium";
        const selectedTone = prompt.match(/TONE:\s*([^ \n,]+)/i)?.[1].trim() || "Desi Hustler";
        const selectedPlatform = prompt.match(/PLATFORM:\s*([^ \n,]+)/i)?.[1].trim() || "Multi-Channel";
        
        const lengthConfig = { "Short": 600, "Medium": 1200, "Long-form": 2500, default: 1000 };
        const targetTokens = lengthConfig[selectedLength] || lengthConfig.default;

        // 3. 2026 Real-time Market Intel
        const { textContext, sources } = await getFullSearchData(prompt);

        // 4. THE VIRAL PREDATOR SYSTEM PROMPT
        const systemPrompt = `You are NicheGen AI v4.0 (Predator Mode). 
        YEAR: 2026. CONTEXT: ${textContext}
        
        MISSION: Create content that is impossible to ignore. Use 'Pattern Interrupt' psychology.
        
        STRICT VIRAL PROTOCOLS:
        1. TONE: Strictly follow ${selectedTone}. If 'Desi Hustler', use aggressive Hinglish (e.g., 'System Hang', 'Zero-Competition Moat').
        2. STRUCTURE: 
           - THE KILLER HOOK (First 2 lines must stop the scroll).
           - THE ACTIONABLE BLUEPRINT (Step-by-step technical implementation).
           - THE 2026 EDGE (Tools/Trends others don't know yet).
        3. FORMATTING: Every 200 words MUST have a Markdown Table or a Bold Highlight. ZERO generic filler text.
        4. VIRAL SCORE: At the end, provide a 'Predictive Viral Score' (1-100%) based on 2026 trends.`;

        // 5. Groq Draft (High-Voltage Intelligence)
        const draftCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `User Prompt: ${prompt}\n\nTask: Generate a raw, high-energy blueprint for ${selectedPlatform}. Target Depth: ${selectedLength}.` }
            ],
            model: "llama-3.3-70b-versatile",
            max_tokens: targetTokens
        });
        let rawDraft = draftCompletion.choices[0].message.content;

        // 6. Gemini LSI & SEO Overhaul (The "Unbeatable" Layer)
        const keys = [process.env.GEMINI_API_KEY_1, process.env.GEMINI_API_KEY_2];
        let finalResponse = rawDraft;

        for (const key of keys) {
            if (!key) continue;
            try {
                const genAI = new GoogleGenerativeAI(key);
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" }); 

                const polishPrompt = `Act as a 2026 Viral SEO Strategist. 
                Transform this draft into an UNBEATABLE masterpiece for ${selectedPlatform}.
                
                DRAFT: ${rawDraft}
                
                POLISH REQUIREMENTS:
                1. LSI INSERTION: Inject 10+ hidden semantic keywords to dominate 2026 search engines.
                2. DEPTH & MOAT: If Long-form, add a 'Technical Moat' section explaining how to stay ahead of 99% of competitors.
                3. HASHTAGS: Provide 3 clusters (High Reach, Niche, LSI-Hidden).
                4. ACTIONABLE: Add a 'Day 1 Execution Plan' table.
                5. TONE CHECK: Ensure it sounds exactly like a ${selectedTone}.
                STRICT UPGRADE RULES:
1. THE SCROLL STOPPER: Start with a controversial statement about AI agencies in 2026.
2. AGGRESSIVE HINGLISH: Mix pure English tech terms with raw Desi street-smart Hinglish.
3. TECHNICAL MOAT: Add a section called "[🔥] SECRET WEAPON" - talk about using "Agentic RAG" or "Autonomous Browser Agents".
4. LSI CLUSTERS: Inject keywords like 'Token Efficiency', 'Agent Orchestration', 'Inference Optimization'.
5. FORMATTING: Use emojis, bold text, and markdown tables to make it scannable. 
6. NO INTRO: Don't say "Bhai, ye post hai...", seedha mudde ki baat karo.`;

                const result = await model.generateContent({
                    contents: [{ role: "user", parts: [{ text: polishPrompt }] }],
                    generationConfig: { maxOutputTokens: targetTokens + 500, temperature: 0.75 }
                });

                finalResponse = result.response.text();
                break;
            } catch (err) { console.error("Rotating Key..."); }
        }

        // 7. Save & Push
        currentChat.messages.push({ role: 'user', content: prompt }, { role: 'assistant', content: finalResponse, sources: sources });
        await currentChat.save();
        res.json({ content: finalResponse, chatId: currentChat._id, sources: sources });

    } catch (error) {
        console.error("Neural Error:", error);
        res.status(500).json({ message: "Engine Overheat. Try in 30s." });
    }
});
const { InferenceClient } = require('@huggingface/inference');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const hf = new InferenceClient(process.env.HF_TOKEN);
// Ye endpoint tera HTML call karega
app.post('/generate-image', async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    return res.status(400).json({ error: 'Prompt daal bhai, khali mat chhod!' });
  }

  try {
    console.log('Prompt mila:', prompt);

    // FLUX.1-schnell — free tier mein fast + achhi quality (1-4 steps)
    // 2026 mein bhi ye popular hai, direct HF token se chalta hai (provider default huggingface.co)
    const blob = await hf.textToImage({
      model: 'black-forest-labs/FLUX.1-schnell',
      inputs: prompt.trim(),
      // Optional: agar chahiye to add kar sakta hai
      // parameters: {
      //   num_inference_steps: 4,
      //   guidance_scale: 0,
      //   height: 1024,
      //   width: 1024
      // }
    });

    // Blob → Buffer
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Unique filename (public folder mein save)
    const filename = `generated_${uuidv4().slice(0, 8)}.png`;
    const filePath = path.join(__dirname, 'public', filename);

    fs.writeFileSync(filePath, buffer);
    console.log(`Image save: ${filename}`);

    // Frontend ko image URL bhej (public folder static hai to /filename direct access hoga)
    const imageUrl = `/${filename}`;

    res.json({ imageUrl });

  } catch (error) {
    console.error('Error bhai:', error.message || error);

    let errMsg = 'Kuch gadbad ho gayi';
    if (error.status === 429) {
      errMsg = 'Rate limit hit! Free tier mein thoda wait kar (1-2 min ya zyada requests mat kar)';
    } else if (error.status === 401 || error.status === 403) {
      errMsg = 'Token galat ya invalid hai — .env check kar ya naya token generate kar';
    } else if (error.message.includes('model')) {
      errMsg = 'Model issue — FLUX.1-schnell available nahi ya quota khatam';
    }

    res.status(500).json({ error: errMsg });
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
