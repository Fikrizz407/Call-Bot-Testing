const express = require("express")
const { twiml } = require("twilio")
const OpenAI = require("openai")
const fs = require("fs")
const axios = require("axios")
const path = require("path")
require("dotenv").config()

const app = express()
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
})

app.use(express.urlencoded({ extended: false }))

// Menyimpan konteks percakapan untuk setiap call
const conversations = new Map()

// Enhanced system prompt dengan instruksi bahasa Indonesia
const enhancedSystemPrompt = `Anda adalah Agent Telemarketing AXA Mandiri yang profesional untuk produk Asuransi Mandiri Proteksi Penyakit Tropis.

ATURAN BAHASA MUTLAK:
- Gunakan HANYA bahasa Indonesia murni 100%
- DILARANG menggunakan kata bahasa Inggris sama sekali
- Gunakan gaya bicara natural orang Indonesia laki-laki
- Respons maksimal 20-25 kata untuk telepon
- Gunakan ungkapan Indonesia: "Baik", "Ya", "Tentu", "Silakan", "Maaf"

KARAKTER SUARA LAKI-LAKI INDONESIA:
- Ramah dan Sopan dengan gaya Indonesia
- Komunikatif tanpa menggunakan istilah asing
- Percaya diri dengan bahasa Indonesia yang baik
- Empatik dengan cara orang Indonesia
- Suara tegas tapi tidak memaksa

WAKTU SEKARANG: pagi
GREETING: "Selamat pagi"
OPENING: "Selamat pagi, bisa bicara dengan Bapak/Ibu? Saya Agent dari AXA Mandiri, boleh meluangkan waktunya sebentar?"

PRODUK: Asuransi Mandiri Proteksi Penyakit Tropis
- Manfaat: Penggantian biaya rawat inap akibat penyakit tropis  
- Penyakit yang dicover: Demam berdarah, Tifus, Campak, Hepatitis A, Malaria, Zika, Chikungunya
- Perusahaan berizin dan diawasi OJK

FLOW PERCAKAPAN:
1. GREETINGS: Gunakan opening script wajib
2. PRESENTATION: Jelaskan benefit produk step by step
3. TRIAL CLOSING: Tanyakan minat nasabah
4. VERIFICATION: Data nasabah (DOB, email, alamat) - STEP BY STEP
5. LEGAL STATEMENT: Sampaikan dengan jelas
6. MCP & FC: Konfirmasi pendebetan dan data akhir
7. FREE LOOK STATEMENT: Sampaikan hak pembatalan
8. CLOSING GREETING: Ucapan terima kasih

PENTING: Setiap respons harus terdengar seperti orang Indonesia laki-laki asli berbicara, bukan terjemahan.`

// Fungsi filter untuk memastikan bahasa Indonesia murni
function filterToIndonesian(text) {
    const replacements = {
        'okay': 'baik', 'ok': 'oke', 'yes': 'ya', 'no': 'tidak',
        'sorry': 'maaf', 'please': 'silakan', 'thank you': 'terima kasih',
        'thanks': 'terima kasih', 'good': 'bagus', 'great': 'hebat',
        'understand': 'paham', 'sure': 'pasti', 'exactly': 'tepat sekali',
        'so': 'jadi', 'but': 'tapi', 'and': 'dan', 'or': 'atau',
        'actually': 'sebenarnya', 'really': 'benar-benar'
    }
    
    let filteredText = text
    for (const [english, indonesian] of Object.entries(replacements)) {
        const regex = new RegExp(`\\b${english}\\b`, 'gi')
        filteredText = filteredText.replace(regex, indonesian)
    }
    return filteredText
}

// Endpoint saat call masuk
app.post("/voice/answer", async (req, res) => {
    const response = new twiml.VoiceResponse()
    const callSid = req.body.CallSid
    
    console.log("📞 Incoming call, SID:", callSid)
    
    // Inisialisasi conversation context
    conversations.set(callSid, {
        messages: [
            {
                role: "system",
                content: enhancedSystemPrompt
            }
        ]
    })
    
    const greetingText = "Selamat pagi, bisa bicara dengan Bapak atau Ibu? Saya Agent dari AXA Mandiri, boleh meluangkan waktunya sebentar?"
    
    // Menggunakan Twilio voice
    response.say(greetingText, {
        voice: "man",
        language: "id-ID",
        rate: "85%",
        pitch: "-5%"
    })
    
    // Langsung ke recording
    response.redirect("/voice/listen")
    
    res.type("text/xml")
    res.send(response.toString())
})

// Endpoint untuk mendengarkan input suara user
app.post("/voice/listen", (req, res) => {
    const response = new twiml.VoiceResponse()
    
    console.log("👂 Setting up voice recording...")
    
    // Record audio dari user dengan timeout yang cukup
    response.record({
        action: "/voice/process-speech",
        method: "POST",
        maxLength: 30,
        timeout: 5,
        playBeep: true,
        recordingChannels: "mono",
        recordingStatusCallback: "/voice/recording-status"
    })
    
    // Fallback jika tidak ada input
    response.say("Maaf, saya tidak mendengar apa-apa. Silakan coba lagi.", {
        voice: "man",
        language: "id-ID",
        rate: "85%"
    })
    
    res.type("text/xml")
    res.send(response.toString())
})

// Endpoint untuk memproses speech yang sudah direkam
app.post("/voice/process-speech", async (req, res) => {
    const response = new twiml.VoiceResponse()
    const recordingUrl = req.body.RecordingUrl
    const callSid = req.body.CallSid
    
    try {
        console.log("🎤 Processing speech from:", recordingUrl)
        console.log("📋 Call SID:", callSid)
        
        // Validate required data
        if (!recordingUrl) {
            console.error("❌ No recording URL provided")
            response.say("Maaf, tidak ada rekaman yang diterima. Silakan coba lagi.", {
                voice: "man",
                language: "id-ID",
                rate: "85%"
            })
            response.redirect("/voice/listen")
            res.type("text/xml")
            res.send(response.toString())
            return
        }
        
        // Download audio file dengan Basic Auth
        const audioResponse = await axios({
            method: 'get',
            url: recordingUrl,
            responseType: 'stream',
            auth: {
                username: process.env.TWILIO_ACCOUNT_SID,
                password: process.env.TWILIO_AUTH_TOKEN
            },
            timeout: 30000
        })
        
        console.log("📥 Audio downloaded successfully")
        
        // Simpan file audio sementara
        const audioPath = path.join(__dirname, `temp_audio_${callSid}.wav`)
        const writer = fs.createWriteStream(audioPath)
        audioResponse.data.pipe(writer)
        
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve)
            writer.on('error', reject)
        })
        
        console.log("📁 Audio file saved, converting to text...")
        
        // Check if file exists and has content
        const stats = fs.statSync(audioPath)
        if (stats.size === 0) {
            console.error("❌ Audio file is empty")
            fs.unlinkSync(audioPath)
            response.say("Maaf, rekaman kosong. Silakan coba berbicara lagi.", {
                voice: "man",
                language: "id-ID",
                rate: "85%"
            })
            response.redirect("/voice/listen")
            res.type("text/xml")
            res.send(response.toString())
            return
        }
        
        console.log(`📊 Audio file size: ${stats.size} bytes`)
        
        // Konversi audio ke text menggunakan Whisper
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: "whisper-1",
            language: "id"
        })
        
        const userText = transcription.text
        console.log("📝 User said:", userText)
        
        // Hapus file audio sementara
        fs.unlinkSync(audioPath)
        
        if (!userText || !userText.trim()) {
            response.say("Maaf, saya tidak bisa mendengar dengan jelas. Silakan coba lagi.", {
                voice: "man",
                language: "id-ID",
                rate: "85%"
            })
            response.redirect("/voice/listen")
            res.type("text/xml")
            res.send(response.toString())
            return
        }
        
        // Ambil context conversation
        const conversation = conversations.get(callSid) || { 
            messages: [{ role: "system", content: enhancedSystemPrompt }] 
        }
        
        // Tambahkan pesan user ke conversation
        conversation.messages.push({
            role: "user",
            content: userText
        })
        
        console.log("🤖 Getting AI response...")
        
        // Generate response menggunakan GPT-4o dengan instruksi bahasa Indonesia
        const chatCompletion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                ...conversation.messages,
                {
                    role: "system", 
                    content: "PENTING: Jawab HANYA dalam bahasa Indonesia murni. Tidak ada kata bahasa Inggris sama sekali. Gunakan gaya bicara natural pria Indonesia. Maksimal 25 kata."
                }
            ],
            max_tokens: 100,
            temperature: 0.7,
            presence_penalty: 0.2,
            frequency_penalty: 0.3
        })
        
        let aiResponse = chatCompletion.choices[0].message.content
        
        // Filter untuk memastikan bahasa Indonesia murni
        aiResponse = filterToIndonesian(aiResponse)
        
        console.log("💬 AI Response (filtered):", aiResponse)
        
        // Tambahkan respons AI ke conversation
        conversation.messages.push({
            role: "assistant",
            content: aiResponse
        })
        
        // Update conversation context
        conversations.set(callSid, conversation)
        
        // Menggunakan Twilio voice untuk respons AI
        response.say(aiResponse, {
            voice: "man",
            language: "id-ID",
            rate: "85%",
            pitch: "-5%"
        })
        
        // Continue or end call prompt
        response.gather({
            input: "dtmf",
            numDigits: 1,
            action: "/voice/continue",
            method: "POST",
            timeout: 10
        }).say("Tekan 1 untuk melanjutkan berbicara, atau tekan 2 untuk mengakhiri panggilan.", {
            voice: "man",
            language: "id-ID",
            rate: "85%"
        })
        
        // Fallback jika tidak ada input
        response.redirect("/voice/listen")
        
    } catch (error) {
        console.error("❌ Error processing speech:", error.message)
        
        // Cleanup temp file if it exists
        const audioPath = path.join(__dirname, `temp_audio_${callSid}.wav`)
        if (fs.existsSync(audioPath)) {
            try {
                fs.unlinkSync(audioPath)
                console.log("🧹 Cleaned up temp audio file")
            } catch (cleanupError) {
                console.error("⚠️ Failed to cleanup temp file:", cleanupError.message)
            }
        }
        
        // Specific error messages
        let errorMessage = "Maaf, terjadi kesalahan. Silakan coba lagi."
        
        if (error.response?.status === 401) {
            console.error("🔑 Authentication error - check credentials")
            errorMessage = "Maaf, terjadi kesalahan autentikasi. Silakan coba lagi."
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            console.error("🌐 Network error")
            errorMessage = "Maaf, terjadi masalah koneksi. Silakan coba lagi."
        } else if (error.message.includes('OpenAI')) {
            console.error("🤖 OpenAI API error")
            errorMessage = "Maaf, layanan AI sedang bermasalah. Silakan coba lagi."
        }
        
        response.say(errorMessage, {
            voice: "man",
            language: "id-ID",
            rate: "85%"
        })
        response.redirect("/voice/listen")
    }
    
    res.type("text/xml")
    res.send(response.toString())
})

// Endpoint untuk handle pilihan continue atau tidak
app.post("/voice/continue", async (req, res) => {
    const digit = req.body.Digits
    const response = new twiml.VoiceResponse()
    const callSid = req.body.CallSid
    
    console.log(`📞 User pressed: ${digit}`)
    
    if (digit === "1") {
        const continueText = "Baik, silakan lanjutkan berbicara."
        
        response.say(continueText, {
            voice: "man",
            language: "id-ID",
            rate: "85%"
        })
        
        response.redirect("/voice/listen")
        
    } else if (digit === "2") {
        const goodbyeText = "Terima kasih sudah berbicara dengan saya. Sampai jumpa!"
        
        response.say(goodbyeText, {
            voice: "man",
            language: "id-ID",
            rate: "85%"
        })
        
        response.hangup()
    } else {
        // Jika tidak ada input atau input tidak valid, lanjutkan mendengarkan
        response.redirect("/voice/listen")
    }
    
    res.type("text/xml")
    res.send(response.toString())
})

// Endpoint untuk status recording (opsional, untuk logging)
app.post("/voice/recording-status", (req, res) => {
    console.log("📊 Recording status:", req.body.RecordingStatus)
    res.status(200).send("OK")
})

// Cleanup conversation ketika call berakhir
app.post("/voice/status", (req, res) => {
    const callSid = req.body.CallSid
    const callStatus = req.body.CallStatus
    
    console.log(`📋 Call status update: ${callStatus} for ${callSid}`)
    
    if (callStatus === "completed") {
        conversations.delete(callSid)
        console.log(`🗑️ Cleaned up conversation for call ${callSid}`)
    }
    
    res.status(200).send("OK")
})

// Handle hangup
app.post("/voice/hangup", (req, res) => {
    const callSid = req.body.CallSid
    conversations.delete(callSid)
    console.log(`📞 Call ${callSid} ended, conversation cleaned up`)
    res.status(200).send("OK")
})

// Error handler
app.use((error, req, res, next) => {
    console.error("🚨 Unhandled error:", error)
    res.status(500).send("Internal Server Error")
})

app.listen(3000, () => {
    console.log("🚀 Voice AI server running at http://localhost:3000")
    console.log("🤖 OpenAI API Key:", process.env.OPENAI_API_KEY ? "✅ Found" : "❌ Missing")
    console.log("📱 Twilio Account SID:", process.env.TWILIO_ACCOUNT_SID ? "✅ Found" : "❌ Missing")
    console.log("🔑 Twilio Auth Token:", process.env.TWILIO_AUTH_TOKEN ? "✅ Found" : "❌ Missing")
    console.log("📋 Available endpoints:")
    console.log("  - POST /voice/answer")
    console.log("  - POST /voice/listen") 
    console.log("  - POST /voice/process-speech")
    console.log("  - POST /voice/continue")
    console.log("  - POST /voice/status")
    console.log("  - POST /voice/hangup")
})