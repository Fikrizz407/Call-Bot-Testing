// server.js
require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser')
const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
const voiceRoutes = require('./voice')

const app = express()
app.use(bodyParser.urlencoded({ extended: true }))

// Halaman utama (form untuk call)
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <title>Twilio Call Demo</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body class="bg-light d-flex align-items-center justify-content-center vh-100">
      <div class="card shadow p-4" style="width: 400px; border-radius: 15px;">
        <h3 class="text-center mb-3">Twilio Call</h3>
        <form method="POST" action="/call">
          <div class="mb-3">
            <label class="form-label">Nomor Tujuan</label>
            <input type="text" name="to" class="form-control" placeholder="+628xxxx" required>
          </div>
          <button type="submit" class="btn btn-success w-100">Panggil Sekarang</button>
        </form>
      </div>
    </body>
    </html>
  `)
})

// Endpoint untuk melakukan call via Twilio
app.post('/call', async (req, res) => {
  try {
    const toNumber = req.body.to

    const call = await client.calls.create({
      url: process.env.BASE_URL + '/voice/answer', // TwiML dari voice.js
      from: process.env.TWILIO_PHONE_NUMBER,
      to: toNumber
    })

    res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <title>Call Status</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="bg-light d-flex align-items-center justify-content-center vh-100">
        <div class="card shadow p-4" style="width: 400px; border-radius: 15px;">
          <h3 class="text-success">✅ Call sedang dilakukan!</h3>
          <p>Call SID: <code>${call.sid}</code></p>
          <a href="/" class="btn btn-primary mt-3">Kembali</a>
        </div>
      </body>
      </html>
    `)
  } catch (err) {
    res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <title>Error</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="bg-light d-flex align-items-center justify-content-center vh-100">
        <div class="card shadow p-4" style="width: 400px; border-radius: 15px;">
          <h3 class="text-danger">❌ Error</h3>
          <p>${err.message}</p>
          <a href="/" class="btn btn-primary mt-3">Coba lagi</a>
        </div>
      </body>
      </html>
    `)
  }
})

// Routing TwiML di voice.js
app.use('/voice', voiceRoutes)

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`🚀 Server jalan di http://localhost:${PORT}`))
