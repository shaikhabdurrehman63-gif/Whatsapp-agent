require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const Groq = require('groq-sdk');

// ---------- CONFIG ----------
const BOT_NAME = process.env.BOT_NAME || 'Assistant';
const IGNORE_NUMBERS = (process.env.IGNORE_NUMBERS || '')
  .split(',')
  .map((n) => n.trim())
  .filter(Boolean);

if (!process.env.GROQ_API_KEY) {
  console.error('❌ GROQ_API_KEY missing. Copy .env.example to .env and add your key.');
  process.exit(1);
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Simple in-memory chat history per contact (resets on restart)
const chatHistory = new Map();
const MAX_HISTORY = 10; // messages kept per contact

// ---------- WHATSAPP CLIENT ----------
const client = new Client({
  authStrategy: new LocalAuth(), // saves session so you don't scan QR every time
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', (qr) => {
  console.log('📱 Scan this QR code with WhatsApp (Linked Devices):');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp bot is ready and listening for messages!');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Authentication failed:', msg);
});

client.on('disconnected', (reason) => {
  console.log('⚠️ Client disconnected:', reason);
});

// ---------- MESSAGE HANDLER ----------
client.on('message', async (message) => {
  try {
    // Ignore group messages (remove this check if you want group replies too)
    const chat = await message.getChat();
    if (chat.isGroup) return;

    // Ignore status/broadcast
    if (message.from === 'status@broadcast') return;

    const contactNumber = message.from.replace('@c.us', '');
    if (IGNORE_NUMBERS.includes(contactNumber)) return;

    // Ignore messages with no text (images, stickers, etc.) — customize as needed
    if (!message.body || message.body.trim() === '') return;

    console.log(`📩 Message from ${contactNumber}: ${message.body}`);

    // Show "typing..." for a more natural feel
    await chat.sendStateTyping();

    const reply = await generateReply(contactNumber, message.body);

    // Small human-like delay before replying
    await sleep(1500 + Math.random() * 2000);

    await chat.sendMessage(reply);
    console.log(`✅ Replied: ${reply}`);
  } catch (err) {
    console.error('Error handling message:', err);
  }
});

// ---------- AI REPLY GENERATION ----------
async function generateReply(contactNumber, incomingText) {
  const history = chatHistory.get(contactNumber) || [];

  const messages = [
    {
      role: 'system',
      content: `You are ${BOT_NAME}, replying to WhatsApp messages on behalf of the phone's owner.
Reply the way a real person casually texting on WhatsApp would:
- Keep it short and natural (1-3 sentences usually)
- Use a friendly, informal tone — like how people actually text
- Don't sound like a customer support bot or an AI assistant
- Match the language the user is texting in (Hindi/English/Hinglish etc.)
- Don't over-explain or add unnecessary formality
- No em-dashes, no "As an AI" type phrases`,
    },
    ...history,
    { role: 'user', content: incomingText },
  ];

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile', // free tier on Groq
    messages,
    temperature: 0.8,
    max_tokens: 150,
  });

  const reply = completion.choices[0]?.message?.content?.trim() || "Hmm, samajh nahi aaya, phir se bolo?";

  // Update history
  history.push({ role: 'user', content: incomingText });
  history.push({ role: 'assistant', content: reply });
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
  chatHistory.set(contactNumber, history);

  return reply;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

client.initialize();
