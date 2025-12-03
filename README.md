<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Firebase-Hosting-FFCA28?style=for-the-badge&logo=firebase" alt="Firebase" />
  <img src="https://img.shields.io/badge/ElevenLabs-Voice_AI-000000?style=for-the-badge" alt="ElevenLabs" />
</p>

<h1 align="center">🎙️ Vox - AI Voice Contacts</h1>

<p align="center">
  <strong>Your Personal AI Assistants with Real Voices</strong>
</p>

<p align="center">
  <em>"Conversations that matter, whenever you need them."</em>
</p>

<p align="center">
  <a href="https://vox-aicontact-fe0e3.web.app">Live Demo</a> •
  <a href="#features">Features</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#voice-cloning">Voice Cloning</a> •
  <a href="#ai-providers">AI Providers</a>
</p>

---

## 🌟 What is Vox?

Vox is a **voice-first AI messenger** where your contacts are specialized AI assistants. Each contact has a unique voice, personality, and purpose - from interview coaches to language tutors to startup mentors.

**Talk naturally** with AI assistants that understand context, remember your conversations, and respond with realistic human-like voices.

---

## ✨ Features

### 🗣️ Voice Cloning - Use Your Own Voice!

**Clone your voice** or anyone's voice to create personalized AI assistants:

- **Record & Clone**: Record 30+ seconds of clear speech, and Vox will clone that voice using ElevenLabs' advanced voice cloning technology
- **Save Cloned Voices**: Your cloned voices are saved and can be reused across multiple AI contacts
- **High-Quality Synthesis**: Natural-sounding voice output powered by ElevenLabs

### 🌍 Real-Time Translation

**Translate your voice to multiple languages** in real-time:

- Speak in your native language
- AI responds in your chosen language
- Perfect for language learning and practice
- Support for Spanish, French, German, and more

### 🤖 Multiple AI Providers

Choose from the best AI models for your needs:

| Provider | Models | Best For |
|----------|--------|----------|
| **Google Gemini** | Gemini 2.0 Flash, Gemini 1.5 Pro | Fast responses, multimodal |
| **Anthropic Claude** | Claude Sonnet 4, Claude 3.5 Haiku | Reasoning, long context |
| **OpenAI** | GPT-4o, GPT-4o Mini | General purpose, coding |
| **DeepSeek** | DeepSeek Chat, DeepSeek Reasoner | Open-source, deep reasoning |

### 📱 Pre-made AI Contacts

Ready-to-use contacts for common needs:

| Contact | Purpose | Specialty |
|---------|---------|-----------|
| 👩‍💼 **Alice** | Interview Coach | Mock interviews, feedback, STAR method |
| 🇪🇸 **Carlos** | Spanish Tutor | Conversational Spanish, grammar |
| 💼 **Marcus** | Startup Mentor | Business strategy, pitching, fundraising |
| 🧘 **Dr. Sam** | Wellness Coach | Mindfulness, stress management |
| 🌐 **Luna** | Translator | Real-time translation, language help |

### 🎨 Custom AI Contacts

Create your own AI contacts with:

- **Custom Name & Avatar**: Emoji or uploaded image
- **Unique Purpose**: Define what they help you with
- **Personality**: Set their communication style
- **Voice Selection**: Choose from pre-made voices or use your cloned voice
- **AI Model**: Select which AI provider powers the contact

### 💬 Voice-First Chat Experience

- **Push-to-Talk**: Hold to record, release to send
- **Auto-Speak Responses**: AI reads responses aloud automatically
- **Message Replay**: Tap any message to hear it again
- **Conversation History**: Full context maintained across sessions

---

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- Firebase project
- API keys for AI providers

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/vox.git
cd vox

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your API keys

# Run development server
npm run dev
```

### Environment Variables

Create a `.env.local` file with your API keys:

```bash
# Firebase Configuration
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# ElevenLabs - Voice synthesis and cloning
ELEVENLABS_API_KEY=your_elevenlabs_api_key

# AI Providers (add the ones you want to use)
GEMINI_API_KEY=your_gemini_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
OPENAI_API_KEY=your_openai_api_key
DEEPSEEK_API_KEY=your_deepseek_api_key
```

### Get API Keys

| Service | Get Key From |
|---------|--------------|
| Firebase | [Firebase Console](https://console.firebase.google.com) |
| ElevenLabs | [ElevenLabs](https://elevenlabs.io) |
| Google Gemini | [Google AI Studio](https://aistudio.google.com/apikey) |
| Anthropic Claude | [Anthropic Console](https://console.anthropic.com/settings/keys) |
| OpenAI | [OpenAI Platform](https://platform.openai.com/api-keys) |
| DeepSeek | [DeepSeek Platform](https://platform.deepseek.com/api_keys) |

---

## 🎙️ Voice Cloning

### How to Clone Your Voice

1. **Create a New Contact** or edit an existing one
2. **Select "Clone New"** in the Voice Options
3. **Record 30+ seconds** of clear speech
   - Speak naturally in a quiet environment
   - Read a paragraph or tell a story
4. **Click "Clone This Voice"** to process
5. **Voice is saved** automatically for future use

### Tips for Best Results

- Use a good microphone
- Record in a quiet room
- Speak clearly and naturally
- Avoid background noise
- Record at least 30 seconds (longer is better)

---

## 🏗️ Tech Stack

### Frontend
- **Next.js 16** - React framework with App Router
- **React 19** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Lucide Icons** - Beautiful icons

### Backend & Infrastructure
- **Firebase Hosting** - Web hosting
- **Firebase Auth** - Google Sign-in authentication
- **Firebase Storage** - Avatar image storage
- **Cloud Functions** - Serverless API

### AI & Voice
- **ElevenLabs** - Text-to-speech & voice cloning
- **Google Gemini** - AI conversations
- **Anthropic Claude** - AI conversations
- **OpenAI GPT** - AI conversations
- **DeepSeek** - AI conversations

---

## 📁 Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── page.tsx           # Landing page
│   ├── login/             # Authentication
│   ├── app/               # Main app (contacts & chat)
│   ├── create/            # Create/edit contacts
│   └── api/               # API routes
│       ├── chat/          # Multi-provider AI chat
│       ├── tts/           # Text-to-speech
│       └── clone-voice/   # Voice cloning
│
├── components/            # Shared components
│   ├── ProtectedRoute.tsx
│   └── ThemeToggle.tsx
│
├── contexts/              # React contexts
│   ├── AuthContext.tsx    # Authentication state
│   └── ChatContext.tsx    # Chat state management
│
├── features/              # Feature modules
│   ├── contacts/          # Contact management
│   └── voice/             # Voice hooks & utilities
│
├── shared/                # Shared utilities
│   ├── components/        # UI components (Button, Card, Avatar)
│   ├── types/             # TypeScript types
│   └── utils/             # Helper functions
│
└── lib/                   # External service configs
    └── firebase.ts        # Firebase initialization
```

---

## 🎯 Use Cases

### 🎤 Interview Preparation
Practice mock interviews with Alice, your AI interview coach. Get real-time feedback on your answers using the STAR method.

### 🌍 Language Learning
Learn Spanish with Carlos or any language with Luna. Have natural conversations and get pronunciation help.

### 💼 Business Mentoring
Discuss your startup ideas with Marcus. Get advice on strategy, pitching, and fundraising.

### 🧘 Wellness & Mindfulness
Talk to Dr. Sam about stress management, mindfulness techniques, and maintaining work-life balance.

### 🎙️ Voice Assistants
Clone your own voice or a friend's voice to create personalized AI assistants that sound exactly like you want.

---

## 🌙 Dark Mode

Vox supports both light and dark modes, automatically adapting to your system preferences or manually toggleable.

---

## 📱 Mobile Responsive

Fully responsive design that works beautifully on:
- Desktop browsers
- Tablets
- Mobile phones (iOS & Android)

---

## 🔒 Privacy & Security

- **Secure Authentication**: Firebase Auth with Google Sign-in
- **API Keys Protected**: Server-side only, never exposed to client
- **Voice Data**: Processed securely via ElevenLabs
- **Local Storage**: Chat history stored locally on your device

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [ElevenLabs](https://elevenlabs.io) - Voice AI technology
- [Google Cloud](https://cloud.google.com) - Cloud infrastructure
- [Anthropic](https://anthropic.com) - Claude AI
- [OpenAI](https://openai.com) - GPT models
- [DeepSeek](https://deepseek.com) - Open-source AI

---

<p align="center">
  Made with ❤️ for the Google Cloud + Partners Hackathon 2025
</p>

<p align="center">
  <a href="https://vox-aicontact-fe0e3.web.app">
    <strong>🚀 Try Vox Now →</strong>
  </a>
</p>
