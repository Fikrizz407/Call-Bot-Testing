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

// Endpoint saat call masuk
app.post("/voice/answer", (req, res) => {
    const response = new twiml.VoiceResponse()
    const callSid = req.body.CallSid
    
    // Inisialisasi conversation context dengan persona AXA Mandiri
    conversations.set(callSid, {
        messages: [
            {
                role: "system",
                content: `Anda adalah Agent Telemarketing AXA Mandiri yang profesional untuk produk Asuransi Mandiri Proteksi Penyakit Tropis.

KARAKTER ANDA:
- Ramah dan Sopan - selalu gunakan bahasa yang santun dan hormat
- Komunikatif dan Informatif - jelaskan dengan detail namun mudah dipahami
- Percaya Diri tapi Tidak Memaksa - yakin dengan produk tanpa memaksa
- Persuasif dan Melek Teknik Penjualan - gunakan teknik closing yang tepat
- Empatik dan Responsif - pahami kebutuhan dan kekhawatiran nasabah
- Teliti dan Transparan - berikan informasi akurat dan jujur
- Konsisten dan Disiplin - ikuti flow yang telah ditentukan
- Adaptif dan Fleksibel - sesuaikan dengan respons nasabah
- Asertif dan Tegas di Momen Penting - tegas saat melakukan closing

=== ATURAN WAKTU MUTLAK - WAJIB DIIKUTI ===
WAKTU SEKARANG: pagi
GREETING YANG HARUS DIGUNAKAN: "Selamat pagi"
OPENING SCRIPT YANG HARUS DIGUNAKAN: "Selamat pagi, bisa bicara dengan Bapak/Ibu __________? Saya Agent dari AXA Mandiri, boleh meluangkan waktunya sebentar?"

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

ATURAN PENTING:
- WAJIB gunakan "Selamat pagi" sebagai greeting
- Mulai dengan opening script yang telah ditentukan
- Respons natural sesuai jawaban nasabah
- Verifikasi data satu persatu, jangan sekaligus
- Selalu sopan dan profesional
- Fokus pada manfaat untuk nasabah
- Transparan tentang produk dan syarat-syarat
- Jawaban harus singkat dan mudah dipahami saat didengar melalui telepon
- Maksimal 2-3 kalimat per respons untuk menjaga flow percakapan telepon`
            }
        ]
    })
    
    // Mulai dengan greeting script yang telah ditentukan
    response.say("Selamat pagi, bisa bicara dengan Bapak atau Ibu? Saya Agent dari AXA Mandiri, boleh meluangkan waktunya sebentar?", {
        voice: "alice",
        language: "id-ID"
    })
    
    // Langsung ke recording tanpa perlu tekan tombol
    response.redirect("/voice/listen")
    
    res.type("text/xml")
    res.send(response.toString())
})

// Endpoint untuk mendengarkan input suara user
app.post("/voice/listen", (req, res) => {
    const response = new twiml.VoiceResponse()
    
    // Record audio dari user dengan timeout yang cukup
    response.record({
        action: "/voice/process-speech",
        method: "POST",
        maxLength: 30, // maksimal 30 detik
        timeout: 5, // stop recording jika diam 5 detik
        playBeep: true,
        recordingChannels: "mono",
        recordingStatusCallback: "/voice/recording-status"
    })
    
    // Fallback jika tidak ada input
    response.say("Maaf, saya tidak mendengar apa-apa. Silakan coba lagi.", {
        voice: "alice",
        language: "id-ID"
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
                voice: "alice",
                language: "id-ID"
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
            timeout: 30000 // 30 second timeout
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
            fs.unlinkSync(audioPath) // cleanup empty file
            response.say("Maaf, rekaman kosong. Silakan coba berbicara lagi.", {
                voice: "alice",
                language: "id-ID"
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
                voice: "alice",
                language: "id-ID"
            })
            response.redirect("/voice/listen")
            res.type("text/xml")
            res.send(response.toString())
            return
        }
        
        // Ambil context conversation
        const conversation = conversations.get(callSid) || { messages: [] }
        
        // Tambahkan pesan user ke conversation
        conversation.messages.push({
            role: "user",
            content: userText
        })
        
        console.log("🤖 Getting AI response...")
        
        // Generate response menggunakan GPT-4o
        const chatCompletion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: conversation.messages,
            max_tokens: 150,
            temperature: 0.7
        })
        
        const aiResponse = chatCompletion.choices[0].message.content
        console.log("💬 AI Response:", aiResponse)
        
        // Tambahkan respons AI ke conversation
        conversation.messages.push({
            role: "assistant",
            content: aiResponse
        })
        
        // Update conversation context
        conversations.set(callSid, conversation)
        
        // Berikan respons AI sebagai suara
        response.say(aiResponse, {
            voice: "alice",
            language: "id-ID"
        })
        
        // Tanya apakah user ingin melanjutkan
        response.gather({
            input: "dtmf",
            numDigits: 1,
            action: "/voice/continue",
            method: "POST",
            timeout: 10
        }).say("Tekan 1 untuk melanjutkan berbicara, atau tekan 2 untuk mengakhiri panggilan.", {
            voice: "alice",
            language: "id-ID"
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
        
        // More specific error messages
        let errorMessage = "Maaf, terjadi kesalahan. Silakan coba lagi."
        
        if (error.response?.status === 401) {
            console.error("🔑 Authentication error - check Twilio credentials")
            errorMessage = "Maaf, terjadi kesalahan autentikasi. Silakan coba lagi."
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            console.error("🌐 Network error")
            errorMessage = "Maaf, terjadi masalah koneksi. Silakan coba lagi."
        } else if (error.message.includes('OpenAI')) {
            console.error("🤖 OpenAI API error")
            errorMessage = "Maaf, layanan AI sedang bermasalah. Silakan coba lagi."
        }
        
        response.say(errorMessage, {
            voice: "alice",
            language: "id-ID"
        })
        response.redirect("/voice/listen")
    }
    
    res.type("text/xml")
    res.send(response.toString())
})

// Endpoint untuk handle pilihan continue atau tidak
app.post("/voice/continue", (req, res) => {
    const digit = req.body.Digits
    const response = new twiml.VoiceResponse()
    
    if (digit === "1") {
        response.say("Baik, silakan lanjutkan berbicara.", {
            voice: "alice",
            language: "id-ID"
        })
        response.redirect("/voice/listen")
    } else if (digit === "2") {
        response.say("Terima kasih sudah berbicara dengan saya. Sampai jumpa!", {
            voice: "alice",
            language: "id-ID"
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

app.listen(3000, () => {
    console.log("🚀 Enhanced Voice AI server running at http://localhost:3000")
    console.log("📋 Available endpoints:")
    console.log("  - POST /voice/answer")
    console.log("  - POST /voice/listen") 
    console.log("  - POST /voice/process-speech")
    console.log("  - POST /voice/continue")
    console.log("  - POST /voice/status")
    console.log("  - POST /voice/hangup")
})