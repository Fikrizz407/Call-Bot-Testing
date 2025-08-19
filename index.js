const twilio = require("twilio")
require("dotenv").config()

const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
)

async function makeCall() {
    try {
        const call = await client.calls.create({
            url: `${process.env.BASE_URL}/answer`,
            statusCallback: `${process.env.BASE_URL}/status`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
            statusCallbackMethod: 'POST',
            to: process.env.PHONE_NUMBER,
            from: process.env.TWILIO_PHONE_NUMBER,
            record: false, // Kita handle recording sendiri
            timeout: 60 // timeout dalam detik
        })
        
        console.log("✅ Call started:", call.sid)
        console.log("📞 Calling:", process.env.PHONE_NUMBER)
        console.log("📡 Webhook URL:", `${process.env.BASE_URL}/answer`)
        
    } catch (error) {
        console.error("❌ Error saat call:", error.message)
        console.error("🔍 Details:", error)
    }
}

// Tambahan: fungsi untuk membuat multiple calls atau call terjadwal
async function makeScheduledCall(delaySeconds = 0) {
    setTimeout(() => {
        console.log(`⏰ Making scheduled call in ${delaySeconds} seconds...`)
        makeCall()
    }, delaySeconds * 1000)
}

// Export functions jika diperlukan
module.exports = {
    makeCall,
    makeScheduledCall
}

// Run immediately
makeCall()